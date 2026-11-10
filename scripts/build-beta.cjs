// One-command hardened beta build.
//
//   node scripts/build-beta.cjs [grantId] [appName]
//   e.g. node scripts/build-beta.cjs eval-2026-11 "Cutout Studio Beta"
//
// Produces beta/<productName> Setup <ver>.exe, a time-limited evaluation build
// with the Bria/RMBG model removed, asar + integrity fuses, and the Electron
// main-process code obfuscated. It temporarily writes an eval build-channel and
// obfuscates electron/*.cjs, then ALWAYS restores your readable source (even if
// the build fails). Nothing is committed.
//
// Prerequisites: editor-ui deps installed, venv311 with PyInstaller present,
// electron-builder-beta.json in the repo root. javascript-obfuscator is
// installed on demand if missing.

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ELECTRON_DIR = path.join(ROOT, "electron");
const CJS = ["main.cjs", "eval-license.cjs", "build-channel.cjs", "python-manager.cjs", "preload.cjs"];

const grantId = process.argv[2] || "eval-2026-11";
const appName = process.argv[3] || "Cutout Studio Beta";
const evalDays = 365;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} -> exit ${r.status}`);
}

function ensureObfuscator() {
  try { require.resolve("javascript-obfuscator"); return; } catch {}
  console.log("Installing javascript-obfuscator (not saved to package.json)...");
  run("npm", ["install", "--no-save", "javascript-obfuscator@4.1.1"]);
}

function obfuscateInPlace() {
  const JO = require("javascript-obfuscator");
  const options = {
    compact: true, target: "node",
    identifierNamesGenerator: "hexadecimal",
    stringArray: true, stringArrayThreshold: 0.8, stringArrayEncoding: ["base64"],
    splitStrings: true, splitStringsChunkLength: 8,
    numbersToExpressions: true, simplify: true,
    transformObjectKeys: false,   // keep IPC channel names / exposed API keys
    controlFlowFlattening: false, deadCodeInjection: false, selfDefending: false,
    disableConsoleOutput: false,
  };
  for (const name of CJS) {
    const fp = path.join(ELECTRON_DIR, name);
    const src = fs.readFileSync(fp, "utf8");
    fs.writeFileSync(fp, JO.obfuscate(src, options).getObfuscatedCode(), "utf8");
    console.log(`  obfuscated ${name}`);
  }
}

const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-cjs-"));
let restored = false;

// Put the readable electron/*.cjs back. Idempotent, synchronous, safe to call
// from a signal handler.
function restoreSource() {
  if (restored) return;
  restored = true;
  for (const name of CJS) {
    const bk = path.join(backupDir, name);
    try {
      if (fs.existsSync(bk)) fs.copyFileSync(bk, path.join(ELECTRON_DIR, name));
    } catch (error) {
      restored = false;
      console.error(`could not restore electron/${name} (backup kept in ${backupDir}): ${error.message}`);
    }
  }
  if (restored) {
    fs.rmSync(backupDir, { recursive: true, force: true });
    console.log("restored readable electron/*.cjs source");
  }
}

// Without a listener, Ctrl+C ends Node at once and the finally below never
// runs, leaving obfuscated source and an eval build-channel in the working tree.
// With one, the running child stops, run() throws and finally restores.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  process.on(signal, () => {
    console.error(`
${signal}: stopping and restoring source...`);
    restoreSource();
    process.exit(130);
  });
}
process.on("exit", restoreSource);
console.log(`backups of electron/*.cjs: ${backupDir}`);

try {
  // 1. Front-end + backend bundles (reflect current api.py / pipeline.py / UI).
  console.log("[1/5] building UI");
  run("npm", ["run", "electron:build-ui"]);
  console.log("[2/5] building backend (PyInstaller)");
  run("npm", ["run", "backend:build"]);

  // 2. Back up readable source, then bake the eval channel.
  console.log("[3/5] staging eval config + obfuscation");
  for (const name of CJS) fs.copyFileSync(path.join(ELECTRON_DIR, name), path.join(backupDir, name));
  fs.writeFileSync(path.join(ELECTRON_DIR, "build-channel.cjs"),
    `module.exports = {\n  channel: "eval",\n  grantId: ${JSON.stringify(grantId)},\n  evalDays: ${evalDays},\n  appName: ${JSON.stringify(appName)},\n};\n`, "utf8");

  // 3. Obfuscate the main-process files.
  ensureObfuscator();
  obfuscateInPlace();

  // 4. Package (asar + fuses + beta identity come from electron-builder-beta.json).
  console.log("[4/5] packaging installer");
  run("npx", ["electron-builder", "--win", "nsis", "--config", "electron-builder-beta.json"],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: "" } });

  console.log(`[5/5] done. grantId=${grantId} appName="${appName}"`);
  const version = require(path.join(ROOT, "package.json")).version;
  console.log(`Output: beta/v${version}/${appName} Setup ${version}.exe`);
} finally {
  // ALWAYS restore readable source.
  restoreSource();
}
