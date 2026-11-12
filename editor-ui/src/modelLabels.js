// One table names every model the app offers. The dropdown labels, the hint under each
// selector and the "How it works" page in Settings all read from it, so the wording
// cannot drift apart. The same guidance sits as comments next to the model lists in
// api.py (_REMBG_MODELS) and pipeline.py (NCNN_MODELS): change all three together.
//
// Fields: id (what the backend receives), label, summary (one line), bestFor, avoidWhen,
// notes (extra facts, shown in Settings only). Speed is described relative to the
// default model unless a measured number is given in notes.

// ── Background removal ───────────────────────────────────────────────────────
// All of these are BiRefNet variants (same family, same 1024px working size). Download
// size is about 1 GB each. The first run with a model downloads it.
export const BG_MODELS = [
  {
    // DEFAULT. The balanced choice: good edges on almost every product photo.
    // Benchmark (Ryzen 5 7535HS, CPU, four 1800px photos): ~18 s/photo, 10 s load. The fastest
    // of the three models measured; Lite, DIS and HRSOD were not downloaded or timed.
    // Use it unless a photo comes out wrong. If it cuts off parts of the product or keeps
    // background, try Massive (cluttered scenes), DIS (thin parts) or HRSOD (one big object).
    id: "birefnet-general",
    label: "BiRefNet General",
    summary: "Balanced default for everyday product photos.",
    bestFor: "Everyday product photos. The right choice for most batches.",
    avoidWhen: "Rarely a bad pick. Switch only if a cutout loses part of the product or keeps background.",
    notes: "Default. About 1 GB download on first use. Measured on a Ryzen 5 7535HS in CPU mode: about 18 s per photo, 10 s to load.",
  },
  {
    // Smaller Swin-Tiny backbone: faster and lighter, slightly less precise edges.
    // Good for big batches, CPU mode while you keep working, or a weak PC.
    // Not for hair, thin handles, glass or other fine edges.
    id: "birefnet-general-lite",
    label: "BiRefNet General Lite",
    summary: "Smaller and faster than General, edges a little less precise.",
    bestFor: "Large batches, a PC you are still working on, or weaker hardware.",
    avoidWhen: "Fine detail such as hair, thin handles, wires or glass.",
    notes: "Lighter backbone (Swin-Tiny), so it should need less memory and time than General. Not benchmarked yet.",
  },
  {
    // Same design as General, trained on a larger and more varied set of images.
    // Benchmark (same setup): ~20-35 s/photo (noisy), 10 s load.
    // Use it on cluttered or unusual subjects where General picks the wrong thing.
    // No gain expected on routine photos, and it is the same ~1 GB download.
    id: "birefnet-massive",
    label: "BiRefNet Massive",
    summary: "General's design trained on more data, for hard or odd subjects.",
    bestFor: "Cluttered or unusual subjects where General cuts the wrong thing.",
    avoidWhen: "Routine batches. It is not expected to beat General on simple photos.",
    notes: "About 1 GB download on first use. Measured in CPU mode: about 20 to 35 s per photo (it varied between runs), 10 s to load.",
  },
  {
    // Trained for dichotomous image segmentation (DIS5K): sharp, thin, intricate outlines.
    // Use for grilles, wires, chair legs, handles, holes through the object.
    // Not for soft or semi-transparent edges: it favours hard, crisp outlines.
    id: "birefnet-dis",
    label: "BiRefNet DIS",
    summary: "Crisp outlines for thin and intricate shapes.",
    bestFor: "Thin, intricate shapes: wires, grilles, chair legs, handles, holes through the object.",
    avoidWhen: "Soft or semi-transparent edges. It favours hard, crisp outlines.",
    notes: "Trained for dichotomous image segmentation. Same design as General, so a similar speed is expected. Not benchmarked yet.",
  },
  {
    // Trained for high-resolution salient objects: ONE clear main subject that stands out.
    // Use for a single dominant product on a plain or simple background.
    // Not for several products in one photo, or when the product is not the most
    // eye-catching thing in the picture.
    id: "birefnet-hrsod",
    label: "BiRefNet HRSOD",
    summary: "Picks the single most prominent object in a high-resolution photo.",
    bestFor: "One clear main object that stands out from the background.",
    avoidWhen: "Several products in one photo, or a product that is not the most prominent thing.",
    notes: "Trained for high-resolution salient object detection. Same design as General, so a similar speed is expected. Not benchmarked yet.",
  },
];

