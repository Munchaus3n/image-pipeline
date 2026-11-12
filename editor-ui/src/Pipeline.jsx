import { useState, useRef, useEffect, useCallback } from "react";
import { apiBase } from "./runtime.js";
import {
  browseFolder, openFolder, previewUrl, errorDetailText,
  getSettings, patchSettings, getRembgModels, getSession, clearSession,
} from "./api.js";
import { bgModelInfo, bgModelLabel, bgDeviceOption, normalizeBgDeviceMode } from "./modelLabels.js";
import { normalizeImagePath, relativePathFromRoot, imageIdForPath } from "./paths.js";
import {
  ArrowRight, ChevronDown, ChevronUp, Clock, FolderOpen, Play, Square, X,
} from "lucide-react";
import PageHeader from "./components/PageHeader.jsx";
import {
  Button, IconButton, MenuList, Popover, ResizablePanel, Section, SegmentedControl, Select,
  Switch, TextField,
} from "./components/ui/index.jsx";
import { useUiPref } from "./hooks/useUiPref.js";
import { useDefaultOutputLabel } from "./defaultOutput.js";
/*
KNOWN LIMITATIONS (web build):
- Focus-based settings reload is a temporary sync workaround; desktop Electron should use explicit app events.
- /api/browse relies on tkinter; Electron should use native dialog APIs.
- Editor refresh still depends on UI state transitions rather than native IPC events.
*/

const BASE = apiBase();
const AUTO_OPEN_EDITOR_AFTER_PROCESS = true;

function addToken(tokens, value) {
  const token = String(value || "").trim();
  if (token) tokens.add(token);
}

function expandedImageTokens(ids, thumbs, inputDir) {
  const tokens = new Set();
  const aliasesById = new Map();

  (Array.isArray(thumbs) ? thumbs : []).forEach((absPath) => {
    const imageId = imageIdForPath(absPath, inputDir);
    const relativePath = relativePathFromRoot(absPath, inputDir);
    const absolutePath = String(absPath || "").trim();
    const normalizedAbsolutePath = normalizeImagePath(absPath);
    const aliases = [imageId, relativePath, absolutePath, normalizedAbsolutePath].filter(Boolean);

    aliasesById.set(imageId, aliases);
    aliasesById.set(normalizedAbsolutePath, aliases);
    aliasesById.set(absolutePath, aliases);
  });

  (Array.isArray(ids) ? ids : [...(ids || [])]).forEach((id) => {
    addToken(tokens, id);
    const normalizedId = normalizeImagePath(id);
    addToken(tokens, normalizedId);
    (aliasesById.get(id) || aliasesById.get(normalizedId) || []).forEach((alias) => addToken(tokens, alias));
  });

  return [...tokens];
}

// Live strip tiles are up to ~168px; 320px previews stay sharp on 2x displays.
const PREVIEW_SLOT_SIZE = 320;

// ── Primitives ────────────────────────────────────────────────────────────────

// Label and control on one line.
function Row({ label, hint, children }) {
  return (
    <div className="pipeline-row">
      <div className="ui-row">
        <span className="ui-row-label">{label}</span>
        <div className="pipeline-row-controls">{children}</div>
      </div>
      {hint ? <p className="ui-hint">{hint}</p> : null}
    </div>
  );
}

// Label above a full-width control.
function Field({ label, htmlFor, hint, children }) {
  return (
    <div className="pipeline-field">
      <label className="ui-row-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <p className="ui-hint">{hint}</p> : null}
    </div>
  );
}

function FolderInput({ id, value, onChange, placeholder, recent = [], onRemember }) {
  const [recentOpen, setRecentOpen] = useState(false);
  const recentRef = useRef(null);
  const browse = useCallback(async () => {
    try {
      const { path } = await browseFolder(value);
      if (path) {
        onChange(path);
        onRemember?.(path);
      }
    } catch { void 0; }
  }, [value, onChange, onRemember]);

  return (
    <div className="pipeline-folder-input">
      <TextField
        id={id}
        mono
        className="pipeline-path-field"
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={() => onRemember?.(value)}
        placeholder={placeholder}
        title={value}
      />
      {recent.length > 0 && (
        <>
          <IconButton
            ref={recentRef}
            icon={Clock}
            variant="secondary"
            label="Recent folders"
            aria-haspopup="listbox"
            aria-expanded={recentOpen}
            onClick={() => setRecentOpen(open => !open)}
          />
          <Popover
            open={recentOpen}
            onClose={() => setRecentOpen(false)}
            anchorRef={recentRef}
            width={320}
            align="end"
            label="Recent folders"
            className="pipeline-recent"
          >
            <MenuList
              items={recent.map(path => ({ value: path, label: path }))}
              value={value}
              onSelect={(path) => {
                onChange(path);
                onRemember?.(path);
                setRecentOpen(false);
              }}
            />
          </Popover>
        </>
      )}
      <IconButton icon={FolderOpen} variant="secondary" label="Browse folder" onClick={browse} />
    </div>
  );
}

// ── Pipeline hook ─────────────────────────────────────────────────────────────

function telemetryTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

let telemetrySeq = 0;

// Each entry gets a unique id so log rows keep stable React keys while the log is trimmed.
function telemetryEntry(raw, kind = "info") {
  telemetrySeq += 1;
  return { id: telemetrySeq, raw, kind, time: telemetryTimestamp() };
}

function telemetryLabel(...parts) {
  return parts.join(" \u00b7 ");
}

function appendTelemetryEntry(setLog, entry, { clearPending = false } = {}) {
  setLog(prev => {
    const entries = clearPending ? prev.filter(item => item.kind !== "pending") : prev;
    return [...entries.slice(-800), entry];
  });
}

