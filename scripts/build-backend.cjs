const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const venvPython = path.join(rootDir, "venv311", "Scripts", "python.exe");
const python = fs.existsSync(venvPython) ? venvPython : "python";

function run(args, options = {}) {
  return spawnSync(python, args, {
    cwd: rootDir,
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });
}

function moduleExists(name) {
  const result = run([
    "-c",
    `import importlib.util; raise SystemExit(0 if importlib.util.find_spec(${JSON.stringify(name)}) else 1)`,
  ]);
  return result.status === 0;
}

function distributionExists(name) {
  const result = run([
    "-c",
    `import importlib.metadata as m; target=${JSON.stringify(name)}.lower(); raise SystemExit(0 if any((d.metadata.get('Name') or '').lower() == target for d in m.distributions()) else 1)`,
  ]);
  return result.status === 0;
}

const pyinstallerCheck = run(["-m", "PyInstaller", "--version"]);
if (pyinstallerCheck.status !== 0) {
  console.error("PyInstaller is required to build the bundled backend.");
  console.error(`Install it with: ${python} -m pip install pyinstaller`);
  process.exit(pyinstallerCheck.status || 1);
}

const optionalHiddenImports = [
  "pillow_avif",
  "rembg",
  "rembg.bg",
  "rembg.session_factory",
  "rembg.sessions.birefnet_general",
  "rembg.sessions.birefnet_general_lite",
  "rembg.sessions.birefnet_massive",
  "rembg.sessions.birefnet_dis",
  "rembg.sessions.birefnet_hrsod",
  "rembg.sessions.bria_rmbg",
];

const pyinstallerArgs = [
  "-m", "PyInstaller",
  "--noconfirm",
  "--clean",
  "--onefile",
  "--name", "image-pipeline-api",
  "--distpath", "backend-dist",
  "--workpath", path.join("backend-build", "work"),
  "--specpath", "backend-build",
  "--hidden-import", "pipeline",
  "--hidden-import", "sse_starlette.sse",
  "--hidden-import", "uvicorn.logging",
  "--hidden-import", "uvicorn.loops",
  "--hidden-import", "uvicorn.loops.auto",
  "--hidden-import", "uvicorn.protocols.http.auto",
  "--hidden-import", "uvicorn.protocols.websockets.auto",
  "--hidden-import", "uvicorn.lifespan.on",
];

[
  "torch",
  "torchvision",
  "torchaudio",
  "transformers",
  "sympy",
  "pytest",
  "Cython",
  "matplotlib",
].forEach((moduleName) => {
  pyinstallerArgs.push("--exclude-module", moduleName);
});

for (const distributionName of ["rembg", "pymatting", "onnxruntime", "onnxruntime-directml"]) {
  if (distributionExists(distributionName)) {
    pyinstallerArgs.push("--copy-metadata", distributionName);
  }
}

for (const moduleName of optionalHiddenImports) {
  if (moduleExists(moduleName)) {
    pyinstallerArgs.push("--hidden-import", moduleName);
  }
}

pyinstallerArgs.push("api.py");

const build = spawnSync(python, pyinstallerArgs, {
  cwd: rootDir,
  stdio: "inherit",
  windowsHide: true,
});

if (build.status !== 0) {
  process.exit(build.status || 1);
}

const exePath = path.join(rootDir, "backend-dist", "image-pipeline-api.exe");
if (!fs.existsSync(exePath)) {
  console.error(`Backend build finished but ${exePath} was not created.`);
  process.exit(1);
}

console.log(`Bundled backend created: ${exePath}`);
