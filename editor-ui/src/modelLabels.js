export const BG_MODEL_LABELS = {
  "birefnet-general": "BiRefNet General",
  "birefnet-general-lite": "BiRefNet General Lite",
  "birefnet-massive": "BiRefNet Massive",
  "birefnet-dis": "BiRefNet DIS",
  "birefnet-hrsod": "BiRefNet HRSOD",
};

export const BG_MODEL_OPTIONS = [
  ["birefnet-general", "BiRefNet General"],
  ["birefnet-general-lite", "BiRefNet General Lite"],
  ["birefnet-massive", "BiRefNet Massive"],
  ["birefnet-dis", "BiRefNet DIS"],
  ["birefnet-hrsod", "BiRefNet HRSOD"],
];

export function bgModelLabel(modelId) {
  return BG_MODEL_LABELS[modelId] || modelId;
}

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
