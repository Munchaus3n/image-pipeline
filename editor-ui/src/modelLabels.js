export const BG_MODEL_LABELS = {
  "bria-rmbg": "BRIA RMBG-2.0 (non-commercial)",
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
  ["bria-rmbg", "BRIA RMBG-2.0 (non-commercial)"],
];

export function bgModelLabel(modelId) {
  return BG_MODEL_LABELS[modelId] || modelId;
}
