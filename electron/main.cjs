const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  LEGACY_PORT,
  apiOrigin,
  findFreePort,
  setBackendListener,
  startPythonApi,
  stopPythonApi,
} = require("./python-manager.cjs");
const {
  createApiToken, denyAllPermissions, installApiAuthHeader, isAppUrl, isSafeExternalUrl,
} = require("./security.cjs");
const buildChannel = require("./build-channel.cjs");
const { checkEvaluation } = require("./eval-license.cjs");

const isDev = !app.isPackaged;
const DEV_RENDERER_URL = "http://127.0.0.1:5173";
// Runtime identity comes from the build channel so a beta build keeps its own
// userData folder and registry namespace, fully separate from the full app.
const APP_NAME = buildChannel.appName || "Cutout Studio";
let mainWindow = null;
// Set when an evaluation build's period has ended; the backend is never started.
let evaluationExpired = false;
// Per-launch secret shared with the backend this app starts (see security.cjs).
const apiToken = createApiToken();
// CUTOUT_STUDIO_REUSE_API=1 (dev only) attaches to a backend you started yourself on the
// legacy port; otherwise every launch gets its own free port, so it can never collide
// with an old copy, another checkout, or a leftover process.
const reuseApi = isDev && process.env.CUTOUT_STUDIO_REUSE_API === "1";
let apiPort = 0;
let authHeaderInstalled = false;

function localCutoutDataPath() {
  const localAppData = process.env.LOCALAPPDATA
    || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "AppData", "Local") : "");
  return localAppData ? path.join(localAppData, APP_NAME) : "";
}

function writeMainLog(message) {
  if (isDev) return;
  const userDataPath = localCutoutDataPath();
  if (!userDataPath) return;
  try {
    const logDir = path.join(userDataPath, "logs");
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
      path.join(logDir, "main.log"),
      `[${new Date().toISOString()}] ${message}\n`,
      "utf8",
    );
  } catch {
    // Startup logging must never block app launch.
  }
}

writeMainLog(`main module loaded packaged=${app.isPackaged} exec=${process.execPath}`);
app.setName(APP_NAME);
Menu.setApplicationMenu(null);

function configurePackagedUserDataPath() {
  if (isDev) return;
  const userDataPath = localCutoutDataPath();
  if (!userDataPath) return;
  app.setPath("userData", userDataPath);
  writeMainLog(`userData=${app.getPath("userData")}`);
}

configurePackagedUserDataPath();

function appRoot() {
  return path.resolve(__dirname, "..");
}

// Where the native backend finds its data (Real-ESRGAN, templates). With
// asar:false these sit under resources/app; with asar:true the app code is in
// app.asar and the data is shipped as extraResources under resources/. A native
// process cannot read inside an asar, so probe for the real on-disk location.
function backendResourceDir() {
  if (isDev) return appRoot();
  for (const dir of [appRoot(), process.resourcesPath]) {
    try {
      if (fs.existsSync(path.join(dir, "realesrgan-ncnn-vulkan"))) return dir;
    } catch {
      // ignore and try the next candidate
    }
  }
  return appRoot();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#141312",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // Stated on purpose (it is also Electron's default): the page runs in the Chromium
      // sandbox, and the preload only uses APIs that work inside it.
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
      additionalArguments: [`--cutout-api-origin=http://127.0.0.1:${apiPort || LEGACY_PORT}`],
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  // The window only ever shows the app. A file dropped outside a drop zone used to
  // navigate here and replace the whole UI; now it is simply refused.
  const keepOnApp = (event, url) => {
    const currentUrl = mainWindow?.webContents.getURL();
    if (!currentUrl || url === currentUrl || isAppUrl(url, rendererUrl())) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) shell.openExternal(url);
  };
  mainWindow.webContents.on("will-navigate", keepOnApp);
  // A redirect after an allowed navigation must not lead the window somewhere else either.
  mainWindow.webContents.on("will-redirect", keepOnApp);

  return mainWindow;
}

