// Evaluation period for time-limited builds.
//
// Scope and honesty: this is a SOFT limit for sharing an evaluation build with
// colleagues, not security. The app is distributable JavaScript: the beta packs
// it into app.asar and obfuscates it, but both can be undone, so a determined
// person can recover the secret below and forge a stamp. What this does provide:
//   - the start date is stored outside the app folder (registry + a LOCALAPPDATA
//     file), so uninstall/reinstall or deleting app data does not reset it;
//   - the two copies restore each other, so clearing one location is not enough;
//   - an integrity tag means editing the stored value is detected;
//   - the tag is bound to the machine's MachineGuid, so a stamp copied to a
//     different machine is rejected (no sharing a "fresh" or pre-made value);
//   - a monotonic "last seen" means setting the clock back does not add time.
// Clearing BOTH stored copies on the same machine, or editing the system clock
// with knowledge of the format and secret, can still defeat it. For a hard
// limit, server-side activation is the only option and is not implemented here.
//
// Failure policy: a value that fails its integrity check counts as tampering
// (expired). Anything that is an infrastructure problem rather than tampering
// (MachineGuid unreadable, registry tools blocked, a disk error) lets the app
// start, and never writes a stamp that a later, healthy launch would reject.

const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_APP_NAME = "Cutout Studio";
const REG_VALUE = "Data";
// Baked-in key for the integrity tag. Soft measure only (see note above).
const SECRET = "cs_eval_v1_2b9f7a4c1e8d60a35c7f";
// A forward jump larger than this between two launches is treated as a likely
// wrong clock (e.g. a bad date after a BIOS reset): the launch still reports
// the result, but the jump is not stored, so fixing the clock undoes it.
const MAX_TRUSTED_GAP_FRACTION = 0.5;

let APP_NAME = DEFAULT_APP_NAME;
let _machineId = null;

function nowEpoch() {
  return Math.floor(Date.now() / 1000);
}

// Collapse the app name to a registry-safe token, e.g. "Cutout Studio Beta"
// -> "CutoutStudioBeta", so a beta build uses its own key tree.
function regRoot() {
  const safe = APP_NAME.replace(/[^A-Za-z0-9]/g, "");
  return `HKCU\\Software\\${safe}\\Grants`;
}

function localDir(grantId) {
  const base = process.env.LOCALAPPDATA
    || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "AppData", "Local") : "");
  if (!base) return "";
  return path.join(base, APP_NAME, ".license", String(grantId));
}

function filePath(grantId) {
  const dir = localDir(grantId);
  return dir ? path.join(dir, "state") : "";
}

// Per-machine id, so a stamp is only valid on the machine that created it.
// "" means it could not be read this launch (not cached, so a later call retries).
function machineId() {
  if (_machineId) return _machineId;
  try {
    const out = execFileSync(
      "reg",
      ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 10000 },
    );
    const m = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/);
    _machineId = m ? m[1] : "";
  } catch {
    _machineId = "";
  }
  return _machineId;
}

function tagFor(payload, machine) {
  return crypto
    .createHmac("sha256", SECRET)
    .update(`${payload}|${machine}`)
    .digest("hex")
    .slice(0, 16);
}

// token = base64( "<hexFirst>.<hexLast>:<tag>" )
function encodeToken(firstLaunch, lastSeen, machine) {
  const payload = `${firstLaunch.toString(16)}.${lastSeen.toString(16)}`;
  const token = `${payload}:${tagFor(payload, machine)}`;
  return Buffer.from(token, "utf8").toString("base64");
}

// Returns { firstLaunch, lastSeen } for a valid token, null when nothing is
// stored, or "tampered" for any stored value that does not verify (edited,
// garbage, truncated, or made on another machine).
function decodeToken(value, machine) {
  const text = String(value || "").trim();
  if (!text) return null;
  const raw = Buffer.from(text, "base64").toString("utf8");
  const sep = raw.lastIndexOf(":");
  if (sep < 0) return "tampered";
  const payload = raw.slice(0, sep);
  const tag = raw.slice(sep + 1);
  if (tagFor(payload, machine) !== tag) return "tampered";
  const match = /^([0-9a-f]+)\.([0-9a-f]+)$/.exec(payload);
  if (!match) return "tampered";
  const firstLaunch = parseInt(match[1], 16);
  const lastSeen = parseInt(match[2], 16);
  if (!Number.isFinite(firstLaunch) || !Number.isFinite(lastSeen) || lastSeen < firstLaunch) return "tampered";
  return { firstLaunch, lastSeen };
}

