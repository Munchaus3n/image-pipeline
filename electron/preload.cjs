const { contextBridge, ipcRenderer, webUtils } = require("electron");

// The main process picks a free port per launch and passes the origin as an argument.
const originArg = process.argv.find((arg) => arg.startsWith("--cutout-api-origin="));
const apiBaseUrl = originArg ? originArg.slice("--cutout-api-origin=".length) : "http://127.0.0.1:7421";

contextBridge.exposeInMainWorld("electronAPI", {
  selectFolder: (initial = "") => ipcRenderer.invoke("dialog:select-folder", { initial }),
  selectFile: (initial = "", filter = "image") => ipcRenderer.invoke("dialog:select-file", { initial, filter }),
  saveFile: (defaultName, kind, data) => ipcRenderer.invoke("dialog:save-file", { defaultName, kind, data }),
  pathForFile: (file) => webUtils.getPathForFile(file),
  apiBaseUrl,
  // Backend lifecycle: { state: "restarting" | "running" | "failed", ... }. Returns an unsubscribe function.
  onBackendStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on("backend:status", handler);
    return () => ipcRenderer.removeListener("backend:status", handler);
  },
  platform: process.platform,
  isPackaged: ipcRenderer.sendSync("app:is-packaged"),
});