function rendererUrl() {
  if (isDev) return DEV_RENDERER_URL;
  return pathToFileURL(path.join(appRoot(), "editor-ui", "dist", "index.html")).toString();
}

function errorHtml(message) {
  const escaped = String(message || "Unknown error")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Cutout Studio</title>
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; background: #141312; color: #f5f5f1; }
      main { max-width: 720px; margin: 12vh auto; padding: 32px; }
      h1 { margin: 0 0 12px; padding-bottom: 12px; border-bottom: 4px solid #ffd439; display: inline-block; font-size: 24px; }
      p { color: #b9b8b0; line-height: 1.6; }
      pre { white-space: pre-wrap; background: #1c1b19; border: 1px solid #33322e; padding: 16px; border-radius: 8px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Cutout Studio could not start</h1>
      <p>In development, start from this workspace with the local Python and frontend dependencies available. In the packaged app, the bundled backend must be present under the app resources folder.</p>
      <pre>${escaped}</pre>
    </main>
  </body>
</html>`)}`;
}

// Shown at once while the backend starts, so a slow first launch never looks like nothing happened.
function startingHtml() {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Cutout Studio</title>
    <style>
      body { margin: 0; height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; background: #141312; color: #f5f5f1; }
      main { text-align: center; }
      h1 { margin: 0 0 12px; padding-bottom: 12px; border-bottom: 4px solid #ffd439; display: inline-block; font-size: 24px; font-weight: 600; }
      p { margin: 0; color: #b9b8b0; }
    </style>
  </head>
  <body>
    <main>
      <h1>Cutout Studio</h1>
      <p>Starting&hellip; the first launch can take a little longer.</p>
    </main>
  </body>
</html>`)}`;
}

// Minimal, generic screen shown when an evaluation build's period has ended.
// No technical detail: the app simply reports it could not start.
function stoppedHtml() {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${APP_NAME}</title>
    <style>
      body { margin: 0; height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; background: #141312; color: #f5f5f1; }
      main { text-align: center; }
      h1 { margin: 0; padding-bottom: 12px; border-bottom: 4px solid #ffd439; display: inline-block; font-size: 22px; font-weight: 600; }
    </style>
  </head>
  <body>
    <main>
      <h1>${APP_NAME} could not start.</h1>
    </main>
  </body>
</html>`)}`;
}

async function loadEvaluationStopped() {
  writeMainLog("evaluation period ended; not starting backend");
  const win = !mainWindow || mainWindow.isDestroyed() ? createWindow() : mainWindow;
  await win.loadURL(stoppedHtml());
  if (!win.isDestroyed() && !win.isVisible()) win.show();
}

function requestUrl(url, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 500) resolve(true);
        else reject(new Error(`GET ${url} -> ${res.statusCode}`));
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error(`GET ${url} -> timeout`));
    });
    req.on("error", reject);
  });
}

async function waitForRenderer({ timeoutMs = 20000, intervalMs = 300 } = {}) {
  if (!isDev) return true;

  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await requestUrl(DEV_RENDERER_URL, Math.min(intervalMs, 1000));
      return true;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw lastError || new Error(`Timed out waiting for Vite at ${DEV_RENDERER_URL}`);
}

async function loadStartupError(error) {
  console.error("[electron] startup failed", error);
  writeMainLog(`startup failed: ${error?.stack || error?.message || error}`);
  // Closing the window while the backend was still starting is not an error to report.
  if (error?.startupAborted || app.__stoppingPythonApi) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
  dialog.showErrorBox(APP_NAME, error?.message || String(error));
  await mainWindow.loadURL(errorHtml(error?.stack || error?.message || error));
}

async function openMainWindow() {
  const resourceDir = backendResourceDir();
  writeMainLog(`openMainWindow start resourceDir=${resourceDir}`);
  if (!apiPort) apiPort = reuseApi ? LEGACY_PORT : await findFreePort();

  // Window first, backend second: the user sees the app respond immediately.
  const win = createWindow();
  await win.loadURL(startingHtml());

  await startPythonApi({
    packaged: app.isPackaged,
    userDataPath: app.getPath("userData"),
    resourceDir,
    token: apiToken,
    port: apiPort,
  });
  if (!authHeaderInstalled) {
    installApiAuthHeader(session.defaultSession, apiToken, apiOrigin());
    authHeaderInstalled = true;
  }
  writeMainLog("backend ready");
  await waitForRenderer();
  writeMainLog("renderer ready");

  await win.loadURL(rendererUrl());
  writeMainLog(`window loaded url=${rendererUrl()}`);
  return win;
}

ipcMain.handle("dialog:select-folder", async (event, { initial = "" } = {}) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(owner || mainWindow, {
    title: "Select folder",
    defaultPath: initial || appRoot(),
    properties: ["openDirectory"],
  });
  return { path: result.canceled ? "" : result.filePaths[0] || "" };
});

ipcMain.handle("dialog:select-file", async (event, { initial = "", filter = "image" } = {}) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const filters = filter === "image"
    ? [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "tif", "tiff", "avif"] }]
    : [{ name: "All files", extensions: ["*"] }];
  const result = await dialog.showOpenDialog(owner || mainWindow, {
    title: "Select file",
    defaultPath: initial || appRoot(),
    properties: ["openFile"],
    filters,
  });
  return { path: result.canceled ? "" : result.filePaths[0] || "" };
});

