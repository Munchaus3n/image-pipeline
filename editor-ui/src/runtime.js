export function apiBase() {
  return window.electronAPI?.apiBaseUrl || "/api";
}

export async function selectFolder(initial = "") {
  if (!window.electronAPI?.selectFolder) return null;
  return window.electronAPI.selectFolder(initial);
}

export async function selectFile(initial = "", filter = "image") {
  if (!window.electronAPI?.selectFile) return null;
  return window.electronAPI.selectFile(initial, filter);
}

// The desktop app shows a native Save dialog and reports whether the user saved
// or cancelled. A plain browser download can't, so callers must not assume it saved.
export function canSaveWithDialog() {
  return Boolean(window.electronAPI?.saveFile);
}

// Returns { saved: boolean, path: string }. kind: "png" | "zip".
export async function saveFileWithDialog(blob, defaultName, kind) {
  const data = new Uint8Array(await blob.arrayBuffer());
  return window.electronAPI.saveFile(defaultName, kind, data);
}

export function pathForFile(file) {
  if (!window.electronAPI?.pathForFile) return "";
  try {
    return window.electronAPI.pathForFile(file) || "";
  } catch {
    return "";
  }
}