function normalizeTelemetryLine(raw) {
  return String(raw ?? "")
    .replace(/[│┃║]/gu, " ")
    .replace(/[┌┐└┘─═╔╗╚╝╟╢╤╧╪╞╡╒╕╘╛╭╮╰╯╠╣╦╩╬━┬┴├┤┼┏┓┗┛]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isTelemetryNoise(raw) {
  const original = String(raw ?? "").trim();
  const line = normalizeTelemetryLine(raw);
  if (!line) return true;
  if (/^\[?\d{1,2}:\d{2}(?::\d{2})?\]?$/.test(line)) return true;
  if (/^[\s┌┐└┘│─═╔╗╚╝║╟╢╤╧╪╞╡╒╕╘╛╭╮╰╯╠╣╦╩╬━┃┬┴├┤┼┏┓┗┛]+$/u.test(original)) return true;

  return [
    /image pipeline/i,
    /upscale\s*(?:→|->|â†’)\s*remove bg/i,
    /\bconfiguration\b/i,
    /\bsummary\b/i,
    /^mode\b/i,
    /^images\b/i,
    /^upscale\b/i,
    /^remove bg\b/i,
    /\binput\s*(?:→|->|â†’)/i,
    /\boutput\s*(?:→|->|â†’)/i,
    /\bwipe policy\b/i,
    /previous output cleared/i,
    /custom paths\s*\+\s*wipe off/i,
    /selection:\s*0 removed,\s*0 excluded/i,
    /remove from session:\s*0 token\(s\)/i,
    /exclude from bg:\s*0 token\(s\)/i,
    /removed match\s*(?:·|\u00b7|Â·)\s*0\s*\/\s*0/i,
    /exclude match\s*(?:·|\u00b7|Â·)\s*0\s*\/\s*0/i,
  ].some(pattern => pattern.test(line));
}

function parseMatchCount(payload) {
  const match = String(payload ?? "").match(/(\d+)\s*\/\s*\d+/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

const MACHINE_TOKEN_PREFIXES = [
  "__processing_image__:",
  "__model_loading__:",
  "__model_loaded__:",
  "__bg_device__:",
  "__stage_start__:",
  "__bg_downscale__:",
  "__skip_upscale__:",
  "__err_upscale__:",
  "__ok_upscale__:",
  "__skip_rembg__:",
  "__err_rembg__:",
  "__ok_rembg__:",
  "__err_oom_gpu__:",
  "__total__:",
  "__done__",
];

function extractMachineToken(raw) {
  const line = String(raw ?? "");
  let best = null;
  MACHINE_TOKEN_PREFIXES.forEach((prefix) => {
    const index = line.indexOf(prefix);
    if (index === -1) return;
    if (!best || index < best.index || (index === best.index && prefix.length > best.prefix.length)) {
      best = { index, prefix };
    }
  });
  if (!best) return "";
  return line.slice(best.index).trim();
}

function fileNameFromPath(path = "") {
  return String(path || "").replace(/.*[/\\]/, "");
}

function duplicateReuseCount(raw) {
  const line = normalizeTelemetryLine(raw);
  const match =
    line.match(/\bExact duplicates:?\s*(\d+)\s+reused/i) ||
    line.match(/\bReused\s+(\d+)\s+(?:additional\s+|exact\s+)?duplicate/i);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function telemetryFromRawLine(raw) {
  const duplicateCount = duplicateReuseCount(raw);
  if (duplicateCount > 0) {
    return telemetryEntry(telemetryLabel("Exact duplicates", `${duplicateCount} reused`), "info");
  }

  if (isTelemetryNoise(raw)) return null;

  const line = normalizeTelemetryLine(raw);
  if (/pipeline complete/i.test(line)) return telemetryEntry("Pipeline complete [DONE]", "success");
  if (/pipeline exited with errors/i.test(line)) return telemetryEntry("Pipeline exited with errors [ERROR]", "error");
  if (/gpu oom fallback/i.test(line)) return telemetryEntry(line, "warn");
  if (/initializing ncnn backend/i.test(line)) return telemetryEntry(line, "info");
  if (/loading\b.*\bweights/i.test(line)) return telemetryEntry(line, "info");
  if (/model loaded/i.test(line)) return telemetryEntry(line, "success");
  if (/(error|failed|failure|corrupt|exception|traceback|not found|invalid|size exceeded)/i.test(line)) {
    return telemetryEntry(`${line} [ERROR]`, "error");
  }

  return null;
}

function telemetryStatus(raw) {
  const match = String(raw ?? "").match(/\s(\[(?:DONE|SKIP|ERROR|WARN)\])$/);
  if (!match) return { message: raw, label: "", kind: "" };
  return {
    message: raw.slice(0, match.index),
    label: match[1],
    kind: match[1].slice(1, -1).toLowerCase(),
  };
}

// ── Per-stage ETA and progress ────────────────────────────────────────────────
// Upscale and BG removal run one after another at very different speeds, so each
// stage keeps its own rate. A sample is the time one image really spent between its
// "processing" and "ok" tokens. Skipped images (already done, excluded, big enough)
// add to the done count but are never samples, so a resumed run does not look instant.
// Until a stage has enough live samples, the rate of the last finished run with the
// same settings (a "prior", kept in the UI prefs) is used, so an ETA shows right away.
// The bar is measured in estimated seconds of work, so it agrees with the ETA.

const ETA_STAGES = ["upscale", "rembg"];
const ETA_STAGE_LABEL = { upscale: "upscale", rembg: "BG" };
const ETA_WINDOW = 8;            // recent samples that set the live rate (median)
const ETA_MIN_SAMPLES = 2;       // live samples needed before the live rate replaces the prior
const ETA_SAMPLE_CAP = 200;
const ETA_PRIOR_MIN_SAMPLES = 3; // a run teaches a prior only after this many real images
const ETA_PRIORS_KEY = "process.etaPriors";
const ETA_PRIORS_MAX = 24;
const NO_PRIORS = {};
const DEFAULT_RUN_CONFIG = {
  upscale: true, rembg: true, scale: "2", upscaleModel: "fast", rembgModel: "birefnet-general", bgDeviceMode: "cpu",
};

function emptyStageTiming() {
  const stage = () => ({
    total: 0, count: 0,
    curId: "", curStart: 0, discardNext: false,   // image in progress
    samples: [],
    loadStart: 0, loadSec: 0, modelLoaded: false,  // BG model load
  });
  return { upscale: stage(), rembg: stage() };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function etaPriorKey(stageName, cfg) {
  return stageName === "upscale"
    ? `up:${cfg.scale}:${cfg.upscaleModel}`
    : `bg:${cfg.rembgModel}:${cfg.bgDeviceMode}`;
}

function stageRate(t, prior) {
  if (t.samples.length >= ETA_MIN_SAMPLES) return median(t.samples.slice(-ETA_WINDOW));
  return prior?.perImage > 0 ? prior.perImage : 0;
}

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (s < 3600) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

// One pure snapshot of ETA and progress for the stages this run started with.
function snapshotProgress(timing, cfg, priors, now) {
  // BG removal reports its own total only when it starts; until then assume the upscale total.
  const fallbackTotal = timing.upscale.total || timing.rembg.total;
  let seconds = 0;
  const pending = [];
  const counts = {};
  let work = 0, workDone = 0;     // estimated seconds (used when every active stage has a rate)
  let units = 0, unitsDone = 0;   // image counts (fallback when a stage has no rate yet)
  let allRated = true;

  for (const name of ETA_STAGES) {
    if (!cfg[name]) continue;
    const t = timing[name];
    const total = t.total || fallbackTotal;
    counts[name] = { count: t.count, total };
    if (!total) { pending.push(name); allRated = false; continue; }

    const remaining = Math.max(0, total - t.count);
    const inProgress = t.curStart > 0 && remaining > 0;
    units += total;
    unitsDone += Math.min(total, t.count) + (inProgress ? 0.25 : 0);

    const prior = priors?.[etaPriorKey(name, cfg)];
    const rate = stageRate(t, prior);
    if (!rate) {
      allRated = false;
      if (remaining) pending.push(name);
      continue;
    }

    const spent = inProgress ? (now - t.curStart) / 1000 : 0;
    const share = inProgress ? Math.min(spent / rate, 0.95) : 0;
    work += total * rate;
    workDone += (Math.min(total, t.count) + share) * rate;

    // BG model load (and first-run warm-up) happens before its first image.
    let loadLeft = 0;
    if (name === "rembg") {
      const loadSec = t.modelLoaded ? t.loadSec : (prior?.loadSec || 0);
      const loadElapsed = t.modelLoaded ? loadSec : Math.min(loadSec, t.loadStart ? (now - t.loadStart) / 1000 : 0);
      work += loadSec;
      workDone += loadElapsed;
      loadLeft = loadSec - loadElapsed;
    }
    if (!remaining) continue;
    // The image in progress counts down but never below 15% of a normal image while it runs.
    seconds += loadLeft
      + (remaining - (inProgress ? 1 : 0)) * rate
      + (inProgress ? Math.max(rate * 0.15, rate - spent) : 0);
  }

  const ratio = allRated && work > 0 ? workDone / work : (units > 0 ? unitsDone / units : 0);
  return { seconds: Math.round(seconds), pending, counts, ratio: Math.min(1, Math.max(0, ratio)) };
}

function usePipeline() {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [outcome, setOutcome] = useState(null); // "done" | "failed" | "stopped" once a run has ended
  const [log, setLog] = useState([]);
  const [errors, setErrors] = useState([]);
  const [imageDone, setImageDone] = useState(0);
  const [imageError, setImageError] = useState(0);
  const [totalImages, setTotalImages] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [stage, setStage] = useState(null);
  const [upStats, setUpStats] = useState({ done: 0, skip: 0, err: 0 });
  const [bgStats, setBgStats] = useState({ done: 0, skip: 0, err: 0 });
  const [oomGpuCount, setOomGpuCount] = useState(0);
  const [eta, setEta] = useState(null);
  const [runConfig, setRunConfig] = useState(DEFAULT_RUN_CONFIG);
  const [previewPath, setPreviewPath] = useState("");
  const [livePreviewStrip, setLivePreviewStrip] = useState([]);
  const [priors, setPriors] = useUiPref(ETA_PRIORS_KEY, NO_PRIORS);

  const abortRef    = useRef(null);
  const logRef      = useRef(null);
  const timerRef    = useRef(null);
  const startRef    = useRef(null);
  const runningRef  = useRef(false);   // synchronous guard against a double start
  const errSet      = useRef(new Set());
  const stageRef    = useRef("upscale");
  const recentLog   = useRef([]);
  const previewPathById = useRef(new Map());
  const previewPathRef = useRef("");
  const finalStageRef = useRef("rembg");
  const completedImageSet = useRef(new Set());
  const completionLoggedRef = useRef(false);
  const stageTimingRef = useRef(emptyStageTiming());
  const runCfgRef = useRef(DEFAULT_RUN_CONFIG);
  const progressMaxRef = useRef(0);    // the bar never moves backward within a run
  const priorsRef = useRef(priors);

  useEffect(() => { priorsRef.current = priors; }, [priors]);

  const refreshEta = useCallback(() => {
    const snap = snapshotProgress(stageTimingRef.current, runCfgRef.current, priorsRef.current, Date.now());
    progressMaxRef.current = Math.max(progressMaxRef.current, snap.ratio);
    setEta({ ...snap, ratio: progressMaxRef.current });
  }, []);

  const markImageStart = useCallback((stageName, id) => {
    const t = stageTimingRef.current[stageName];
    t.curId = id;
    t.curStart = Date.now();
  }, []);

  const recordStageDone = useCallback((stageName, id, kind) => {
    const t = stageTimingRef.current[stageName];
    // Only a finished image that really ran is a sample; skips and quick failures are not.
    if (kind === "done" && t.curId === id && t.curStart && !t.discardNext) {
      t.samples = [...t.samples, (Date.now() - t.curStart) / 1000].slice(-ETA_SAMPLE_CAP);
    }
    if (t.curId === id) {
      t.curId = "";
      t.curStart = 0;
      t.discardNext = false;
    }
    t.count += 1;
    refreshEta();
  }, [refreshEta]);

  // Remember this run's speed for the next run with the same settings.
  const savePriors = useCallback(() => {
    const cfg = runCfgRef.current;
    const timing = stageTimingRef.current;
    const next = { ...priorsRef.current };
    let changed = false;
    for (const name of ETA_STAGES) {
      if (!cfg[name]) continue;
      const t = timing[name];
      if (t.samples.length < ETA_PRIOR_MIN_SAMPLES) continue;
      const key = etaPriorKey(name, cfg);
      const old = next[key];
      delete next[key]; // re-added last, so the oldest entries are the ones trimmed
      const perImage = median(t.samples);
      const loadSec = name === "rembg" && t.modelLoaded ? t.loadSec : (old?.loadSec || 0);
      next[key] = {
        perImage: Math.round((old?.perImage ? (old.perImage + perImage) / 2 : perImage) * 100) / 100,
        loadSec: Math.round(loadSec * 10) / 10,
      };
      changed = true;
    }
    if (changed) setPriors(Object.fromEntries(Object.entries(next).slice(-ETA_PRIORS_MAX)));
  }, [setPriors]);

  const endRun = useCallback((result) => {
    runningRef.current = false;
    setRunning(false);
    setOutcome(result);
    savePriors();
  }, [savePriors]);

  useEffect(() => {
    // Follow the end of the log only while the user is already at the bottom.
    const el = logRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 48) el.scrollTop = el.scrollHeight;
  }, [log]);
  useEffect(() => {
    if (running) {
      startRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
        refreshEta();
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [running, refreshEta]);

  const classify = useCallback((raw) => {
    if (/→ bg_removed/.test(raw) || /→ upscaled/.test(raw)) return "ok";
    if (/✓/.test(raw)) return "ok";
    if (/✗|Error|error|failed on |Traceback|Exception/i.test(raw)) return "error";
    if (/⚠|warn/i.test(raw)) return "warn";
    if (/↷|skip|already (upscaled|processed)/i.test(raw)) return "skip";
    if (/Stage \d|─{4,}|═{4,}/.test(raw)) return "section";
    return "info";
  }, []);

  // Live strip tiles are keyed by image id (relative path), so same-named files stay apart.
  const pushLivePreview = useCallback((id, path = "", status = "processing", label = "") => {
    if (!id) return;
    setLivePreviewStrip(prev => {
      const existing = prev.find(item => item.id === id);
      const next = [{
        id,
        name: fileNameFromPath(id),
        path: path || existing?.path || "",
        status: status || existing?.status || "processing",
        label: label || existing?.label || "",
      }, ...prev.filter(item => item.id !== id)];
      return next.slice(0, 4);
    });
  }, []);

  const revealKnownPreview = useCallback((id, status = "done", label = "") => {
    const path = previewPathById.current.get(id) || "";
    if (path) {
      previewPathRef.current = path;
      setPreviewPath(path);
    }
    pushLivePreview(id, path, status, label);
  }, [pushLivePreview]);

  const markFinalImage = useCallback((stageName, id) => {
    if (!id || stageName !== finalStageRef.current || completedImageSet.current.has(id)) return;
    completedImageSet.current.add(id);
    setImageDone(completedImageSet.current.size);
  }, []);

  // One image finished a stage: kind is "done" | "skip" | "err".
  const finishImage = useCallback((stageName, kind, id) => {
    const status = { done: ["done", "DONE", "success"], skip: ["skip", "SKIP", "skip"], err: ["error", "ERROR", "error"] }[kind];
    revealKnownPreview(id, status[0], status[1]);
    if (kind === "err") {
      const key = `${stageName}:${id}`;
      if (!errSet.current.has(key)) { errSet.current.add(key); setImageError(errSet.current.size); }
    }
    markFinalImage(stageName, id);
    (stageName === "rembg" ? setBgStats : setUpStats)(s => ({ ...s, [kind]: s[kind] + 1 }));
    recordStageDone(stageName, id, kind);
    const what = stageName === "rembg" ? "BG removal" : "upscale";
    appendTelemetryEntry(
      setLog,
      telemetryEntry(telemetryLabel(fileNameFromPath(id), `${what} [${status[1]}]`), status[2]),
      { clearPending: true }
    );
  }, [markFinalImage, recordStageDone, revealKnownPreview]);

  const appendLine = useCallback((raw) => {
    raw = extractMachineToken(raw) || raw;
    // ── Structured machine-readable tokens ──────────────────────────────────
    if (raw.startsWith("__total__:")) {
      const n = parseInt(raw.slice(10), 10);
      if (!isNaN(n)) {
        setTotalImages(n);
        stageTimingRef.current[stageRef.current === "rembg" ? "rembg" : "upscale"].total = n;
        refreshEta();
      }
      return;
    }
    const finished = raw.match(/^__(ok|skip|err)_(upscale|rembg)__:(.*)$/);
    if (finished) {
      finishImage(finished[2], { ok: "done", skip: "skip", err: "err" }[finished[1]], finished[3]);
      return;
    }
    if (raw.startsWith("__err_oom_gpu__:")) {
      const id = raw.slice(16);
      revealKnownPreview(id, "error", "OOM");
      setOomGpuCount(c => c + 1);
      // This image's time includes the failed GPU attempt and the CPU session build, and
      // earlier samples were GPU speed: start the BG rate again on CPU.
      const t = stageTimingRef.current.rembg;
      t.samples = [];
      t.discardNext = true;
      refreshEta();
      appendTelemetryEntry(setLog, telemetryEntry(telemetryLabel(fileNameFromPath(id), "GPU OOM fallback [WARN]"), "warn"), { clearPending: true });
      return;
    }

    if (raw.startsWith("__exclude_match__:")) {
      const matchedCount = parseMatchCount(raw.slice(18));
      if (matchedCount > 0) {
        appendTelemetryEntry(setLog, telemetryEntry(telemetryLabel("Excluded from BG", `${matchedCount} matched`), "info"));
      }
      return;
    }
    if (raw.startsWith("__skip_filter__:")) {
      const matchedCount = parseMatchCount(raw.slice(16));
      if (matchedCount > 0) {
        appendTelemetryEntry(setLog, telemetryEntry(telemetryLabel("Removed from session", `${matchedCount} matched`), "info"));
      }
      return;
    }

    if (raw.startsWith("__stage_start__:")) {
      const stageName = raw.slice(16).trim();
      if (stageName === "upscale" || stageName === "rembg") {
        stageRef.current = stageName;
        setStage(stageName);
        appendTelemetryEntry(
          setLog,
          telemetryEntry(stageName === "upscale" ? "Stage 1 · Upscaling" : "Stage 2 · Background removal", "info")
        );
      } else if (stageName === "finalize") {
        stageRef.current = "finalize";
        setStage("finalize");
        appendTelemetryEntry(setLog, telemetryEntry("Finishing up", "info"));
        refreshEta();
      }
      return;
    }

    if (raw.startsWith("__model_loading__:")) {
      const [model = "model", device = ""] = raw.slice(18).split(":");
      stageTimingRef.current.rembg.loadStart = Date.now();
      appendTelemetryEntry(setLog, telemetryEntry(telemetryLabel("Loading model", [model, device].filter(Boolean).join(" · ")), "info"));
      return;
    }

    if (raw.startsWith("__model_loaded__:")) {
      const [model = "model", device = "", seconds = ""] = raw.slice(17).split(":");
      const t = stageTimingRef.current.rembg;
      const loadSec = Number.parseFloat(seconds);
      t.modelLoaded = true;
      t.loadSec = Number.isFinite(loadSec) ? loadSec : (t.loadStart ? (Date.now() - t.loadStart) / 1000 : 0);
      refreshEta();
      if (seconds) appendTelemetryEntry(setLog, telemetryEntry(`Model loaded in ${seconds}s`, "success"));
      appendTelemetryEntry(setLog, telemetryEntry(telemetryLabel("Model loaded", [model, device].filter(Boolean).join(" · ")), "success"));
      return;
    }

    if (raw.startsWith("__bg_device__:")) {
      const device = raw.slice(14).trim();
      const kind = /oom/i.test(device) ? "warn" : "info";
      if (/switched to cpu/i.test(device)) {
        // The BG speed on the new device is unknown; samples so far were another device.
        const t = stageTimingRef.current.rembg;
        t.samples = [];
        if (t.curStart > 0) t.discardNext = true;
        refreshEta();
      }
      appendTelemetryEntry(setLog, telemetryEntry(`BG device: ${device}`, kind));
      return;
    }

    if (raw.startsWith("__bg_downscale__:")) {
      const [fname = "image", resize = ""] = raw.slice(17).split(":").filter(Boolean);
      appendTelemetryEntry(setLog, telemetryEntry(telemetryLabel(fname, `BG safety downscale ${resize}`), "warn"));
      return;
    }

    if (raw.startsWith("__processing_image__:")) {
      // "<stage>:<id>|<absolute path>"; older builds sent "<stage>:<absolute path>".
      const payload = raw.slice(21);
      const splitAt = payload.indexOf(":");
      const stageName = splitAt >= 0 ? payload.slice(0, splitAt) : stageRef.current;
      const rest = splitAt >= 0 ? payload.slice(splitAt + 1) : payload;
      const barAt = rest.indexOf("|");
      const fullPath = barAt >= 0 ? rest.slice(barAt + 1) : rest;
      const id = barAt >= 0 ? rest.slice(0, barAt) : fileNameFromPath(fullPath);
      const normalizedStage = stageName === "rembg" ? "rembg" : "upscale";
      stageRef.current = normalizedStage;
      setStage(normalizedStage);
      setPreviewPath(fullPath);
      previewPathRef.current = fullPath;
      previewPathById.current.set(id, fullPath);
      markImageStart(normalizedStage, id);
      pushLivePreview(id, fullPath, "processing", normalizedStage === "rembg" ? "BG running..." : "processing...");
      appendTelemetryEntry(
        setLog,
        telemetryEntry(telemetryLabel(fileNameFromPath(id), normalizedStage === "rembg" ? "BG removal started" : "upscale started"), "pending")
      );
      return;
    }

    // ── Human-readable log lines ─────────────────────────────────────────────
    if (raw.startsWith("__done__")) {
      if (completionLoggedRef.current) return;
      completionLoggedRef.current = true;
      const ok = raw.includes("exit=0");
      const entry = telemetryEntry(ok ? "Pipeline complete [DONE]" : "Pipeline exited with errors [ERROR]", ok ? "success" : "error");
      appendTelemetryEntry(
        setLog,
        entry,
        { clearPending: true }
      );
      if (startRef.current) {
        const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startRef.current) / 1000));
        appendTelemetryEntry(setLog, telemetryEntry(`Batch completed in ${formatDuration(elapsedSeconds)}`, ok ? "success" : "error"));
      }
      if (!ok) {
        setErrors(prev => [...prev.slice(-200), { raw: entry.raw, kind: entry.kind, context: [...recentLog.current] }]);
      }
      return;
    }
    if (/Pipeline complete/i.test(raw)) {
      return;
    }
    if (/Pipeline exited with errors/i.test(raw)) {
      appendTelemetryEntry(setLog, telemetryEntry("Pipeline exited with errors [ERROR]", "error"), { clearPending: true });
      return;
    }

    const kind = classify(raw);
    const telemetryLine = telemetryFromRawLine(raw);
    if (telemetryLine) {
      appendTelemetryEntry(setLog, telemetryLine, { clearPending: telemetryLine.kind !== "info" });
    }

    recentLog.current = [...recentLog.current.slice(-4), raw];

    if (/Stage 1|Upscaling/.test(raw)) {
      stageRef.current = "upscale";
      setStage("upscale");
    } else if (/Stage 2|Background Removal/.test(raw)) {
      stageRef.current = "rembg";
      setStage("rembg");
    }

    if (kind === "error") {
      setErrors(prev => {
        if (prev[prev.length - 1]?.raw === raw) return prev;
        return [...prev.slice(-200), { raw, kind, context: [...recentLog.current.slice(0, -1)] }];
      });
    }
  }, [classify, finishImage, markImageStart, pushLivePreview, refreshEta, revealKnownPreview]);

  const start = useCallback(async ({ folderMode, doUpscale, scale, doRembg, inputDir, outputDir, excludeList = [], skipList = [], rembgModel = "", bgDeviceMode = "cpu", upscaleModel = "fast", resume = false, upscaleMaxPx = 0, reuseExactDuplicates = true }) => {
    if (runningRef.current) return;
    runningRef.current = true;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const cfg = {
      upscale: Boolean(doUpscale), rembg: Boolean(doRembg), scale: String(scale), upscaleModel,
      rembgModel: rembgModel || "birefnet-general", bgDeviceMode: normalizeBgDeviceMode(bgDeviceMode),
    };
    // What this run started with. The bar and labels read this, not the live toggles,
    // so editing settings mid-run cannot make the bar jump.
    runCfgRef.current = cfg;
    setRunConfig(cfg);
    progressMaxRef.current = 0;
    setLog([]); setErrors([]);
    setImageDone(0); setImageError(0);
    setTotalImages(0);
    setElapsed(0); setDone(false); setOutcome(null); setRunning(true);
    setStage(null);
    setUpStats({ done: 0, skip: 0, err: 0 });
    setBgStats({ done: 0, skip: 0, err: 0 });
    setOomGpuCount(0);
    setEta(null);
    stageTimingRef.current = emptyStageTiming();
    setPreviewPath("");
    setLivePreviewStrip([]);
    stageRef.current = "upscale";
    recentLog.current = [];
    errSet.current = new Set();
    completedImageSet.current = new Set();
    completionLoggedRef.current = false;
    previewPathRef.current = "";
    finalStageRef.current = doRembg ? "rembg" : "upscale";
    previewPathById.current = new Map();

    try {
      const r = await fetch(`${BASE}/pipeline/run`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_mode: folderMode, do_upscale: doUpscale, scale,
          do_rembg: doRembg, input_dir: inputDir.trim(), output_dir: outputDir.trim(),
          exclude_rembg: excludeList, skip_files: skipList, rembg_model: rembgModel, resume,
          bg_device_mode: normalizeBgDeviceMode(bgDeviceMode),
          upscale_max_px: upscaleMaxPx,
          reuse_exact_duplicates: reuseExactDuplicates,
        }),
        signal: ctrl.signal,
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({ detail: r.statusText }));
        appendLine(`Error: ${errorDetailText(e?.detail) || r.statusText || r.status}`);
        endRun("failed"); return;
      }
      if (!r.body) {
        appendLine("Error: Pipeline response stream was empty.");
        endRun("failed");
        return;
      }
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = "";
      let finished = false;
      while (true) {
        const { done: sd, value } = await reader.read();
        if (sd) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const msg = line.slice(6);
          const token = extractMachineToken(msg);
          if (token.startsWith("__done__")) {
            finished = true;
            appendLine(msg);
            setStage("done"); setDone(true);
            endRun(/exit=0\b/.test(msg) ? "done" : "failed");
          } else if (msg.startsWith("__error__")) {
            finished = true;
            appendLine(`Error: ${msg.replace("__error__ ", "")}`);
            endRun("failed");
          } else {
            appendLine(msg);
          }
        }
      }
      if (!finished) {
        appendLine("Error: Pipeline stream ended before completion.");
        endRun("failed");
      }
    } catch (e) {
      if (e.name === "AbortError") return; // stop() ends the run itself
      appendLine(`Connection error: ${e.message}`);
      endRun("failed");
    }
  }, [appendLine, endRun]);

  const stop = useCallback(async () => {
    abortRef.current?.abort();
    // Wait for the backend to confirm, so an immediate re-run does not hit "already running".
    try { await fetch(`${BASE}/pipeline/stop`, { method: "POST" }); } catch { void 0; }
    appendTelemetryEntry(setLog, telemetryEntry("Stopped by user. [WARN]", "warn"), { clearPending: true });
    endRun("stopped");
  }, [endRun]);

  return {
    running, done, outcome, runConfig, log, errors, imageDone, imageError,
    totalImages, elapsed, stage,
    upStats, bgStats, oomGpuCount, previewPath, livePreviewStrip, eta,
    logRef, start, stop
  };
}

