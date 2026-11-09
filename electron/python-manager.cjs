const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { API_TOKEN_HEADER } = require("./security.cjs");

// The terminal/browser workflow and CUTOUT_STUDIO_REUSE_API use this port; the
// desktop app normally picks a free one per launch (see findFreePort).
const LEGACY_PORT = 7421;
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 120000;

let pythonProcess = null;
let usingExternalApi = false;
let backendLogFile = "";
let apiToken = "";
let apiPort = LEGACY_PORT;
let backendExit = null;
let backendReady = false;
let stopping = false;
let recovering = false;
let restartTimes = [];
let launch = null;
let statusListener = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function apiOrigin() {
  return `http://127.0.0.1:${apiPort}`;
}

function foreignBackendMessage() {
  return [
    `Another program is already answering on 127.0.0.1:${apiPort}, so Cutout Studio cannot start its own backend there.`,
    "This is usually an older or still-running copy of Cutout Studio. Close it (check Task Manager for",
    "\"Cutout Studio\" and \"image-pipeline-api\") and start the app again.",
  ].join(" ");
}

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

// Lets the main process tell the window what the backend is doing.
function setBackendListener(listener) {
  statusListener = listener;
}

function emitStatus(status) {
  writeBackendLog(`status: ${JSON.stringify(status)}`);
  try {
    if (statusListener) statusListener(status);
  } catch {
    // A broken listener must not take the supervisor down with it.
  }
}