export const BG_MODEL_LABELS = Object.fromEntries(BG_MODELS.map(model => [model.id, model.label]));
export const BG_MODEL_OPTIONS = BG_MODELS.map(model => [model.id, model.label]);

export function bgModelLabel(modelId) {
  return BG_MODEL_LABELS[modelId] || modelId;
}

// Never undefined: unknown ids (a model the backend added) still render with their id.
export function bgModelInfo(modelId) {
  return BG_MODELS.find(model => model.id === modelId)
    || { id: modelId, label: modelId, summary: "", bestFor: "", avoidWhen: "", notes: "" };
}

// ── Upscaling (Real-ESRGAN, run through ncnn-vulkan on the GPU) ──────────────
// The Settings choice is "fast" or "quality" and only affects 2×. 4× always uses the
// photo model. Models are chosen in pipeline.py (NCNN_MODELS, resolve_upscale).
export const UPSCALE_MODELS = [
  {
    // 2x, small model made for video frames (realesr-animevideov3-x2). Quickest.
    // Good for big batches and clean, flat surfaces. It smooths fine texture, so small
    // print on packaging can look soft.
    id: "fast",
    label: "2× Fast",
    summary: "Quick 2×, tuned for video frames.",
    bestFor: "Large batches and clean, flat surfaces.",
    avoidWhen: "Small print and fine texture on packaging. It smooths them.",
    notes: "Model: realesr-animevideov3-x2.",
  },
  {
    // 2x done as a 4x pass with the photo model (realesrgan-x4plus), then scaled down to 2x.
    // Keeps texture and small text. Much slower, especially on integrated graphics.
    id: "quality",
    label: "2× Quality",
    summary: "Photo model at 4×, scaled down to 2×. Slow, keeps detail.",
    bestFor: "Packaging with small print, labels and texture.",
    avoidWhen: "Big batches on integrated graphics. It is much slower than Fast.",
    notes: "Model: realesrgan-x4plus, then resized to 2×.",
  },
  {
    // 4x with the photo model (realesrgan-x4plus). Used whenever Scale is 4×.
    // For very small sources that must end up large. Images already at or above the
    // "skip upscale" size are left alone.
    id: "x4",
    label: "4×",
    summary: "Photo model at 4×.",
    bestFor: "Very small source images that need to end up large.",
    avoidWhen: "Sources that are already large. The skip rule leaves those alone.",
    notes: "Model: realesrgan-x4plus. Same speed class as 2× Quality.",
  },
];

export function upscaleModelInfo(id) {
  return UPSCALE_MODELS.find(model => model.id === id) || UPSCALE_MODELS[0];
}

// ── Device ───────────────────────────────────────────────────────────────────
export const BG_DEVICE_OPTIONS = [
  { value: "cpu", label: "CPU / Stable", help: "CPU / Stable: safest, slower, best while using PC." },
  { value: "gpu", label: "GPU / Experimental", help: "GPU / Experimental: fastest if it works, may OOM or make PC lag." },
  { value: "gpu_auto", label: "GPU + CPU fallback", help: "GPU + CPU fallback: tries GPU first, switches to CPU if GPU runs out of memory." },
];

// Unknown modes fall back to the legacy force_cpu flag when present, else CPU.
export function normalizeBgDeviceMode(value, processing = {}) {
  if (BG_DEVICE_OPTIONS.some(option => option.value === value)) return value;
  if (Object.prototype.hasOwnProperty.call(processing ?? {}, "force_cpu")) {
    return processing.force_cpu ? "cpu" : "gpu_auto";
  }
  return "cpu";
}

export function bgDeviceOption(mode) {
  return BG_DEVICE_OPTIONS.find(option => option.value === mode) || BG_DEVICE_OPTIONS[0];
}