// Zone 1: Live preview strip

function PipelinePreviewStrip({ previewPath, livePreviewStrip, imageDone, totalImages }) {
  const totalLabel = totalImages > 0 ? totalImages : "-";
  const processedLabel = `${imageDone}/${totalLabel} complete`;
  const stripItems = Array.isArray(livePreviewStrip) ? livePreviewStrip : [];
  let sourceItems = stripItems
    .map(item => ({
      path: item?.path || "",
      name: item?.name || "",
      status: item?.status || "processing",
      label: item?.label || "",
    }))
    .filter(item => item.path);

  if (previewPath) {
    const previewItem = {
      path: previewPath,
      name: previewPath.replace(/.*[/\\]/, ""),
      status: "processing",
      label: "processing...",
    };
    const hasPreviewInStrip = sourceItems.some(item => item.path === previewPath);
    if (!hasPreviewInStrip) {
      sourceItems = [previewItem, ...sourceItems.filter(item => item.path !== previewPath)];
    }
  }
  const slotItems = [
    ...sourceItems.slice(0, 4),
    ...Array.from({ length: Math.max(0, 4 - sourceItems.length) }, (_, index) => ({
      placeholder: true,
      label: index === 0 && sourceItems.length === 0 ? "Images appear here during processing." : "",
    })),
  ].slice(0, 4);

  return (
    <section className="pipeline-card pipeline-preview-strip">
      <header className="pipeline-card-head">
        <h2 className="pipeline-card-title">Live stream</h2>
        <span className="ui-badge">{processedLabel}</span>
      </header>
      <div className="pipeline-preview-grid">
        {slotItems.map((item, idx) => (
          <PipelinePreviewSlot key={item.path || `preview-placeholder-${idx}`} item={item} />
        ))}
      </div>
    </section>
  );
}

