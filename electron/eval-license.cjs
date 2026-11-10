// Evaluation period for time-limited builds.
//
// Scope and honesty: this is a SOFT limit for sharing an evaluation build with
// colleagues, not security. The app ships unpacked (asar:false) JavaScript, so
// the secret below is in the build and a determined person can read it and forge
// a stamp. What this does provide:
//   - the start date is stored outside the app folder (registry + a LOCALAPPDATA
//     file), so uninstall/reinstall or deleting app data does not reset it;
//   - the two copies restore each other, so clearing one location is not enough;
//   - an integrity tag means casually editing the stored value is detected;
//   - the tag is bound to the machine's MachineGuid, so a stamp copied to a
//     different machine is rejected (no sharing a "fresh" or pre-made value);
//   - a monotonic "last seen" means setting the clock back does not add time.
// Clearing BOTH stored copies on the same machine, or editing the system clock
// with knowledge of the format and secret, can still defeat it. For a hard
// limit, server-side activation is the only option and is not implemented here.

const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_APP_NAME = "Cutout Studio";
const REG_VALUE = "Data";
// Baked-in key for the integrity tag. Soft measure only (see note above).
const SECRET = "cs_eval_v1_2b9f7a4c1e8d60a35c7f";

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
function machineId() {
  if (_machineId !== null) return _machineId;
  try {
    const out = execFileSync(
      "reg",
      ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const m = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/);
    _machineId = m ? m[1] : "";
  } catch {
    _machineId = "";
  }
  return _machineId;
}

function tagFor(payload) {
  return crypto
    .createHmac("sha256", SECRET)
    .update(`${payload}|${machineId()}`)
    .digest("hex")
    .slice(0, 16);
}

// token = base64( "<hexFirst>.<hexLast>:<tag>" )
function encodeToken(firstLaunch, lastSeen) {
  const payload = `${firstLaunch.toString(16)}.${lastSeen.toString(16)}`;
  const token = `${payload}:${tagFor(payload)}`;
  return Buffer.from(token, "utf8").toString("base64");
}

// Returns { firstLaunch, lastSeen } on a valid token, "tampered" if the tag does
// not match (edited, or from another machine), or null if empty/unparseable.
function decodeToken(value) {
  if (!value) return null;
  let raw;
  try {
    raw = Buffer.from(String(value).trim(), "base64").toString("utf8");
  } catch {
    return null;
  }
  const sep = raw.lastIndexOf(":");
  if (sep < 0) return null;
  const payload = raw.slice(0, sep);
  const tag = raw.slice(sep + 1);
  if (tagFor(payload) !== tag) return "tampered";
  const dot = payload.indexOf(".");
  if (dot < 0) return null;
  const firstLaunch = parseInt(payload.slice(0, dot), 16);
  const lastSeen = parseInt(payload.slice(dot + 1), 16);
  if (!Number.isFinite(firstLaunch) || !Number.isFinite(lastSeen)) return null;
  return { firstLaunch, lastSeen };
}

function readRegistry(grantId) {
  try {
    const out = execFileSync(
      "reg",
      ["query", `${regRoot()}\\${grantId}`, "/v", REG_VALUE],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const m = out.match(/\bData\s+REG_SZ\s+(\S+)/);
    return m ? m[1] : "";
  } catch {
    return ""; // value/key absent
  }
}

function writeRegistry(grantId, token) {
  try {
    execFileSync(
      "reg",
      ["add", `${regRoot()}\\${grantId}`, "/v", REG_VALUE, "/t", "REG_SZ", "/d", token, "/f"],
      { stdio: "ignore" },
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

function writeFileStore(grantId, token) {
  const fp = filePath(grantId);
  if (!fp) return false;
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, token, "utf8");
    return true;
  } catch {
    return false;
  }
}

// Reads both copies and reconciles them.
//   { state: "fresh" }                       no copy present -> first launch
//   { state: "tampered" }                    a present copy failed integrity
//   { state: "ok", firstLaunch, lastSeen }   at least one valid copy
function loadState(grantId) {
  const copies = [readRegistry(grantId), readFileStore(grantId)].map(decodeToken);
  if (copies.some((c) => c === "tampered")) return { state: "tampered" };
  const valid = copies.filter((c) => c && typeof c === "object");
  if (valid.length === 0) return { state: "fresh" };
  const firstLaunch = Math.min(...valid.map((c) => c.firstLaunch));
  const lastSeen = Math.max(...valid.map((c) => c.lastSeen));
  return { state: "ok", firstLaunch, lastSeen };
}

function persist(grantId, firstLaunch, lastSeen) {
  const token = encodeToken(firstLaunch, lastSeen);
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
    const evalDays = Number(config.evalDays) > 0 ? Number(config.evalDays) : 365;
    const limitSeconds = evalDays * 86400;
    const now = nowEpoch();
    const loaded = loadState(grantId);

    if (loaded.state === "tampered") {
      log(`eval: grant=${grantId} stored value failed integrity -> expired`);
      return { expired: true };
    }
    if (loaded.state === "fresh") {
      persist(grantId, now, now);
      log(`eval: grant=${grantId} first launch recorded`);
      return { expired: false };
    }
    const effectiveNow = Math.max(now, loaded.lastSeen); // rollback cannot subtract time
    persist(grantId, loaded.firstLaunch, effectiveNow);
    const elapsed = effectiveNow - loaded.firstLaunch;
    const expired = elapsed >= limitSeconds;
    log(`eval: grant=${grantId} elapsed=${elapsed}s limit=${limitSeconds}s expired=${expired}`);
    return { expired };
  } catch (err) {
    log(`eval: check error ${err?.message || err}; allowing launch`);
    return { expired: false };
  }
}

module.exports = { checkEvaluation };
