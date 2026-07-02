export function apiBase() {
  return window.electronAPI?.apiBaseUrl || "/api";
}

export function isElectron() {
  return Boolean(window.electronAPI);
}

export async function selectFolder(initial = "") {
  if (!window.electronAPI?.selectFolder) return null;
  return window.electronAPI.selectFolder(initial);
}

export async function selectFile(initial = "", filter = "image") {
  if (!window.electronAPI?.selectFile) return null;
  return window.electronAPI.selectFile(initial, filter);
}