function PipelinePreviewSlot({ item }) {
  const src = item?.path ? previewUrl(item.path, PREVIEW_SLOT_SIZE) : "";
  const hasImage = Boolean(src);
  const fileLabel = item?.name || "";
  const placeholderLabel = item?.label || "";
  const status = item?.status || "processing";
  const statusLabel = item?.label || (status === "processing" ? "processing..." : status.toUpperCase());

  return (
    <div className={`pipeline-preview-slot is-${status}`}>
      {hasImage ? (
        <>
          <img className="pipeline-preview-image" src={src} alt={fileLabel} />
          <span className={`pipeline-preview-status is-${status}`}>{statusLabel}</span>
          {fileLabel && <span className="pipeline-preview-name" title={fileLabel}>{fileLabel}</span>}
        </>
      ) : (
        <div className="pipeline-preview-placeholder">{placeholderLabel}</div>
      )}
    </div>
  );
}

function SmStat({ label, value, tone }) {
  return (
    <div className="pipeline-stat">
      <div className={`pipeline-stat-value${tone ? ` is-${tone}` : ""}`}>{value}</div>
      <div className="pipeline-stat-label">{label}</div>
    </div>
  );
}


// Zone 2: Per-stage stats bar

function Zone2({ upStats, bgStats, totalImages, elapsed, running, outcome, stage, doUpscale, doRembg, oomGpuCount = 0, eta = null }) {
  const n = Math.max(0, totalImages || 0);

  const upProcessed = upStats.done + upStats.skip + upStats.err;
  const bgProcessed = bgStats.done + bgStats.skip + bgStats.err;
  const hasBothStages = doUpscale && doRembg;
  const processedImages = doRembg ? bgProcessed : upProcessed;
  const totalErrors = upStats.err + bgStats.err;

  // Only a run that really finished shows 100%. Everything else stops short of it.
  const succeeded = outcome === "done";
  const progressPct = succeeded ? 100 : Math.min(99, Math.floor((eta?.ratio ?? 0) * 100));

  const pendingEtaLabel = (eta?.pending ?? []).map(name => ETA_STAGE_LABEL[name]).join(" + ");
  let etaLabel;
  if (succeeded) etaLabel = "Finished";
  else if (outcome === "failed") etaLabel = "Run failed";
  else if (outcome === "stopped") etaLabel = "Stopped";
  else if (stage === "finalize") etaLabel = "Finishing…";
  else if (!eta || (eta.pending.length && !eta.seconds)) etaLabel = "ETA estimating…";
  else if (eta.pending.length) etaLabel = `ETA ${formatDuration(eta.seconds)} + ${pendingEtaLabel} estimating…`;
  else if (eta.seconds <= 0) etaLabel = "Finishing…";
  else etaLabel = `ETA ${formatDuration(eta.seconds)}`;

  const stageWord = { upscale: "Upscaling", rembg: "Removing background" }[stage];
  const stageCount = eta?.counts?.[stage];
  let countLabel;
  if (n === 0) countLabel = "count pending";
  else if (running && stage === "finalize") countLabel = "Finishing…";
  else if (running && stageWord && stageCount?.total) countLabel = `${stageWord} ${stageCount.count}/${stageCount.total}`;
  else countLabel = `${processedImages}/${n} images processed`;

  let stagePill;
  if (outcome === "done") stagePill = "Completed";
  else if (outcome === "failed") stagePill = "Failed";
  else if (outcome === "stopped") stagePill = "Stopped";
  else if (stage === "finalize") stagePill = "Finishing";
  else if (stage === "rembg") stagePill = hasBothStages ? "Stage 2/2 · Remove BG" : "Remove BG";
  else stagePill = hasBothStages ? "Stage 1/2 · Upscaling" : doUpscale ? "Upscaling" : "Remove BG";

  const title = succeeded
    ? "Batch complete"
    : outcome === "failed" ? "Batch failed"
      : outcome === "stopped" ? "Batch stopped"
        : "Processing batch…";

  return (
    <section className="pipeline-card pipeline-progress-card">
      <header className="pipeline-card-head">
        <span className={`pipeline-progress-stage-pill ${succeeded ? "is-done" : "is-active"}`}>{stagePill}</span>
        <span className="pipeline-progress-percent">{progressPct}%</span>
      </header>

      <h2 className="pipeline-progress-title">{title}</h2>

      <div
        className="pipeline-progress-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progressPct}
        aria-label="Batch progress"
      >
        <div style={{ width: `${progressPct}%` }} />
      </div>

      <div className="pipeline-progress-meta">
        <span>{countLabel}</span>
        <span>{etaLabel}</span>
        <span>elapsed {formatDuration(elapsed)}</span>
        {oomGpuCount > 0 && <span>OOM fallback {oomGpuCount}</span>}
        {totalErrors > 0 && <span className="is-bad">{totalErrors} error{totalErrors > 1 ? "s" : ""}</span>}
      </div>

      <div className="pipeline-progress-stats">
        <SmStat label="Upscale" value={upProcessed} tone={doUpscale && upProcessed > 0 ? "ok" : ""} />
        <SmStat label="Remove BG" value={bgProcessed} tone={doRembg && bgProcessed > 0 ? "ok" : ""} />
        <SmStat label="Errors" value={totalErrors} tone={totalErrors > 0 ? "bad" : ""} />
      </div>
    </section>
  );
}

