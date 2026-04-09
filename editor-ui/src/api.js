// All calls go through /api/* which Vite proxies to http://127.0.0.1:7421
// In Electron production build, change BASE to "http://127.0.0.1:7421" directly.

const BASE = "/api";

async function get(path) {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json();
}

async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}`);
  return r.json();
}

// Returns guides, templates, canvas_size
export const getConfig  = ()           => get("/config");

// Returns { folder, label, count }
// outputDir: optional — if supplied, API looks inside it for bg_removed/upscaled first
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
export const saveComposition = (items, srcRoot, queueIndex, isCombo, thumbnail = true, canvasSize = null) =>
  post("/save", { items, src_root: srcRoot, queue_index: queueIndex, is_combo: isCombo, thumbnail, canvas_size: canvasSize });

export const skipImage  = (imagePath)  => post("/skip",    { image_path: imagePath });

export const getSession = ()           => get("/session");
export const saveSession = (data)      => post("/session", data);
export const clearSession = ()         => fetch(BASE + "/session", { method: "DELETE" });

// Opens a folder in the native OS file explorer
export const openFolder = (absPath) =>
  fetch(`${BASE}/open-folder?path=${encodeURIComponent(absPath)}`);