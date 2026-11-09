const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const { API_ORIGIN, API_TOKEN_HEADER } = require("./security.cjs");

const API_CONFIG_URL = `${API_ORIGIN}/config`;
const API_STOP_URL = `${API_ORIGIN}/pipeline/stop`;

let pythonProcess = null;
let usingExternalApi = false;
let ownedPackagedBackend = false;
let backendLogFile = "";
let apiToken = "";
let backendExit = null;

const FOREIGN_BACKEND_MESSAGE = [
  "Another program is already answering on 127.0.0.1:7421, so Cutout Studio cannot start its own backend there.",
  "This is usually an older or still-running copy of Cutout Studio. Close it (check Task Manager for",
  "\"Cutout Studio\" and \"image-pipeline-api\") and start the app again.",
].join(" ");

function appRoot() {
  return path.resolve(__dirname, "..");
}

function pythonExecutable(rootDir = appRoot()) {
  const venvPython = path.join(rootDir, "venv311", "Scripts", "python.exe");
  return fs.existsSync(venvPython) ? venvPython : "python";
}

function packagedBackendExecutable() {
  return path.join(process.resourcesPath, "backend", "image-pipeline-api", "image-pipeline-api.exe");
}

function ensurePackagedDataDirs(userDataPath) {
  [
    "config",
    "session",
    path.join("cache", "previews"),
    path.join("cache", "temp"),
    path.join("cache", "thumbnails"),
    path.join("models", "rembg"),
    path.join("models", "huggingface"),
    path.join("models", "onnx"),
    "logs",
    "exports",
  ].forEach((relativePath) => {
    fs.mkdirSync(path.join(userDataPath, relativePath), { recursive: true });
  });
}

function writeBackendLog(message) {
  if (!backendLogFile) return;
  try {
    fs.appendFileSync(backendLogFile, `[${new Date().toISOString()}] ${message}\n`, "utf8");
  } catch {
    // Logging must never block startup or shutdown.
  }
}

function backendEnvironment({ packaged, userDataPath, resourceDir }) {
  const env = {
    ...process.env,
    PYTHONUNBUFFERED: "1",
    CUTOUT_STUDIO_RESOURCE_DIR: resourceDir,
    CUTOUT_STUDIO_USER_DATA: userDataPath,
    CUTOUT_STUDIO_PACKAGED: packaged ? "1" : "0",
    CUTOUT_STUDIO_API_TOKEN: apiToken,
  };

  if (packaged) {
    const modelsRoot = path.join(userDataPath, "models");
    env.HF_HOME = path.join(modelsRoot, "huggingface");
    env.HUGGINGFACE_HUB_CACHE = path.join(modelsRoot, "huggingface", "hub");
    env.XDG_CACHE_HOME = modelsRoot;
    env.U2NET_HOME = path.join(modelsRoot, "rembg");
    env.REMBG_HOME = path.join(modelsRoot, "rembg");
    env.ONNXRUNTIME_HOME = path.join(modelsRoot, "onnx");
    env.CUTOUT_STUDIO_DEFAULT_OUTPUT_DIR = path.join(userDataPath, "exports");
  }

  return env;
}

function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process is already gone.
    }
  }
}

function tokenHeaders() {
  return apiToken ? { [API_TOKEN_HEADER]: apiToken } : {};
}

function request(method, url, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers: tokenHeaders(), timeout: timeoutMs }, (res) => {
      res.resume();
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(true);
        else reject(new Error(`${method} ${url} -> ${res.statusCode}`));
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error(`${method} ${url} -> timeout`));
    });
    req.on("error", reject);
    req.end();
  });
}

// One look at /config: the status plus the parsed body when it is JSON.
function probeApi(timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const req = http.get(API_CONFIG_URL, { headers: tokenHeaders(), timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          // Not JSON: some other service.
        }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error(`GET ${API_CONFIG_URL} -> timeout`));
    });
    req.on("error", reject);
  });
}

// True when a backend other than the one this launch started answers on the port:
// an older build without auth, or another instance holding a different token.
function isForeignBackend(probe) {
  if (probe.status === 401) return true;
  const ok = probe.status >= 200 && probe.status < 300;
  return ok && !(probe.json && probe.json.auth_enforced === true);
}

