const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const API_ORIGIN = "http://127.0.0.1:7421";
const API_CONFIG_URL = `${API_ORIGIN}/config`;
const API_STOP_URL = `${API_ORIGIN}/pipeline/stop`;

let pythonProcess = null;
let usingExternalApi = false;

function appRoot() {
  return path.resolve(__dirname, "..");
}

function pythonExecutable(rootDir = appRoot()) {
  const venvPython = path.join(rootDir, "venv311", "Scripts", "python.exe");
  return fs.existsSync(venvPython) ? venvPython : "python";
}

function request(method, url, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, timeout: timeoutMs }, (res) => {
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

async function waitForApi({ timeoutMs = 45000, intervalMs = 400 } = {}) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await request("GET", API_CONFIG_URL, Math.min(intervalMs, 1000));
      return true;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw lastError || new Error("Timed out waiting for Python API");
}

function pipeProcessOutput(child) {
  child.stdout?.on("data", (chunk) => {
    process.stdout.write(`[api] ${chunk}`);
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[api] ${chunk}`);
  });
}

async function startPythonApi() {
  if (pythonProcess || usingExternalApi) {
    return { apiOrigin: API_ORIGIN, external: usingExternalApi };
  }

  try {
    await waitForApi({ timeoutMs: 1000, intervalMs: 250 });
    usingExternalApi = true;
    console.log("[api] Reusing API already available on 127.0.0.1:7421");
    return { apiOrigin: API_ORIGIN, external: true };
  } catch {
    // No existing API responded; Electron will start and own one.
  }

  const rootDir = appRoot();
  const executable = pythonExecutable(rootDir);
  const apiScript = path.join(rootDir, "api.py");

  if (!fs.existsSync(apiScript)) {
    throw new Error(`api.py was not found at ${apiScript}`);
  }

  pythonProcess = spawn(executable, ["-u", apiScript], {
    cwd: rootDir,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  pipeProcessOutput(pythonProcess);

  pythonProcess.once("exit", (code, signal) => {
    console.log(`[api] Python API exited with code=${code} signal=${signal}`);
    pythonProcess = null;
  });

  await waitForApi();
  return { apiOrigin: API_ORIGIN, external: false, python: executable };
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
      try {
        child.kill("SIGTERM");
      } catch {
        // Process is already gone.
      }
      setTimeout(() => {
        if (child.exitCode === null && !child.killed) {
          try {
            child.kill("SIGKILL");
          } catch {
            // Process is already gone.
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
      child.kill("SIGTERM");
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
