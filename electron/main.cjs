const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { startPythonApi, stopPythonApi } = require("./python-manager.cjs");

const isDev = !app.isPackaged;
const DEV_RENDERER_URL = "http://127.0.0.1:5173";
let mainWindow = null;

function appRoot() {
  return path.resolve(__dirname, "..");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    show: false,
    backgroundColor: "#0b0f17",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const currentUrl = mainWindow?.webContents.getURL();
    if (!currentUrl || url === currentUrl) return;
    if (isDev && url.startsWith("http://127.0.0.1:5173")) return;
    if (!isDev && url.startsWith("file://")) return;
    event.preventDefault();
    shell.openExternal(url);
  });

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
    <title>Image Pipeline Pro</title>
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; background: #0b0f17; color: #e5edf7; }
      main { max-width: 720px; margin: 12vh auto; padding: 32px; }
      h1 { margin: 0 0 12px; font-size: 24px; }
      p { color: #aab6c8; line-height: 1.6; }
      pre { white-space: pre-wrap; background: #151b25; border: 1px solid #273246; padding: 16px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Image Pipeline Pro could not start</h1>
      <p>Electron v1 uses a local or system Python runtime and a fixed local Vite port in dev. Install Python dependencies, free port 5173 if needed, and retry from this workspace.</p>
      <pre>${escaped}</pre>
    </main>
  </body>
</html>`)}`;
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
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
  dialog.showErrorBox("Image Pipeline Pro", error?.message || String(error));
  await mainWindow.loadURL(errorHtml(error?.stack || error?.message || error));
}

async function openMainWindow() {
  await startPythonApi();
  await waitForRenderer();

  const win = createWindow();
  await win.loadURL(rendererUrl());
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

ipcMain.on("app:is-packaged", (event) => {
  event.returnValue = app.isPackaged;
});

app.whenReady().then(async () => {
  try {
    await openMainWindow();
  } catch (error) {
    await loadStartupError(error);
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    openMainWindow().catch((error) => {
      loadStartupError(error).catch(() => {});
    });
  }
});

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