function ReadyCard({ nothingSelected, doUpscale, doRembg, activeExcludeCount, skipCount, canvasSize, inputDir }) {
  const activeStages = [
    doUpscale ? "Upscale" : null,
    doRembg ? "Remove BG" : null,
  ].filter(Boolean);

  return (
    <section className={`pipeline-card pipeline-ready-card ${nothingSelected ? "is-disabled" : "is-ready"}`}>
      <Play size={20} className="pipeline-ready-icon" aria-hidden="true" />
      <div className="pipeline-ready-copy">
        <h2 className="pipeline-ready-title">
          {nothingSelected ? "Select stages to continue" : "Ready to process"}
        </h2>
        <p className="pipeline-ready-subtitle">
          {nothingSelected ? "Enable at least one stage to start." : "Press Run pipeline to begin."}
        </p>

        <div className="pipeline-ready-meta">
          {!nothingSelected && activeStages.length > 0 && (
            <span className="ui-badge">{activeStages.join(" + ")}</span>
          )}
          {activeExcludeCount > 0 && <span className="ui-badge">{activeExcludeCount} excluded</span>}
          {skipCount > 0 && <span className="ui-badge">{skipCount} skipped</span>}
          {canvasSize && <span className="ui-badge">{canvasSize}px canvas</span>}
        </div>

        <p className={`pipeline-ready-source ${inputDir ? "is-ready" : "is-missing"}`}>
          {inputDir ? "Input source configured." : "Input source missing. Set it on the left or pick a folder on the Input screen."}
        </p>
      </div>
    </section>
  );
}

