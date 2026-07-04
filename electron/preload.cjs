const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  selectFolder: (initial = "") => ipcRenderer.invoke("dialog:select-folder", { initial }),
  selectFile: (initial = "", filter = "image") => ipcRenderer.invoke("dialog:select-file", { initial, filter }),
  pathForFile: (file) => webUtils.getPathForFile(file),
  apiBaseUrl: "http://127.0.0.1:7421",
  platform: process.platform,
  isPackaged: ipcRenderer.sendSync("app:is-packaged"),
});