// Ask the OS for a free loopback port. There is a tiny window before the backend
// binds it, which the foreign-backend check below turns into a clear error.
function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function backendEnvironment({ packaged, userDataPath, resourceDir }) {
  const env = {
    ...process.env,
    PYTHONUNBUFFERED: "1",
    CUTOUT_STUDIO_RESOURCE_DIR: resourceDir,
    CUTOUT_STUDIO_USER_DATA: userDataPath,
    CUTOUT_STUDIO_PACKAGED: packaged ? "1" : "0",
    CUTOUT_STUDIO_API_TOKEN: apiToken,
    CUTOUT_STUDIO_PORT: String(apiPort),
    // The backend shuts itself down if this process disappears without stopping it.
    CUTOUT_STUDIO_PARENT_PID: String(process.pid),
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

// Kills the backend and everything it started (the pipeline subprocess), not just the parent.
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
    const url = `${apiOrigin()}/config`;
    const req = http.get(url, { headers: tokenHeaders(), timeout: timeoutMs }, (res) => {
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
      req.destroy(new Error(`GET ${url} -> timeout`));
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
      throw new Error(`The backend stopped before it was ready (${backendExit}). See backend.log for details.`);
    }
    try {
      const probe = await probeApi(Math.min(intervalMs, 1000));
      if (probe.status === 200 && probe.json && probe.json.auth_enforced === true) return true;
      if (isForeignBackend(probe)) throw new Error(foreignBackendMessage());
      lastError = new Error(`GET ${apiOrigin()}/config -> ${probe.status}`);
    } catch (error) {
      if (error.message === foreignBackendMessage()) throw error;
      lastError = error;
    }
    await sleep(intervalMs);
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

function spawnBackend() {
  const { executable, args, cwd, env } = launch;
  backendExit = null;

  const child = spawn(executable, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  pythonProcess = child;
  pipeProcessOutput(child);

  // Without this, a missing or blocked executable (ENOENT/EPERM) crashes the main process.
  child.once("error", (error) => {
    console.log(`[api] Could not start the backend: ${error.message}`);
    writeBackendLog(`Could not start backend ${executable}: ${error.message}`);
    backendExit = `could not start ${path.basename(executable)}: ${error.message}`;
    if (pythonProcess === child) pythonProcess = null;
  });

  child.once("exit", (code, signal) => {
    console.log(`[api] Python API exited with code=${code} signal=${signal}`);
    writeBackendLog(`Backend exited with code=${code} signal=${signal}`);
    backendExit = `code=${code} signal=${signal}`;
    if (pythonProcess === child) pythonProcess = null;
    if (!stopping && backendReady && !recovering && !usingExternalApi) {
      recoverBackend().catch(() => {});
    }
  });
}

// The backend died while the app is open: start it again on the same port and token,
// so the window keeps working, and tell the window what happened.
async function recoverBackend() {
  if (recovering) return;
  recovering = true;
  try {
    for (;;) {
      const now = Date.now();
      restartTimes = restartTimes.filter((time) => now - time < RESTART_WINDOW_MS);
      if (stopping) return;
      if (restartTimes.length >= MAX_RESTARTS) {
        emitStatus({
          state: "failed",
          message: `The backend stopped ${MAX_RESTARTS} times in a row (${backendExit || "unknown reason"}).`,
        });
        return;
      }
      restartTimes.push(now);
      emitStatus({ state: "restarting", attempt: restartTimes.length, max: MAX_RESTARTS });
      await sleep(500 * restartTimes.length);
      if (stopping) return;
      spawnBackend();
      try {
        await waitForApi({ timeoutMs: launch.packaged ? 120000 : 45000 });
        emitStatus({ state: "running" });
        return;
      } catch (error) {
        writeBackendLog(`Restart attempt failed: ${error.message}`);
        if (pythonProcess) {
          const stuck = pythonProcess;
          pythonProcess = null;
          killProcessTree(stuck.pid);
        }
      }
    }
  } finally {
    recovering = false;
  }
}

async function startPythonApi({
  packaged = false,
  userDataPath = "",
  resourceDir = appRoot(),
  token = "",
  port = LEGACY_PORT,
} = {}) {
  if (pythonProcess || usingExternalApi) {
    return { apiOrigin: apiOrigin(), external: usingExternalApi };
  }

  apiToken = token;
  apiPort = port;
  backendExit = null;
  backendReady = false;
  stopping = false;
  restartTimes = [];

  // Never attach silently to whatever already holds the port: it may be an older
  // build or another instance, and the UI would then run against the wrong code.
  const existing = await probeApi(1000).catch(() => null);
  if (existing && isForeignBackend(existing)) {
    const reuseWanted = !packaged && process.env.CUTOUT_STUDIO_REUSE_API === "1";
    if (reuseWanted && existing.status === 200) {
      usingExternalApi = true;
      console.log(`[api] Reusing the API you started on 127.0.0.1:${apiPort} (CUTOUT_STUDIO_REUSE_API=1)`);
      return { apiOrigin: apiOrigin(), external: true };
    }
    throw new Error(foreignBackendMessage());
  }

  const rootDir = appRoot();
  const executable = packaged ? packagedBackendExecutable() : pythonExecutable(rootDir);
  const args = packaged ? [] : ["-u", path.join(rootDir, "api.py")];
  const cwd = packaged ? resourceDir : rootDir;
  const env = backendEnvironment({ packaged, userDataPath, resourceDir });
  launch = { executable, args, cwd, env, packaged };

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

  spawnBackend();
  await waitForApi({ timeoutMs: packaged ? 120000 : 45000 });
  backendReady = true;
  writeBackendLog(`Backend API is ready on 127.0.0.1:${apiPort}`);
  return { apiOrigin: apiOrigin(), external: false, backend: executable };
}

async function stopPythonApi() {
  stopping = true;
  const child = pythonProcess;
  if (!child) return;

  try {
    await request("POST", `${apiOrigin()}/pipeline/stop`, 1500);
  } catch {
    // The API may already be down or the pipeline may not be running.
  }

  pythonProcess = null;
  await new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      killProcessTree(child.pid);
      resolve();
    }, 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    killProcessTree(child.pid);
  });
}

module.exports = {
  LEGACY_PORT,
  apiOrigin,
  findFreePort,
  setBackendListener,
  startPythonApi,
  stopPythonApi,
};