async function waitForApi({ timeoutMs = 45000, intervalMs = 400 } = {}) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    if (backendExit) {
      throw new Error(`The backend exited before it was ready (${backendExit}). See backend.log for details.`);
    }
    try {
      const probe = await probeApi(Math.min(intervalMs, 1000));
      if (probe.status === 200 && probe.json && probe.json.auth_enforced === true) return true;
      if (isForeignBackend(probe)) throw new Error(FOREIGN_BACKEND_MESSAGE);
      lastError = new Error(`GET ${API_CONFIG_URL} -> ${probe.status}`);
    } catch (error) {
      if (error.message === FOREIGN_BACKEND_MESSAGE) throw error;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw lastError || new Error("Timed out waiting for Python API");
}

function pipeProcessOutput(child) {
  child.stdout?.on("data", (chunk) => {
    process.stdout.write(`[api] ${chunk}`);
    writeBackendLog(`[stdout] ${String(chunk).trimEnd()}`);
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[api] ${chunk}`);
    writeBackendLog(`[stderr] ${String(chunk).trimEnd()}`);
  });
}

async function startPythonApi({ packaged = false, userDataPath = "", resourceDir = appRoot(), token = "" } = {}) {
  if (pythonProcess || usingExternalApi) {
    return { apiOrigin: API_ORIGIN, external: usingExternalApi };
  }

  apiToken = token;
  backendExit = null;

  // Never attach silently to whatever already holds the port: it may be an older
  // build or another instance, and the UI would then run against the wrong code.
  const existing = await probeApi(1000).catch(() => null);
  if (existing && isForeignBackend(existing)) {
    const reuseWanted = !packaged && process.env.CUTOUT_STUDIO_REUSE_API === "1";
    if (reuseWanted && existing.status === 200) {
      usingExternalApi = true;
      console.log("[api] Reusing the API you started on 127.0.0.1:7421 (CUTOUT_STUDIO_REUSE_API=1)");
      return { apiOrigin: API_ORIGIN, external: true };
    }
    throw new Error(FOREIGN_BACKEND_MESSAGE);
  }

  const rootDir = appRoot();
  const executable = packaged ? packagedBackendExecutable() : pythonExecutable(rootDir);
  const args = packaged ? [] : ["-u", path.join(rootDir, "api.py")];
  const cwd = packaged ? resourceDir : rootDir;
  const env = backendEnvironment({ packaged, userDataPath, resourceDir });
  ownedPackagedBackend = packaged;

  if (packaged) {
    if (!fs.existsSync(executable)) {
      throw new Error("Bundled backend is missing. Run npm run backend:build before packaging.");
    }
    ensurePackagedDataDirs(userDataPath);
    backendLogFile = path.join(userDataPath, "logs", "backend.log");
    writeBackendLog(`Starting bundled backend: ${executable}`);
    writeBackendLog(`Resource dir: ${resourceDir}`);
    writeBackendLog(`User data: ${userDataPath}`);
  } else if (!fs.existsSync(args[1])) {
    throw new Error(`api.py was not found at ${args[1]}`);
  }

  pythonProcess = spawn(executable, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  pipeProcessOutput(pythonProcess);

  pythonProcess.once("exit", (code, signal) => {
    console.log(`[api] Python API exited with code=${code} signal=${signal}`);
    writeBackendLog(`Backend exited with code=${code} signal=${signal}`);
    backendExit = `code=${code} signal=${signal}`;
    pythonProcess = null;
  });

  await waitForApi({ timeoutMs: packaged ? 120000 : 45000 });
  writeBackendLog("Backend API is ready on 127.0.0.1:7421");
  return { apiOrigin: API_ORIGIN, external: false, backend: executable };
}

async function stopPythonApi() {
  if (!pythonProcess || pythonProcess.killed) return;

  try {
    await request("POST", API_STOP_URL, 1500);
  } catch {
    // The API may already be down or the pipeline may not be running.
  }

  const child = pythonProcess;
  pythonProcess = null;

  await new Promise((resolve) => {
    const done = () => resolve();
    const timer = setTimeout(() => {
      if (ownedPackagedBackend) {
        killProcessTree(child.pid);
      } else {
        try {
          child.kill("SIGTERM");
        } catch {
          // Process is already gone.
        }
      }
      setTimeout(() => {
        if (child.exitCode === null && !child.killed) {
          if (ownedPackagedBackend) {
            killProcessTree(child.pid);
          } else {
            try {
              child.kill("SIGKILL");
            } catch {
              // Process is already gone.
            }
          }
        }
        resolve();
      }, 1200);
    }, 300);

    child.once("exit", () => {
      clearTimeout(timer);
      done();
    });

    try {
      if (ownedPackagedBackend) {
        killProcessTree(child.pid);
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      clearTimeout(timer);
      done();
    }
  });
}

module.exports = {
  API_ORIGIN,
  startPythonApi,
  stopPythonApi,
};
