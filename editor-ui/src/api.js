// Browser/Vite calls use /api through the dev proxy.
// Electron calls use the localhost API exposed by preload.
import { apiBase, selectFile, selectFolder } from "./runtime.js";

const BASE = apiBase();
const DEFAULT_TIMEOUT_MS = 15000;
const LONG_TIMEOUT_MS = 120000;

function withTimeout(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => window.clearTimeout(timer),
  };
}

// FastAPI errors carry `detail` as a string, or as a list of { msg, loc } for 422s.
export function errorDetailText(detail) {
  if (detail == null) return "";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map(item => (typeof item === "string" ? item : item?.msg || JSON.stringify(item)))
      .join("; ");
  }
  return detail.msg || JSON.stringify(detail);
}

async function parseJsonResponse(r, method, path) {
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    const detail = errorDetailText(body?.detail);
    // Show the server's reason when it gave one. The fallback leaves out the query string,
    // which would otherwise put a full file path in the message.
    const error = new Error(detail || `${method} ${path.split("?")[0]} → ${r.status}`);
    error.status = r.status;
    error.detail = detail;
    throw error;
  }
  try {
    return await r.json();
  } catch {
    throw new Error(`${method} ${path} → invalid JSON response`);
  }
}

async function request(method, path, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const req = withTimeout(timeoutMs);
  try {
    const init = { method, signal: req.signal };
    if (body !== undefined) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(body);
    }
    const r = await fetch(BASE + path, init);
    return await parseJsonResponse(r, method, path);
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(`${method} ${path} → timeout`);
    throw e;
  } finally {
    req.clear();
  }
}

const get  = (path, timeoutMs)       => request("GET", path, undefined, timeoutMs);

// Plain JSON GET with the shared timeout/error handling, for callers that build their own query.
export const getJson = get;
const post = (path, body, timeoutMs) => request("POST", path, body, timeoutMs);
const del  = (path, timeoutMs)       => request("DELETE", path, undefined, timeoutMs);

// Returns guides, templates, canvas_size
export const getConfig  = ()           => get("/config");

// Returns { folder, label, count, found, source_stage, reason, output_dir }
// outputDir: optional. When supplied, API does not fall back to ./input.
export const getSource  = (outputDir = "") =>
  get(`/source${outputDir ? `?output_dir=${encodeURIComponent(outputDir)}` : ""}`);

// Open native OS folder-picker dialog; returns { path }
export const browseFolder = async (initial = "") => {
  const nativeResult = await selectFolder(initial);
  if (nativeResult?.path || nativeResult?.path === "") return nativeResult;
  return get(`/browse?initial=${encodeURIComponent(initial)}`);
};

// Open native OS file-picker dialog; returns { path }
export const browseFile = async (initial = "", filter = "image") => {
  const nativeResult = await selectFile(initial, filter);
  if (nativeResult?.path || nativeResult?.path === "") return nativeResult;
  return get(`/browse-file?initial=${encodeURIComponent(initial)}&filter=${encodeURIComponent(filter)}`);
};

// Returns { images: [...abs paths], count, truncated }
// Big folders take a while to scan, so this waits longer than the 15 s default.
export const getImages  = (folder, { recursive = true, limit = 0 } = {}) =>
  get(`/images?folder=${encodeURIComponent(folder)}&recursive=${recursive ? "true" : "false"}&limit=${encodeURIComponent(limit)}`, LONG_TIMEOUT_MS);

// URL to use directly in <img src="...">
export const imageUrl   = (absPath)    => `${BASE}/image?path=${encodeURIComponent(absPath)}`;

// Downscaled preview (max side = size px); version busts the browser cache.
export const previewUrl = (absPath, size, version) =>
  `${BASE}/preview?path=${encodeURIComponent(absPath)}&size=${size}${version !== undefined ? `&v=${version}` : ""}`;

// Template ref_image is a data URL (what the Templates screen saves) or a bare file name
// in templates/. A path is refused: a templates file someone shares must not be able to
// make the app read an arbitrary file on this PC, or a network share, through /image.
export const templateRefUrl = (ref) => {
  if (!ref) return null;
  if (ref.startsWith("data:image/")) return ref;
  if (ref.includes("/") || ref.includes("\\") || ref.includes(":")) return null;
  return `${BASE}/templates/image?name=${encodeURIComponent(ref)}`;
};

// items: [{ image_path, canvas_x, canvas_y, scale }]
export const saveComposition = (items, srcRoot, queueIndex, isCombo, thumbnail = true, canvasSize = null, outputDir = "") =>
  // Large photos at high scale take a while; a timeout here would report a failure for a save that finishes.
  post("/save", { items, src_root: srcRoot, queue_index: queueIndex, is_combo: isCombo, thumbnail, canvas_size: canvasSize, output_dir: outputDir }, LONG_TIMEOUT_MS);

export const skipImage  = (imagePath, srcRoot = "", outputDir = "")  => post("/skip", { image_path: imagePath, src_root: srcRoot, output_dir: outputDir });

// Removes the Editor/skipped copy that skipImage wrote, when a skipped image is saved after all.
// Same body as /skip; callers treat a 404 (older API) as "not available".
export const unskipImage = (imagePath, srcRoot = "", outputDir = "") => post("/unskip", { image_path: imagePath, src_root: srcRoot, output_dir: outputDir });

export const getSession = ()           => get("/session");
export const saveSession = (data)      => post("/session", data);
export const clearSession = ()         => del("/session");

// Returns the saved settings object, or null when the server sent none.
export const getSettings = async () => (await get("/settings"))?.settings ?? null;

// The server deep-merges the patch into settings.json (dicts merge, lists replace),
// so only send the keys that changed — never a full stale copy.
export const patchSettings = (patch) => post("/settings", { settings: patch });

export const getRembgModels = () => get("/models/rembg");

export const getTemplates  = ()          => get("/templates/list");
export const saveTemplates = (templates) => post("/templates/save", { templates });

// Opens a folder in the native OS file explorer.
// path="" → server defaults to OUTPUT_ROOT.
export const openFolder = (absPath = "") =>
  post(`/open-folder?path=${encodeURIComponent(absPath)}`);