// ── ActivityPanel ─────────────────────────────────────────────────────────────

function ActivityPanel({ logRef, log, running, open, setOpen }) {
  const entries = log.filter(Boolean);

  return (
    <section className={`pipeline-card pipeline-activity-panel ${open ? "is-open" : "is-collapsed"}`}>
      <header className="pipeline-card-head">
        <h2 className="pipeline-card-title">Activity</h2>
        <span className="ui-badge">{entries.length}</span>
        <span className="pipeline-spacer" />
        <IconButton
          icon={open ? ChevronDown : ChevronUp}
          label={open ? "Collapse activity log" : "Expand activity log"}
          size="s"
          aria-expanded={open}
          onClick={() => setOpen(v => !v)}
        />
      </header>
      {open && (
        <div className="pipeline-log-list pipeline-activity-console" ref={logRef}>
          {entries.length === 0 ? (
            <div className="pipeline-log-empty">{running ? "Waiting for pipeline activity…" : "Configure and press Run pipeline."}</div>
          ) : entries.map((entry) => {
            const status = telemetryStatus(entry.raw);
            return (
              <div key={entry.id} className={`pipeline-activity-entry is-${entry.kind || "info"}`}>
                <span className="pipeline-activity-time">{entry.time || telemetryTimestamp()}</span>
                <span className="pipeline-activity-message">
                  {status.message}
                  {status.label && (
                    <span className={`pipeline-activity-status is-${status.kind}`}> {status.label}</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Pipeline({
  onGoToEditor,
  onPipelineDone,
  inputDir,
  setInputDir,
  outputDir,
  setOutputDir,
  excludeTags,
  removedImages,
  thumbs = [],
  recentInputDirs = [],
  recentOutputDirs = [],
  rememberInputDir,
  rememberOutputDir,
}) {
  const defaultOutputLabel = useDefaultOutputLabel();
  const [folderMode, setFolderMode] = useState("bulk");
  const [doUpscale, setDoUpscale] = useState(true);
  const [scale, setScale] = useState("2");
  const [doRembg, setDoRembg] = useState(true);
  const [canvasSize, setCanvasSize] = useState("1440");
  const [rembgModel, setRembgModel] = useState("birefnet-general");
  const [bgDeviceMode, setBgDeviceMode] = useState("cpu");
  const [upscaleModel, setUpscaleModel] = useState("fast"); // Settings owns it; the ETA needs it to pick its speed history
  const [upscaleMaxPx, setUpscaleMaxPx] = useState("3600");
  const [reuseExactDuplicates, setReuseExactDuplicates] = useState(true);
  const [rembgModels, setRembgModels] = useState(["birefnet-general"]);
  const [logOpen, setLogOpen] = useUiPref("process.logOpen", true);
  const [resumeSession, setResumeSession] = useState(null);
  const [showResume, setShowResume] = useState(false);
  const doneNotifiedRef = useRef(false);

  // BUG-15 FIX: split settings loading into two concerns:
  // 1. loadSettings — loads non-path settings (model, flags, sizes).
  // 2. A mount-only effect restores saved paths from settings.json once.
  // Both are mount-only so focus changes or folder pickers can't overwrite
  // in-session edits.
  const applySettingsData = useCallback((s) => {
    // Only apply non-path settings here so returning from Settings does not overwrite folder edits.
    if (s.output?.folder_mode) setFolderMode(s.output.folder_mode);
    if (typeof s.output?.do_upscale === "boolean") setDoUpscale(s.output.do_upscale);
    if (s.output?.upscale_scale === "2" || s.output?.upscale_scale === "4") setScale(s.output.upscale_scale);
    if (s.output?.canvas_size) setCanvasSize(String(s.output.canvas_size));
    if (s.processing?.rembg_model) setRembgModel(s.processing.rembg_model);
    if (s.processing?.upscale_model) setUpscaleModel(s.processing.upscale_model);
    if (s.processing?.bg_device_mode) {
      setBgDeviceMode(normalizeBgDeviceMode(s.processing.bg_device_mode));
    } else if (typeof s.processing?.force_cpu === "boolean") {
      setBgDeviceMode(s.processing.force_cpu ? "cpu" : "gpu_auto");
    }
    if (typeof s.processing?.reuse_exact_duplicates === "boolean") {
      setReuseExactDuplicates(s.processing.reuse_exact_duplicates);
    }
    if (Object.prototype.hasOwnProperty.call(s.processing ?? {}, "upscale_max_px")) {
      const savedMaxPx = Number(s.processing.upscale_max_px);
      setUpscaleMaxPx(Number.isFinite(savedMaxPx) && savedMaxPx > 0 ? String(savedMaxPx) : "3600");
    }
  }, []);

  const loadSettings = useCallback(() => {
    getRembgModels()
      .then(data => {
        if (Array.isArray(data?.models) && data.models.length) setRembgModels(data.models);
      })
      .catch(() => {});

    getSettings()
      .then(settings => {
        if (!settings) return;
        applySettingsData(settings);
      })
      .catch(() => {});
  }, [applySettingsData]);

  // Load non-path settings on mount only.
  // This avoids overwriting in-session edits when the window regains focus
  // (for example, after native folder picker closes).
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    const handleSettingsSaved = (event) => {
      if (event.detail?.settings) {
        applySettingsData(event.detail.settings);
      } else {
        loadSettings();
      }
    };
    window.addEventListener("cutout-settings-saved", handleSettingsSaved);
    return () => window.removeEventListener("cutout-settings-saved", handleSettingsSaved);
  }, [applySettingsData, loadSettings]);

  useEffect(() => {
    getSession()
      .then(data => {
        // Only an interrupted processing run can be resumed here. A finished run
        // (completed) or an Editor session is not a pipeline resume.
        if (data?.exists && data.kind === "pipeline" && !data.completed) {
          setResumeSession(data);
          setShowResume(true);
        }
      })
      .catch(() => {});
  }, []);

  const {
    running, done, outcome, runConfig, log, errors, imageDone, imageError,
    totalImages, elapsed, stage,
    upStats, bgStats, oomGpuCount, previewPath, livePreviewStrip, eta,
    logRef, start, stop,
  } = usePipeline();

  useEffect(() => {
    if (!running) return;
    const stopOnUnload = () => {
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon(`${BASE}/pipeline/stop`, "");
        } else {
          fetch(`${BASE}/pipeline/stop`, { method: "POST", keepalive: true }).catch(() => {});
        }
      } catch { void 0; }
    };
    window.addEventListener("beforeunload", stopOnUnload);
    window.addEventListener("pagehide", stopOnUnload);
    return () => {
      window.removeEventListener("beforeunload", stopOnUnload);
      window.removeEventListener("pagehide", stopOnUnload);
    };
  }, [running]);

  useEffect(() => {
    if (!done) {
      doneNotifiedRef.current = false;
      return;
    }
    if (doneNotifiedRef.current) return;
    doneNotifiedRef.current = true;
    (async () => {
      let session = null;
      try {
        const data = await getSession();
        session = data?.exists ? data : null;
      } catch {
        void 0;
      }
      onPipelineDone?.({
        canvasSize: parseInt(canvasSize, 10) || 1440,
        session,
      });
      if (AUTO_OPEN_EDITOR_AFTER_PROCESS && imageError === 0 && errors.length === 0) {
        onGoToEditor?.({ canvasSize: parseInt(canvasSize, 10) || 1440 });
      }
    })();
  }, [done, onPipelineDone, onGoToEditor, canvasSize, imageError, errors.length]);

  const handleStart = useCallback(() => {
    const removedIds = removedImages ? [...removedImages] : [];
    const skipList = expandedImageTokens(removedIds, thumbs, inputDir);
    const activeExcludeIds = excludeTags.filter(n => !removedImages?.has(n));
    const activeExclude = expandedImageTokens(activeExcludeIds, thumbs, inputDir);
    const parsedUpscaleMaxPx = Number.parseInt(upscaleMaxPx, 10);
    start({
      folderMode, doUpscale, scale, doRembg, inputDir, outputDir,
      excludeList: activeExclude, skipList, rembgModel, resume: false,
      bgDeviceMode, upscaleModel,
      upscaleMaxPx: Number.isFinite(parsedUpscaleMaxPx) && parsedUpscaleMaxPx > 0 ? parsedUpscaleMaxPx : 0,
      reuseExactDuplicates,
    });
    rememberInputDir?.(inputDir);
    rememberOutputDir?.(outputDir);
    setShowResume(false);
  }, [start, folderMode, doUpscale, scale, doRembg, inputDir, outputDir, excludeTags, removedImages, thumbs, rembgModel, bgDeviceMode, upscaleModel, upscaleMaxPx, reuseExactDuplicates, rememberInputDir, rememberOutputDir]);

  const handleResume = useCallback(() => {
    if (!resumeSession?.src_root) return;
    const resumeInputDir = resumeSession.input_dir || resumeSession.src_root;
    const resumeOutputDir = resumeSession.output_dir ?? outputDir;
    setInputDir(resumeInputDir);
    setOutputDir(resumeOutputDir);
    const removedIds = removedImages ? [...removedImages] : [];
    const skipList = expandedImageTokens(removedIds, thumbs, resumeInputDir);
    const activeExcludeIds = excludeTags.filter(n => !removedImages?.has(n));
    const activeExclude = expandedImageTokens(activeExcludeIds, thumbs, resumeInputDir);
    const parsedUpscaleMaxPx = Number.parseInt(upscaleMaxPx, 10);
    start({
      folderMode, doUpscale, scale, doRembg,
      inputDir: resumeInputDir,
      outputDir: resumeOutputDir, excludeList: activeExclude, skipList, rembgModel, resume: true,
      bgDeviceMode, upscaleModel,
      upscaleMaxPx: Number.isFinite(parsedUpscaleMaxPx) && parsedUpscaleMaxPx > 0 ? parsedUpscaleMaxPx : 0,
      reuseExactDuplicates,
    });
    rememberInputDir?.(resumeInputDir);
    rememberOutputDir?.(resumeOutputDir);
    setShowResume(false);
  }, [resumeSession, setInputDir, setOutputDir, removedImages, excludeTags, thumbs, start, folderMode, doUpscale, scale, doRembg, outputDir, rembgModel, bgDeviceMode, upscaleModel, upscaleMaxPx, reuseExactDuplicates, rememberInputDir, rememberOutputDir]);

  const handleStartFresh = useCallback(async () => {
    try { await clearSession(); } catch { void 0; }
    setShowResume(false);
    setResumeSession(null);
  }, []);

  const handleReuseExactDuplicatesChange = useCallback((enabled) => {
    setReuseExactDuplicates(enabled);
    patchSettings({ processing: { reuse_exact_duplicates: enabled } }).catch(() => {});
  }, []);

  const nothingSelected = !doUpscale && !doRembg;
  const skipCount = removedImages?.size ?? 0;
  const activeExcludeCount = excludeTags.filter(n => !removedImages?.has(n)).length;
  const bgDeviceLabel = bgDeviceOption(bgDeviceMode).label;

  return (
    <div className="pipeline-screen">
      <PageHeader
        title="Process"
        subtitle="Configure the stages, then run the batch"
        className="pipeline-app-header"
        actions={(
        <>
          {done && !running && (
            <Button
              iconEnd={ArrowRight}
              onClick={() => onGoToEditor?.({ canvasSize: parseInt(canvasSize, 10) || 1440 })}
            >
              Open editor
            </Button>
          )}
          {!running ? (
            <Button variant="primary" icon={Play} onClick={handleStart} disabled={nothingSelected}>
              Run pipeline
            </Button>
          ) : (
            <Button variant="danger" icon={Square} onClick={stop}>
              Stop
            </Button>
          )}
        </>
        )}
      />

      <div className="pipeline-layout">

        {/* Settings panel */}
        <ResizablePanel
          prefKey="process.settings"
          side="left"
          defaultWidth={320}
          min={280}
          max={460}
          className="pipeline-settings-panel"
          aria-label="Pipeline settings"
        >
          <div className="pipeline-settings-scroll">
          {showResume && resumeSession && (
            <div className="pipeline-resume-card" role="region" aria-label="Resume previous session">
              <IconButton
                icon={X}
                label="Dismiss resume prompt"
                size="s"
                className="pipeline-resume-dismiss"
                onClick={() => setShowResume(false)}
              />
              <strong>Resume previous session?</strong>
              <span>
                {Math.max(0, (resumeSession.total ?? 0) - (resumeSession.queue_index ?? 0))} image(s) remaining
              </span>
              <code title={resumeSession.src_root}>{resumeSession.src_root}</code>
              <div className="pipeline-resume-actions">
                <Button onClick={handleResume}>Resume</Button>
                <Button variant="ghost" onClick={handleStartFresh}>Start fresh</Button>
              </div>
            </div>
          )}

          <Section title="Folders" prefKey="process.folders">
            <Field label="Input folder" htmlFor="process-input-dir">
              <FolderInput
                id="process-input-dir"
                value={inputDir}
                onChange={setInputDir}
                placeholder="default: ./input"
                recent={recentInputDirs}
                onRemember={rememberInputDir}
              />
            </Field>
            <Field label="Output folder" htmlFor="process-output-dir">
              <FolderInput
                id="process-output-dir"
                value={outputDir}
                onChange={setOutputDir}
                placeholder={`default: ${defaultOutputLabel}`}
                recent={recentOutputDirs}
                onRemember={rememberOutputDir}
              />
            </Field>
          </Section>

          <Section title="Processing" prefKey="process.processing">
            <Row label="Folder mode">
              <SegmentedControl
                label="Folder mode"
                value={folderMode}
                onChange={setFolderMode}
                options={[{ value: "bulk", label: "Bulk" }, { value: "clean", label: "Clean" }]}
              />
            </Row>

            <Row label="Upscale (NCNN)">
              <Switch checked={doUpscale} onChange={setDoUpscale} aria-label="Upscale (NCNN)" />
            </Row>

            {doUpscale && (
              <Row label="Scale factor">
                <SegmentedControl
                  label="Scale factor"
                  value={scale}
                  onChange={setScale}
                  options={[{ value: "2", label: "2×" }, { value: "4", label: "4×" }]}
                />
              </Row>
            )}

            <Row label="Remove BG">
              <Switch checked={doRembg} onChange={setDoRembg} aria-label="Remove BG" />
            </Row>

            <Row label="Reuse exact duplicates" hint="Process identical files once and copy results to duplicates.">
              <Switch
                checked={reuseExactDuplicates}
                onChange={handleReuseExactDuplicatesChange}
                aria-label="Reuse exact duplicates"
              />
            </Row>

            {doRembg && (
              <Field
                label="BG model"
                htmlFor="process-bg-model"
                hint={`${bgModelInfo(rembgModel).bestFor} Device: ${bgDeviceLabel} (set in Settings).`}
              >
                <Select id="process-bg-model" value={rembgModel} onChange={e => setRembgModel(e.target.value)}>
                  {rembgModels.map(m => <option key={m} value={m}>{bgModelLabel(m)}</option>)}
                </Select>
              </Field>
            )}
          </Section>

          <Section title="Output" prefKey="process.output">
            <Field
              label="Skip upscale if any side is at least (px)"
              htmlFor="process-max-px"
              hint="Photos already this large are not upscaled. Empty uses the default (3600 px)."
            >
              <TextField
                id="process-max-px"
                mono
                type="number"
                value={upscaleMaxPx}
                onChange={e => setUpscaleMaxPx(e.target.value)}
                placeholder="3600"
                min={256}
                max={8192}
              />
            </Field>

            <Field label="Canvas size (px)" htmlFor="process-canvas-size">
              <div className="pipeline-canvas-size">
                <SegmentedControl
                  label="Canvas size presets"
                  value={canvasSize}
                  onChange={setCanvasSize}
                  options={["1080", "1440", "2048"]}
                />
                <TextField
                  id="process-canvas-size"
                  mono
                  type="number"
                  value={canvasSize}
                  onChange={e => setCanvasSize(e.target.value)}
                  min={256}
                  max={8192}
                />
              </div>
            </Field>
          </Section>

          </div>

          <div className="pipeline-settings-actions">
            <Button icon={FolderOpen} onClick={() => openFolder(outputDir.trim()).catch(() => {})}>
              Open output folder
            </Button>
          </div>
        </ResizablePanel>

        {/* Workspace */}
        <div className="pipeline-workspace">
          <div className="pipeline-status-card-slot">
            {(running || done || outcome) && (
              <Zone2
                upStats={upStats} bgStats={bgStats}
                totalImages={totalImages} elapsed={elapsed}
                running={running} outcome={outcome} stage={stage}
                doUpscale={runConfig.upscale} doRembg={runConfig.rembg}
                oomGpuCount={oomGpuCount}
                eta={eta}
              />
            )}
            {!running && !done && !outcome && (
              <ReadyCard
                nothingSelected={nothingSelected}
                doUpscale={doUpscale}
                doRembg={doRembg}
                activeExcludeCount={activeExcludeCount}
                skipCount={skipCount}
                canvasSize={canvasSize}
                inputDir={inputDir}
              />
            )}
          </div>

          <PipelinePreviewStrip
            imageDone={imageDone} totalImages={totalImages}
            previewPath={previewPath}
            livePreviewStrip={livePreviewStrip}
          />

          <ActivityPanel
            logRef={logRef} log={log} running={running}
            open={logOpen} setOpen={setLogOpen}
          />
        </div>
      </div>
    </div>
  );
}
