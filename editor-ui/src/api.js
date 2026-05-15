// All calls go through /api/* which Vite proxies to http://127.0.0.1:7421
// In Electron production build, change BASE to "http://127.0.0.1:7421" directly.

const BASE = "/api";
const DEFAULT_TIMEOUT_MS = 15000;

function withTimeout(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => window.clearTimeout(timer),
  };
}

async function parseJsonResponse(r, method, path) {
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}`);
  try {
    return await r.json();
  } catch {
    throw new Error(`${method} ${path} → invalid JSON response`);
  }
}

async function get(path, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const req = withTimeout(timeoutMs);
  try {
    const r = await fetch(BASE + path, { signal: req.signal });
    return await parseJsonResponse(r, "GET", path);
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(`GET ${path} → timeout`);
    throw e;
  } finally {
    req.clear();
  }
}

async function post(path, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const req = withTimeout(timeoutMs);
  try {
    const r = await fetch(BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    return await parseJsonResponse(r, "POST", path);
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(`POST ${path} → timeout`);
    throw e;
  } finally {
    req.clear();
  }
}

// Returns guides, templates, canvas_size
export const getConfig  = ()           => get("/config");

// Returns { folder, label, count, found, source_stage, reason, output_dir }
// outputDir: optional. When supplied, API does not fall back to ./input.
export const getSource  = (outputDir = "") =>
  get(`/source${outputDir ? `?output_dir=${encodeURIComponent(outputDir)}` : ""}`);

// Open native OS folder-picker dialog; returns { path }
export const browseFolder = (initial = "") =>
  get(`/browse?initial=${encodeURIComponent(initial)}`);

// Returns { images: [...abs paths], count }
export const getImages  = (folder)     => get(`/images?folder=${encodeURIComponent(folder)}`);

// URL to use directly in <img src="...">
export const imageUrl   = (absPath)    => `${BASE}/image?path=${encodeURIComponent(absPath)}`;

// items: [{ image_path, canvas_x, canvas_y, scale }]
export const saveComposition = (items, srcRoot, queueIndex, isCombo, thumbnail = true, canvasSize = null, outputDir = "") =>
  post("/save", { items, src_root: srcRoot, queue_index: queueIndex, is_combo: isCombo, thumbnail, canvas_size: canvasSize, output_dir: outputDir });

export const skipImage  = (imagePath, srcRoot = "", outputDir = "")  => post("/skip", { image_path: imagePath, src_root: srcRoot, output_dir: outputDir });

export const getSession = ()           => get("/session");
export const saveSession = (data)      => post("/session", data);
export const clearSession = ()         => fetch(BASE + "/session", { method: "DELETE" });

// Opens a folder in the native OS file explorer
export const openFolder = (absPath) =>
  fetch(`${BASE}/open-folder?path=${encodeURIComponent(absPath)}`);