// Save dialog + write in one step, so the renderer learns whether the user
// cancelled. Bytes are only ever written to the path the user picked here.
const SAVE_FILE_MAX_BYTES = 512 * 1024 * 1024;
const SAVE_FILE_FILTERS = {
  png: [{ name: "PNG image", extensions: ["png"] }],
  zip: [{ name: "ZIP archive", extensions: ["zip"] }],
};

ipcMain.handle("dialog:save-file", async (event, { defaultName = "", kind = "png", data } = {}) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const filters = SAVE_FILE_FILTERS[kind];
  if (!filters) throw new Error("unsupported file type");
  if (!(data instanceof Uint8Array) || data.byteLength === 0 || data.byteLength > SAVE_FILE_MAX_BYTES) {
    throw new Error("invalid file data");
  }
  const safeName = path.basename(String(defaultName || `image.${kind}`));
  const result = await dialog.showSaveDialog(owner || mainWindow, {
    title: "Save image",
    defaultPath: path.join(app.getPath("downloads"), safeName),
    filters,
  });
  if (result.canceled || !result.filePath) return { saved: false, path: "" };
  await fs.promises.writeFile(result.filePath, data);
  return { saved: true, path: result.filePath };
});

// A second copy would attach to the first one's backend and break it when closed.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    writeMainLog("app ready");
    denyAllPermissions(session.defaultSession);
    // Evaluation-build gate, before anything starts. No-op for full builds
    // (channel !== "eval"). Runs after the single-instance lock, so a second
    // launch never reads or advances the stored state.
    evaluationExpired = checkEvaluation(buildChannel, writeMainLog).expired;
    if (evaluationExpired) {
      await loadEvaluationStopped();
      return;
    }
    setBackendListener((status) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("backend:status", status);
    });
    try {
      await openMainWindow();
    } catch (error) {
      // Showing the error page can itself fail (for example the window is already gone).
      await loadStartupError(error).catch((shownError) => {
        writeMainLog(`could not show the startup error: ${shownError?.message || shownError}`);
      });
    }
  });

  app.on("activate", () => {
    if (evaluationExpired) {
      if (BrowserWindow.getAllWindows().length === 0) loadEvaluationStopped().catch(() => {});
      return;
    }
    if (BrowserWindow.getAllWindows().length === 0) {
      openMainWindow().catch((error) => {
        loadStartupError(error).catch(() => {});
      });
    }
  });
}

app.on("before-quit", async (event) => {
  if (app.__stoppingPythonApi) return;
  event.preventDefault();
  app.__stoppingPythonApi = true;
  await stopPythonApi();
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
