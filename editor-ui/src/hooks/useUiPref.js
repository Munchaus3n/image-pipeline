import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { getSettings, patchSettings } from "../api.js";

// Small persisted store for layout preferences (panel widths, collapsed sections,
// list sort...). Values live in settings.json under `ui`, mirrored in localStorage
// so the first paint already has them.

const LOCAL_KEY = "cutout-ui-prefs";
const SAVE_DELAY_MS = 400;

function readLocal() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCAL_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocal(value) {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(value));
  } catch {
    void 0;
  }
}

let prefs = readLocal();
let loadStarted = false;
let saveTimer = null;
let pending = {};
const listeners = new Set();

function emit() {
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function flush() {
  saveTimer = null;
  const patch = pending;
  pending = {};
  if (Object.keys(patch).length === 0) return;
  patchSettings({ ui: patch }).catch(() => {});
}

export function setUiPref(key, value) {
  prefs = { ...prefs, [key]: value };
  writeLocal(prefs);
  pending[key] = value;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, SAVE_DELAY_MS);
  emit();
}

// Pull saved prefs from the backend once. Values changed locally in the meantime win.
export function loadUiPrefs() {
  if (loadStarted) return;
  loadStarted = true;
  getSettings()
    .then((settings) => {
      const saved = settings?.ui;
      if (!saved || typeof saved !== "object") return;
      prefs = { ...saved, ...prefs, ...pending };
      writeLocal(prefs);
      emit();
    })
    .catch(() => {});
}

export function useUiPref(key, fallback) {
  const stored = useSyncExternalStore(subscribe, () => prefs[key]);
  const fallbackRef = useRef(fallback);
  useEffect(() => { fallbackRef.current = fallback; });
  const set = useCallback((next) => {
    const current = prefs[key] === undefined ? fallbackRef.current : prefs[key];
    setUiPref(key, typeof next === "function" ? next(current) : next);
  }, [key]);
  return [stored === undefined ? fallback : stored, set];
}
