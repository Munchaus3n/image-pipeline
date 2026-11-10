// Label for "no output folder chosen". The terminal/browser workflow writes to
// ./output next to the code; the packaged app writes to its data folder
// (for example %LOCALAPPDATA%\Cutout Studio\exports), which /config reports.
import { useEffect, useState } from "react";
import { getConfig } from "./api.js";

export const FALLBACK_OUTPUT_LABEL = "./output";

let labelPromise = null;

export function loadDefaultOutputLabel() {
  if (!labelPromise) {
    labelPromise = getConfig()
      .then(cfg => (cfg?.app_data_root && cfg?.default_output_dir) || FALLBACK_OUTPUT_LABEL)
      .catch(() => {
        labelPromise = null; // retry on the next call (backend may be restarting)
        return FALLBACK_OUTPUT_LABEL;
      });
  }
  return labelPromise;
}

export function useDefaultOutputLabel() {
  const [label, setLabel] = useState(FALLBACK_OUTPUT_LABEL);
  useEffect(() => {
    let cancelled = false;
    loadDefaultOutputLabel().then(value => { if (!cancelled) setLabel(value); });
    return () => { cancelled = true; };
  }, []);
  return label;
}