function readRegistry(grantId) {
  try {
    const out = execFileSync(
      "reg",
      ["query", `${regRoot()}\\${grantId}`, "/v", REG_VALUE],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 10000 },
    );
    const m = out.match(/\bData\s+REG_SZ\s+(\S+)/);
    return m ? m[1] : "";
  } catch {
    return ""; // value/key absent (or reg.exe unavailable)
  }
}

function writeRegistry(grantId, token) {
  try {
    execFileSync(
      "reg",
      ["add", `${regRoot()}\\${grantId}`, "/v", REG_VALUE, "/t", "REG_SZ", "/d", token, "/f"],
      { stdio: "ignore", windowsHide: true, timeout: 10000 },
    );
    return true;
  } catch {
    return false;
  }
}

function readFileStore(grantId) {
  const fp = filePath(grantId);
  if (!fp) return "";
  try {
    return fs.readFileSync(fp, "utf8").trim();
  } catch {
    return "";
  }
}

// Temp file + rename, so an interrupted write never leaves a truncated stamp
// (which would read as tampered).
function writeFileStore(grantId, token) {
  const fp = filePath(grantId);
  if (!fp) return false;
  const tmp = `${fp}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(tmp, token, "utf8");
    fs.renameSync(tmp, fp);
    return true;
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    return false;
  }
}

// Reads both copies and reconciles them.
//   { state: "fresh" }                       no copy present -> first launch
//   { state: "tampered" }                    copies present, none verifies
//   { state: "ok", firstLaunch, lastSeen }   at least one valid copy; a damaged
//                                            other copy is repaired on persist
function loadState(grantId, machine) {
  const copies = [readRegistry(grantId), readFileStore(grantId)].map((v) => decodeToken(v, machine));
  const valid = copies.filter((c) => c && typeof c === "object");
  if (valid.length > 0) {
    return {
      state: "ok",
      firstLaunch: Math.min(...valid.map((c) => c.firstLaunch)),
      lastSeen: Math.max(...valid.map((c) => c.lastSeen)),
    };
  }
  if (copies.some((c) => c === "tampered")) return { state: "tampered" };
  return { state: "fresh" };
}

function persist(grantId, firstLaunch, lastSeen, machine) {
  const token = encodeToken(firstLaunch, lastSeen, machine);
  writeRegistry(grantId, token);
  writeFileStore(grantId, token);
}

// Main entry. Returns { expired: boolean }.
// `config` is build-channel.cjs. For channel !== "eval" this is a no-op.
function checkEvaluation(config, log = () => {}) {
  try {
    if (!config || config.channel !== "eval") return { expired: false };
    APP_NAME = (config.appName || DEFAULT_APP_NAME).trim() || DEFAULT_APP_NAME;
    const grantId = String(config.grantId || "").trim();
    if (!grantId) {
      log("eval: channel=eval but no grantId; skipping check");
      return { expired: false };
    }
    const machine = machineId();
    if (!machine) {
      // Cannot tell tampering from a bad read without the machine id, and a
      // stamp written now would fail verification once it reads again.
      log(`eval: grant=${grantId} machine id unavailable; allowing launch, nothing stored`);
      return { expired: false };
    }
    const evalDays = Number(config.evalDays) > 0 ? Number(config.evalDays) : 365;
    const limitSeconds = evalDays * 86400;
    const now = nowEpoch();
    const loaded = loadState(grantId, machine);

    if (loaded.state === "tampered") {
      log(`eval: grant=${grantId} stored value failed integrity -> expired`);
      return { expired: true };
    }
    if (loaded.state === "fresh") {
      persist(grantId, now, now, machine);
      log(`eval: grant=${grantId} first launch recorded`);
      return { expired: false };
    }
    const effectiveNow = Math.max(now, loaded.lastSeen); // rollback cannot subtract time
    const elapsed = effectiveNow - loaded.firstLaunch;
    const expired = elapsed >= limitSeconds;
    const gap = now - loaded.lastSeen;
    const suspectJump = expired && gap > limitSeconds * MAX_TRUSTED_GAP_FRACTION;
    if (suspectJump) {
      // Most likely a wrong clock. Report it, but keep the stored state so the
      // next launch with a corrected clock is judged on the real dates.
      log(`eval: grant=${grantId} clock jumped ${gap}s since last launch; not stored`);
    } else {
      persist(grantId, loaded.firstLaunch, effectiveNow, machine);
    }
    log(`eval: grant=${grantId} elapsed=${elapsed}s limit=${limitSeconds}s expired=${expired}`);
    return { expired };
  } catch (err) {
    log(`eval: check error ${err?.message || err}; allowing launch`);
    return { expired: false };
  }
}

module.exports = { checkEvaluation };
