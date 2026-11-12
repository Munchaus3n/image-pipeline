// Writes build-seed/templates_custom.json: the templates every new install starts with.
//
// In development the app saves templates you create into the project's own
// templates_custom.json, so the working copy can hold local experiments (and megabytes
// of embedded images). The installer must ship the committed version instead.
//
//   node scripts/prepare-seed.cjs        (runs automatically before electron-builder)

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "build-seed");
const outFile = path.join(outDir, "templates_custom.json");

const show = spawnSync("git", ["show", "HEAD:templates_custom.json"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
  windowsHide: true,
});
if (show.status !== 0) {
  console.error("Could not read the committed templates_custom.json (is this a git checkout?).");
  console.error(show.stderr || "");
  process.exit(1);
}

let templates;
try {
  templates = JSON.parse(show.stdout);
} catch (error) {
  console.error(`The committed templates_custom.json is not valid JSON: ${error.message}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, show.stdout, "utf8");

const localSize = fs.existsSync(path.join(root, "templates_custom.json"))
  ? fs.statSync(path.join(root, "templates_custom.json")).size
  : 0;
console.log(
  `Seed templates: ${Object.keys(templates).length} (${Buffer.byteLength(show.stdout)} bytes), ` +
  `working copy is ${localSize} bytes and is not shipped.`,
);
