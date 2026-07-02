import { useState, useRef, useEffect, useCallback } from "react";
/*
KNOWN LIMITATIONS (web build):
- Focus-based settings reload is a temporary sync workaround; desktop Electron should use explicit app events.
- /api/browse relies on tkinter; Electron should use native dialog APIs.
- Editor refresh still depends on UI state transitions rather than native IPC events.
*/

const BASE = "/api";

// Opens a folder in the native OS file explorer via the API server.
// path="" → server defaults to OUTPUT_ROOT.
const openFolder = (path = "") =>
  fetch(`${BASE}/open-folder?path=${encodeURIComponent(path)}`).catch(() => {});

function toForwardSlashes(path = "") {
  return String(path || "").replace(/\\/g, "/");
}

function trimTrailingSlashes(path = "") {
  return path.replace(/\/+$/, "");
}

function normalizeImagePathToken(path = "") {
  return trimTrailingSlashes(toForwardSlashes(path).trim());
}

function relativePathFromInput(absPath, inputDir) {
  const absNorm = normalizeImagePathToken(absPath);
  const rootNorm = normalizeImagePathToken(inputDir);
  if (!absNorm || !rootNorm) return "";
  const absLower = absNorm.toLowerCase();
  const rootLower = rootNorm.toLowerCase();
  if (absLower === rootLower) return "";
  if (absLower.startsWith(`${rootLower}/`)) return absNorm.slice(rootNorm.length + 1);
  return "";
}

function imageIdForPath(absPath, inputDir) {
  return normalizeImagePathToken(relativePathFromInput(absPath, inputDir) || absPath);
}

function addToken(tokens, value) {
  const token = String(value || "").trim();
  if (token) tokens.add(token);
}

function expandedImageTokens(ids, thumbs, inputDir) {
  const tokens = new Set();
  const aliasesById = new Map();

  (Array.isArray(thumbs) ? thumbs : []).forEach((absPath) => {
    const imageId = imageIdForPath(absPath, inputDir);
    const relativePath = relativePathFromInput(absPath, inputDir);
    const absolutePath = String(absPath || "").trim();
    const normalizedAbsolutePath = normalizeImagePathToken(absPath);
    const aliases = [imageId, relativePath, absolutePath, normalizedAbsolutePath].filter(Boolean);

    aliasesById.set(imageId, aliases);
    aliasesById.set(normalizedAbsolutePath, aliases);
    aliasesById.set(absolutePath, aliases);
  });

  (Array.isArray(ids) ? ids : [...(ids || [])]).forEach((id) => {
    addToken(tokens, id);
    const normalizedId = normalizeImagePathToken(id);
    addToken(tokens, normalizedId);
    (aliasesById.get(id) || aliasesById.get(normalizedId) || []).forEach((alias) => addToken(tokens, alias));
  });

  return [...tokens];
}

async function saveProcessingSettingsPatch(patch) {
  const response = await fetch(`${BASE}/settings`);
  const data = response.ok ? await response.json() : { settings: {} };
  const current = data?.settings ?? {};
  await fetch(`${BASE}/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      settings: {
        ...current,
        processing: { ...(current.processing ?? {}), ...patch },
      },
    }),
  });
}

const C = {
  bg:      "var(--bg)",      panel:   "var(--panel)",   panel2:  "var(--panel2)",
  border:  "var(--border)",  text:    "var(--text)",    dim:     "var(--dim)",
  dim2:    "var(--dim2)",    accent:  "var(--accent)",
  green:   "var(--green)",   greenBg: "var(--green-bg)", greenBdr: "var(--green-bdr)",
  red:     "var(--red)",     redBg:   "var(--red-bg)",   redBdr:  "var(--red-bdr)",
  yellow:  "var(--yellow)",  blue:    "var(--accent)",   magenta: "var(--magenta)",
};

// ── Primitives ────────────────────────────────────────────────────────────────

function Row({ label, children, className = "", controlsClassName = "" }) {
  return (
    <div className={`pipeline-row ${className}`.trim()} style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "7px 0", borderBottom: `1px solid ${C.border}`
    }}>
      <span className="pipeline-field-label" style={{ fontSize: 12, color: C.dim }}>{label}</span>
      <div className={`pipeline-row-controls ${controlsClassName}`.trim()} style={{ display: "flex", gap: 5, alignItems: "center" }}>{children}</div>
    </div>
  );
}
function Btn({ label, active, color, onClick, style = {}, className = "" }) {
  const bg  = active ? (color ? color + "22" : "color-mix(in srgb, var(--accent) 12%, transparent)") : "transparent";
  const fg  = active ? (color || C.text) : C.dim;
  const bdr = active ? (color ? color + "55" : "color-mix(in srgb, var(--accent) 35%, transparent)") : "transparent";
  return (
    <button className={`pipeline-btn ${className}`.trim()} onClick={onClick} style={{
      background: bg, color: fg, border: `1px solid ${bdr}`,
      borderRadius: 8, padding: "4px 12px", fontSize: 11, minWidth: 42,
      cursor: "pointer", fontFamily: "inherit", fontWeight: active ? 600 : 400,
      ...style,
    }}>{label}</button>
  );
}

function PillToggle({ value, onChange }) {
  return (
    <div className={`pipeline-toggle ${value ? "is-on" : "is-off"}`} onClick={() => onChange(!value)} style={{
      width: 40, height: 22, borderRadius: 11, cursor: "pointer", flexShrink: 0,
      background: value ? C.greenBg : C.redBg,
      border: `1px solid ${value ? C.greenBdr : C.redBdr}`,
      position: "relative", transition: "background 0.2s ease, border-color 0.2s ease",
    }}>
      <div className={`pipeline-toggle-thumb ${value ? "is-on" : "is-off"}`} style={{
        width: 16, height: 16, borderRadius: "50%",
        background: value ? C.green : C.red,
        position: "absolute", top: 2,
        left: value ? 20 : 2,
        transition: "left 0.2s ease, background 0.2s ease",
        boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
      }} />
    </div>
  );
}

function FolderInput({ value, onChange, placeholder, recent = [], onRemember }) {
  const browse = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/browse?initial=${encodeURIComponent(value)}`);
      const { path } = await r.json();
      if (path) {
        onChange(path);
        onRemember?.(path);
      }
    } catch { void 0; }
  }, [value, onChange, onRemember]);

  return (
    <div className="pipeline-folder-input" style={{ display: "flex", gap: 4, width: "100%" }}>
      <input
        className="pipeline-path-field"
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={() => onRemember?.(value)}
        placeholder={placeholder}
        style={{
          flex: 1, background: C.panel2, color: C.text,
          border: `1px solid ${C.border}`, borderRadius: 4,
          padding: "5px 8px", fontSize: 11, fontFamily: "JetBrains Mono",
          outline: "none", minWidth: 0
        }}
      />
      {recent.length > 0 && (
        <select
          value=""
          onChange={e => {
            if (!e.target.value) return;
            onChange(e.target.value);
            onRemember?.(e.target.value);
          }}
          style={{
            width: 34, background: C.panel2, color: C.dim,
            border: `1px solid ${C.border}`, borderRadius: 8,
            fontSize: 10, cursor: "pointer", flexShrink: 0,
          }}
          title="Recent folders"
        >
          <option value="">Recent folders</option>
          {recent.map(path => <option key={path} value={path}>{path}</option>)}
        </select>
      )}
      <button
        className="pipeline-btn pipeline-browse-button pipeline-secondary-button"
        onClick={browse}
        aria-label="Browse folder"
        title="Browse folder"
        style={{
          background: C.panel2, color: C.dim,
          border: `1px solid ${C.border}`, borderRadius: 8, padding: "5px 9px",
          fontSize: 12, cursor: "pointer", fontFamily: "inherit", flexShrink: 0
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2.5 5.5h11v6.25a1.25 1.25 0 0 1-1.25 1.25h-8.5A1.25 1.25 0 0 1 2.5 11.75V5.5Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
          <path d="M2.5 5.5V4.25A1.25 1.25 0 0 1 3.75 3h3.1l1.25 1.25h4.15A1.25 1.25 0 0 1 13.5 5.5" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}

function ProcessPanelSection({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="pipeline-panel-section">
      <button
        type="button"
        className="pipeline-panel-toggle"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
      >
        <span className="pipeline-panel-title">{title}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          className="pipeline-panel-chevron"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
          aria-hidden="true"
        >
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="pipeline-panel-content">
          {children}
        </div>
      )}
    </section>
  );
}

function FieldLabel({ children }) {
  return <div className="pipeline-field-label" style={{ fontSize: 11, color: C.dim, marginBottom: 4 }}>{children}</div>;
}

function Spinner({ color = C.yellow, size = 12 }) {
  const ch = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const [f, setF] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setF(x => (x + 1) % ch.length), 80);
    return () => clearInterval(t);
  }, [ch.length]);
  return <span style={{ fontFamily: "JetBrains Mono", fontSize: size, color }}>{ch[f]}</span>;
}

// ── Pipeline hook ─────────────────────────────────────────────────────────────

function telemetryTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function telemetryEntry(raw, kind = "info") {
  return { raw, kind, time: telemetryTimestamp() };
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

function usePipeline() {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [log, setLog] = useState([]);
  const [errors, setErrors] = useState([]);
  const [imageDone, setImageDone] = useState(0);
  const [imageSkipped, setImageSkipped] = useState(0);
  const [imageError, setImageError] = useState(0);
  const [totalImages, setTotalImages] = useState(0);
  const [recentDone, setRecentDone] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const [stage, setStage] = useState(null);
  const [upStats, setUpStats] = useState({ done: 0, skip: 0, err: 0 });
  const [bgStats, setBgStats] = useState({ done: 0, skip: 0, err: 0 });
  const [oomGpuCount, setOomGpuCount] = useState(0);
  const [imageProgress, setImageProgress] = useState({});
  const [previewPath, setPreviewPath] = useState("");
  const [livePreviewStrip, setLivePreviewStrip] = useState([]);

  const abortRef    = useRef(null);
  const logRef      = useRef(null);
  const timerRef    = useRef(null);
  const startRef    = useRef(null);
  const doneSet     = useRef(new Set());
  const skipSet     = useRef(new Set());
  const errSet      = useRef(new Set());
  const sentinelSet = useRef(new Set());
  const stageRef    = useRef("upscale");
  const recentLog   = useRef([]);
  const previewPathByFile = useRef(new Map());

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);
  useEffect(() => {
    if (running) {
      startRef.current = Date.now();
      timerRef.current = setInterval(() =>
        setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [running]);

  const classify = useCallback((raw) => {
    if (/→ bg_removed/.test(raw) || /→ upscaled/.test(raw)) return "ok";
    if (/✓/.test(raw)) return "ok";
    if (/✗|Error|error|failed on |Traceback|Exception/i.test(raw)) return "error";
    if (/⚠|warn/i.test(raw)) return "warn";
    if (/↷|skip|already (upscaled|processed)/i.test(raw)) return "skip";
    if (/Stage \d|─{4,}|═{4,}/.test(raw)) return "section";
    return "info";
  }, []);

  const pushLivePreview = useCallback((fname, path = "") => {
    if (!fname) return;
    setLivePreviewStrip(prev => {
      const existing = prev.find(item => item.name === fname);
      const resolvedPath = path || existing?.path || "";
      const next = [{ name: fname, path: resolvedPath }, ...prev.filter(item => item.name !== fname)];
      return next.slice(0, 4);
    });
  }, []);

  const appendLine = useCallback((raw) => {
    // ── Structured machine-readable tokens ──────────────────────────────────
    if (raw.startsWith("__total__:")) {
      const n = parseInt(raw.slice(10), 10);
      if (!isNaN(n)) setTotalImages(n);
      return;
    }
    if (raw.startsWith("__ok_upscale__:")) {
      const fname = raw.slice(15);
      setImageProgress(prev => ({ ...prev, [fname]: { stage: "upscale", percent: 50, status: "ok" } }));
      pushLivePreview(fname, previewPathByFile.current.get(fname) || "");
      if (!doneSet.current.has(fname)) {
        doneSet.current.add(fname);
        setImageDone(doneSet.current.size);
        setRecentDone(prev => [fname, ...prev].slice(0, 8));
      }
      setUpStats(s => ({ ...s, done: s.done + 1 }));
      appendTelemetryEntry(setLog, telemetryEntry(telemetryLabel(fname, "upscale [DONE]"), "success"), { clearPending: true });
      return;
    }
    if (raw.startsWith("__ok_rembg__:")) {
      const fname = raw.slice(13);
      setImageProgress(prev => ({ ...prev, [fname]: { stage: "rembg", percent: 100, status: "ok" } }));
      pushLivePreview(fname, previewPathByFile.current.get(fname) || "");
      if (!doneSet.current.has(fname)) {
        doneSet.current.add(fname);
        setImageDone(doneSet.current.size);
        setRecentDone(prev => [fname, ...prev].slice(0, 8));
      }
      setBgStats(s => ({ ...s, done: s.done + 1 }));
      appendTelemetryEntry(setLog, telemetryEntry(telemetryLabel(fname, "BG removal [DONE]"), "success"), { clearPending: true });
      return;
    }
    if (raw.startsWith("__skip_upscale__:")) {
      const fname = raw.slice(17);
      setImageProgress(prev => ({ ...prev, [fname]: { stage: "upscale", percent: 50, status: "skip" } }));
      if (!skipSet.current.has(fname)) { skipSet.current.add(fname); setImageSkipped(skipSet.current.size); }
      setUpStats(s => ({ ...s, skip: s.skip + 1 }));
      appendTelemetryEntry(setLog, telemetryEntry(telemetryLabel(fname, "upscale [SKIP]"), "skip"), { clearPending: true });
      return;
    }
    if (raw.startsWith("__skip_rembg__:")) {
      const fname = raw.slice(15);
      setImageProgress(prev => ({ ...prev, [fname]: { stage: "rembg", percent: 100, status: "skip" } }));
      if (!skipSet.current.has(fname)) { skipSet.current.add(fname); setImageSkipped(skipSet.current.size); }
      setBgStats(s => ({ ...s, skip: s.skip + 1 }));
      appendTelemetryEntry(setLog, telemetryEntry(telemetryLabel(fname, "BG removal [SKIP]"), "skip"), { clearPending: true });
      return;
    }
    if (raw.startsWith("__err_upscale__:")) {
      const fname = raw.slice(16);
      setImageProgress(prev => ({ ...prev, [fname]: { stage: "upscale", percent: 50, status: "error" } }));
      if (!errSet.current.has(fname)) { errSet.current.add(fname); setImageError(errSet.current.size); }
      setUpStats(s => ({ ...s, err: s.err + 1 }));
      appendTelemetryEntry(setLog, telemetryEntry(telemetryLabel(fname, "upscale [ERROR]"), "error"), { clearPending: true });
      return;
    }
    if (raw.startsWith("__err_rembg__:")) {
      const fname = raw.slice(14);
      setImageProgress(prev => ({ ...prev, [fname]: { stage: "rembg", percent: 100, status: "error" } }));
      if (!errSet.current.has(fname)) { errSet.current.add(fname); setImageError(errSet.current.size); }
      setBgStats(s => ({ ...s, err: s.err + 1 }));
      appendTelemetryEntry(setLog, telemetryEntry(telemetryLabel(fname, "BG removal [ERROR]"), "error"), { clearPending: true });
      return;
    }
    if (raw.startsWith("__err_oom_gpu__:")) {
      const fname = raw.slice(16);
      setImageProgress(prev => ({ ...prev, [fname]: { stage: "rembg", percent: 100, status: "oom" } }));
      setOomGpuCount(c => c + 1);
      appendTelemetryEntry(setLog, telemetryEntry(telemetryLabel(fname, "GPU OOM fallback [WARN]"), "warn"), { clearPending: true });
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

    if (raw.startsWith("__processing__:")) {
      const fullPath = raw.slice(15);
      const fileName = fullPath.replace(/.*[/\\]/, "");
      setPreviewPath(fullPath);
      previewPathByFile.current.set(fileName, fullPath);
      if (!sentinelSet.current.has(fileName)) {
        sentinelSet.current.add(fileName);
        setLog(prev => (
          prev.length === 0
            ? [telemetryEntry(telemetryLabel(fileName, "processing"), "pending")]
            : prev
        ));
        setImageProgress(prev => ({ ...prev, [fileName]: { stage: "upscale", percent: 0, status: "running" } }));
      } else {
        setImageProgress(prev => ({ ...prev, [fileName]: { ...prev[fileName], status: "running" } }));
      }
      return;
    }

    // ── Human-readable log lines ─────────────────────────────────────────────
    if (raw.startsWith("__done__")) {
      const ok = raw.includes("exit=0");
      appendTelemetryEntry(
        setLog,
        telemetryEntry(ok ? "Pipeline complete [DONE]" : "Pipeline exited with errors [ERROR]", ok ? "success" : "error"),
        { clearPending: true }
      );
      return;
    }
    if (/Pipeline complete/i.test(raw)) {
      appendTelemetryEntry(setLog, telemetryEntry("Pipeline complete [DONE]", "success"), { clearPending: true });
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
  }, [classify, pushLivePreview]);

  const start = useCallback(async ({ folderMode, doUpscale, scale, doRembg, inputDir, outputDir, excludeList = [], skipList = [], rembgModel = "", resume = false, upscaleMaxPx = 0, reuseExactDuplicates = true }) => {
    if (running) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLog([]); setErrors([]);
    setImageDone(0); setImageSkipped(0); setImageError(0);
    setTotalImages(0); setRecentDone([]);
    setElapsed(0); setDone(false); setRunning(true);
    setStage(null);
    setUpStats({ done: 0, skip: 0, err: 0 });
    setBgStats({ done: 0, skip: 0, err: 0 });
    setOomGpuCount(0);
    setImageProgress({});
    setPreviewPath("");
    setLivePreviewStrip([]);
    stageRef.current = "upscale";
    recentLog.current = [];
    doneSet.current = new Set(); skipSet.current = new Set(); errSet.current = new Set(); sentinelSet.current = new Set();
    previewPathByFile.current = new Map();

    try {
      const r = await fetch(`${BASE}/pipeline/run`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_mode: folderMode, do_upscale: doUpscale, scale,
          do_rembg: doRembg, input_dir: inputDir.trim(), output_dir: outputDir.trim(),
          exclude_rembg: excludeList, skip_files: skipList, rembg_model: rembgModel, resume,
          upscale_max_px: upscaleMaxPx,
          reuse_exact_duplicates: reuseExactDuplicates,
        }),
        signal: ctrl.signal,
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({ detail: r.statusText }));
        appendLine(`Error: ${e.detail}`);
        setRunning(false); return;
      }
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done: sd, value } = await reader.read();
        if (sd) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const msg = line.slice(6);
          if (msg.startsWith("__done__")) {
            appendLine(msg);
            setStage("done"); setDone(true); setRunning(false);
          } else if (msg.startsWith("__error__")) {
            appendLine(`Error: ${msg.replace("__error__ ", "")}`);
            setRunning(false);
          } else {
            appendLine(msg);
          }
        }
      }
    } catch (e) {
      if (e.name === "AbortError") return;
      appendLine(`Connection error: ${e.message}`);
      setRunning(false);
    }
  }, [running, appendLine]);

  const stop = useCallback(async () => {
    abortRef.current?.abort();
    try { await fetch(`${BASE}/pipeline/stop`, { method: "POST" }); } catch { void 0; }
    appendLine("Stopped by user.");
    setRunning(false); setStage(null);
  }, [appendLine]);

  return {
    running, done, log, errors, imageDone, imageSkipped, imageError,
    totalImages, recentDone, elapsed, stage,
    upStats, bgStats, imageProgress, oomGpuCount, previewPath, livePreviewStrip,
    logRef, start, stop
  };
}

// Zone 1: Live preview strip

function Zone1({ imageDone, totalImages, previewPath, livePreviewStrip }) {
  return (
    <PipelinePreviewStrip
      previewPath={previewPath}
      livePreviewStrip={livePreviewStrip}
      imageDone={imageDone}
      totalImages={totalImages}
    />
  );
}

function PipelinePreviewStrip({ previewPath, livePreviewStrip, imageDone, totalImages }) {
  const totalLabel = totalImages > 0 ? totalImages : "-";
  const processedLabel = `${imageDone}/${totalLabel} processed`;
  const stripItems = Array.isArray(livePreviewStrip) ? livePreviewStrip : [];
  let sourceItems = stripItems
    .map(item => ({ path: item?.path || "", name: item?.name || "" }))
    .filter(item => item.path);

  if (previewPath) {
    const previewItem = {
      path: previewPath,
      name: previewPath.replace(/.*[/\\]/, ""),
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
      label: index === 0 && sourceItems.length === 0 ? "Images will appear here during processing." : "",
    })),
  ].slice(0, 4);

  return (
    <div className="pipeline-zone pipeline-progress-card pipeline-preview-strip">
      <div className="pipeline-live-title-row">
        <div className="pipeline-live-title">Live Stream</div>
        <div className="pipeline-live-counter">{processedLabel}</div>
      </div>
      <div className="pipeline-preview-grid">
        {slotItems.map((item, idx) => (
          <PipelinePreviewSlot key={`preview-slot-${idx}`} item={item} />
        ))}
      </div>
    </div>
  );
}

function PipelinePreviewSlot({ item }) {
  const src = item?.path ? `${BASE}/image?path=${encodeURIComponent(item.path)}` : "";
  const hasImage = Boolean(src);
  const fileLabel = item?.name || "";
  const placeholderLabel = item?.label || "";

  return (
    <div className="pipeline-preview-slot">
      {hasImage ? (
        <>
          <img className="pipeline-preview-image" src={src} alt={fileLabel} />
          {fileLabel && <div className="pipeline-live-preview-name">{fileLabel}</div>}
        </>
      ) : (
        <div className="pipeline-preview-placeholder">{placeholderLabel}</div>
      )}
    </div>
  );
}

function SmStat({ label, value, color }) {
  return (
    <div className="pipeline-stat" style={{ textAlign: "center" }}>
      <div className="pipeline-stat-value" style={{ color }}>{value}</div>
      <div className="pipeline-stat-label">{label}</div>
    </div>
  );
}


// Zone 2: Per-stage stats bar

function StatChip({ icon, value, color }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 3, minWidth: 36 }}>
      <span style={{ fontSize: 10, color, lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color, fontFamily: "JetBrains Mono", lineHeight: 1 }}>{value}</span>
    </div>
  );
}

function StageRow({ label, stats, total, active, stageDone, color }) {
  const finished = stats.done + stats.skip;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{
        fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700,
        color: stageDone ? C.green : active ? color : C.dim,
        width: 78, flexShrink: 0,
      }}>{label}</div>
      <StatChip icon="✓" value={stats.done} color={stats.done > 0 ? C.green  : C.dim} />
      <StatChip icon="↷" value={stats.skip} color={stats.skip > 0 ? C.yellow : C.dim} />
      <StatChip icon="✗" value={stats.err}  color={stats.err  > 0 ? C.red    : C.dim} />
      {total > 0 && (
        <span style={{ fontSize: 10, color: C.dim, fontFamily: "JetBrains Mono", marginLeft: "auto" }}>
          {finished}/{total}
        </span>
      )}
      {active && <Spinner color={color} size={10} />}
      {stageDone && <span style={{ fontSize: 10, color: C.green }}>✓</span>}
    </div>
  );
}

function Zone2({ upStats, bgStats, totalImages, elapsed, done, stage, doUpscale, doRembg, oomGpuCount = 0, imageProgress = {} }) {
  const fmt = s => s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  const n = Math.max(0, totalImages || 0);

  const upProcessed = upStats.done + upStats.skip + upStats.err;
  const bgProcessed = bgStats.done + bgStats.skip + bgStats.err;
  const hasBothStages = doUpscale && doRembg;
  const totalUnits = (doUpscale ? n : 0) + (doRembg ? n : 0);
  const processedUnits = (doUpscale ? upProcessed : 0) + (doRembg ? bgProcessed : 0);
  const activeUnits = Object.values(imageProgress).filter(meta => meta?.status === "running").length;
  const inFlightUnits = !done && totalUnits > 0 && activeUnits > 0
    ? Math.min(activeUnits * 0.25, Math.max(0, totalUnits - processedUnits))
    : 0;
  const visibleUnits = Math.min(totalUnits, processedUnits + inFlightUnits);
  const totalErrors = upStats.err + bgStats.err;

  const progressRatio = totalUnits === 0 ? 0 : visibleUnits / totalUnits;
  const progressPct = done ? 100 : Math.min(100, Math.max(0, Math.round(progressRatio * 100)));
  const etaSeconds = !done && processedUnits > 0 && elapsed > 0 && totalUnits > processedUnits
    ? Math.ceil((elapsed / processedUnits) * (totalUnits - processedUnits))
    : null;
  const etaLabel = done ? "ETA done" : etaSeconds ? `ETA ${fmt(etaSeconds)}` : "ETA —";
  const countLabel = hasBothStages
    ? `${processedUnits}/${totalUnits} stage steps`
    : `${processedUnits}/${totalUnits} files`;

  const stagePill = done
    ? "Completed"
    : stage === "rembg"
      ? "Stage 2/2 · Remove BG"
      : hasBothStages
        ? "Stage 1/2 · Upscaling"
        : doUpscale
          ? "Upscaling"
          : "Remove BG";

  return (
    <div className="pipeline-progress-card">
      <div className="pipeline-progress-inner">
        <div className="pipeline-progress-head">
          <span className={`pipeline-progress-stage-pill ${done ? "is-done" : "is-active"}`}>{stagePill}</span>
          <span className="pipeline-progress-percent">{progressPct}%</span>
        </div>

        <div className="pipeline-progress-title">
          {done ? "Batch processing complete." : "Batch processing in progress..."}
        </div>

        <div className="pipeline-progress-meta">
          <span>{totalUnits > 0 ? countLabel : "count pending"}</span>
          <span>{etaLabel}</span>
          <span>elapsed {fmt(elapsed)}</span>
          {oomGpuCount > 0 && <span>OOM fallback {oomGpuCount}</span>}
          {done && totalErrors > 0 && <span>{totalErrors} error{totalErrors > 1 ? "s" : ""}</span>}
        </div>

        <div className="pipeline-progress-bar">
          <div style={{ width: `${progressPct}%` }} />
        </div>

        <div className="pipeline-progress-stats">
          <SmStat label="Upscale" value={upProcessed} color={doUpscale && upProcessed > 0 ? C.green : C.dim} />
          <SmStat label="Remove BG" value={bgProcessed} color={doRembg && bgProcessed > 0 ? C.green : C.dim} />
          <SmStat label="Errors" value={totalErrors} color={totalErrors > 0 ? C.red : C.dim} />
        </div>
      </div>
    </div>
  );
}

function ReadyCard({ nothingSelected, doUpscale, doRembg, activeExcludeCount, skipCount, canvasSize, inputDir }) {
  const activeStages = [
    doUpscale ? "Upscale" : null,
    doRembg ? "Remove BG" : null,
  ].filter(Boolean);

  return (
    <div className={`pipeline-ready-card ${nothingSelected ? "is-disabled" : "is-ready"}`}>
      <div className="pipeline-ready-icon" aria-hidden="true">▶</div>
      <div className="pipeline-ready-title">
        {nothingSelected ? "Select stages to continue" : "Ready to process"}
      </div>
      <div className="pipeline-ready-subtitle">
        {nothingSelected ? "Enable at least one stage to start." : "Press Run Pipeline in the header to begin processing."}
      </div>

      <div className="pipeline-ready-meta">
        {!nothingSelected && activeStages.length > 0 && (
          <span className="pipeline-ready-meta-item">{activeStages.join(" + ")}</span>
        )}
        {activeExcludeCount > 0 && (
          <span className="pipeline-ready-meta-item">{activeExcludeCount} excluded</span>
        )}
        {skipCount > 0 && (
          <span className="pipeline-ready-meta-item">{skipCount} skipped</span>
        )}
        {canvasSize && <span className="pipeline-ready-meta-item">{canvasSize}px canvas</span>}
      </div>

      <div className={`pipeline-ready-source ${inputDir ? "is-ready" : "is-missing"}`}>
        {inputDir ? "Input source configured." : "Input source missing. Set it on the left or drop a folder below."}
      </div>
    </div>
  );
}

// ── Tag chip input ────────────────────────────────────────────────────────────

function TagInput({ tags, onChange }) {
  const [input, setInput] = useState("");
  const add = (raw) => {
    const val = raw.trim().replace(/,$/, "").trim();
    if (!val || tags.includes(val)) return;
    onChange([...tags, val]);
  };
  const onKey = (e) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(input); setInput(""); }
    if (e.key === "Backspace" && !input && tags.length) onChange(tags.slice(0, -1));
  };
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center",
      background: C.panel2, border: `1px solid ${C.border}`,
      borderRadius: 4, padding: "4px 6px", minHeight: 32, cursor: "text",
    }} onClick={e => e.currentTarget.querySelector("input")?.focus()}>
      {tags.map(t => (
        <span key={t} style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          background: C.dim2, color: C.text, borderRadius: 3,
          padding: "2px 6px", fontSize: 10, fontFamily: "JetBrains Mono",
        }}>
          {t}
          <button onClick={() => onChange(tags.filter(x => x !== t))} style={{
            background: "none", border: "none", color: C.dim,
            cursor: "pointer", padding: 0, lineHeight: 1, fontSize: 11,
          }}>×</button>
        </span>
      ))}
      <input
        value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey}
        onBlur={() => { if (input) { add(input); setInput(""); } }}
        placeholder={tags.length ? "" : "filename.webp  →  Enter"}
        style={{
          flex: 1, minWidth: 80, background: "transparent", border: "none",
          outline: "none", color: C.text, fontSize: 10,
          fontFamily: "JetBrains Mono", padding: "2px 2px",
        }}
      />
    </div>
  );
}

// ── ActivityPanel ─────────────────────────────────────────────────────────────

function ActivityPanel({ logRef, log, running, open, setOpen }) {
  const entries = log.filter(Boolean);

  return (
    <div className={`pipeline-activity-panel ${open ? "is-open" : "is-collapsed"}`} style={{
      flex: open ? "1 1 auto" : "0 0 36px", minWidth: 0, minHeight: 0,
      display: "flex", flexDirection: "column",
      transition: "flex 0.2s ease"
    }}>
      <div className="pipeline-bottom-panel-header">
        <div className="pipeline-bottom-panel-title">
          PIPELINE TELEMETRY {"\u00b7"} {entries.length} ENTRIES
        </div>
        <button
          className={`pipeline-bottom-panel-toggle ${open ? "is-open" : ""}`}
          onClick={() => setOpen(v => !v)}
          aria-label={open ? "Collapse telemetry" : "Expand telemetry"}
          aria-expanded={open}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            className="pipeline-panel-chevron"
            style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
            aria-hidden="true"
          >
            <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {open && (
        <div className="pipeline-log-list pipeline-activity-console" ref={logRef}>
          {entries.length === 0 ? (
            <div className="pipeline-log-empty">{running ? "Waiting for pipeline activity..." : "Configure and press Run Pipeline."}</div>
          ) : entries.map((entry, index) => {
            const status = telemetryStatus(entry.raw);
            return (
              <div key={`${entry.time || "00:00:00"}-${index}`} className={`pipeline-activity-entry is-${entry.kind || "info"}`}>
                <span className="pipeline-activity-time">[{entry.time || telemetryTimestamp()}]</span>
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
    </div>
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
  const [folderMode, setFolderMode] = useState("bulk");
  const [doUpscale, setDoUpscale] = useState(true);
  const [scale, setScale] = useState("2");
  const [doRembg, setDoRembg] = useState(true);
  const [canvasSize, setCanvasSize] = useState("1440");
  const [thumbnail, setThumbnail] = useState(true);
  const [rembgModel, setRembgModel] = useState("birefnet-general");
  const [upscaleMaxPx, setUpscaleMaxPx] = useState("");
  const [reuseExactDuplicates, setReuseExactDuplicates] = useState(true);
  const [rembgModels, setRembgModels] = useState(["birefnet-general"]);
  const [logOpen, setLogOpen] = useState(true);
  const [resumeSession, setResumeSession] = useState(null);
  const [showResume, setShowResume] = useState(false);
  const doneNotifiedRef = useRef(false);

  // BUG-15 FIX: split settings loading into two concerns:
  // 1. loadSettings — loads non-path settings (model, flags, sizes).
  // 2. A mount-only effect restores saved paths from settings.json once.
  // Both are mount-only so focus changes or folder pickers can't overwrite
  // in-session edits.
  const loadSettings = useCallback(() => {
    fetch(`${BASE}/models/rembg`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (Array.isArray(data?.models) && data.models.length) setRembgModels(data.models);
      })
      .catch(() => {});

    fetch(`${BASE}/settings`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.settings) return;
        const s = data.settings;
        // BUG-15 FIX: only non-path settings here — no setInputDir / setOutputDir
        if (s.output?.folder_mode) setFolderMode(s.output.folder_mode);
        if (typeof s.output?.do_upscale === "boolean") setDoUpscale(s.output.do_upscale);
        if (s.output?.upscale_scale === "2" || s.output?.upscale_scale === "4") setScale(s.output.upscale_scale);
        if (s.output?.canvas_size) setCanvasSize(String(s.output.canvas_size));
        if (typeof s.output?.thumbnail === "boolean") setThumbnail(s.output.thumbnail);
        if (s.processing?.rembg_model) setRembgModel(s.processing.rembg_model);
        if (typeof s.processing?.reuse_exact_duplicates === "boolean") {
          setReuseExactDuplicates(s.processing.reuse_exact_duplicates);
        }
        if (Object.prototype.hasOwnProperty.call(s.processing ?? {}, "upscale_max_px")) {
          const savedMaxPx = Number(s.processing.upscale_max_px);
          setUpscaleMaxPx(Number.isFinite(savedMaxPx) && savedMaxPx > 0 ? String(savedMaxPx) : "");
        }
      })
      .catch(() => {});
  }, []);

  // Load non-path settings on mount only.
  // This avoids overwriting in-session edits when the window regains focus
  // (for example, after native folder picker closes).
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    fetch(`${BASE}/session`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.exists) { setResumeSession(data); setShowResume(true); }
      })
      .catch(() => {});
  }, []);

  const {
    running, done, log, errors, imageDone, imageError,
    totalImages, elapsed, stage,
    upStats, bgStats, imageProgress, oomGpuCount, previewPath, livePreviewStrip,
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
        const r = await fetch(`${BASE}/session`);
        const data = r.ok ? await r.json() : null;
        session = data?.exists ? data : null;
      } catch {
        void 0;
      }
      onPipelineDone?.({
        canvasSize: parseInt(canvasSize, 10) || 1440,
        thumbnail,
        session,
      });
    })();
  }, [done, onPipelineDone, canvasSize, thumbnail]);

  const handleStart = useCallback(() => {
    const removedIds = removedImages ? [...removedImages] : [];
    const skipList = expandedImageTokens(removedIds, thumbs, inputDir);
    const activeExcludeIds = excludeTags.filter(n => !removedImages?.has(n));
    const activeExclude = expandedImageTokens(activeExcludeIds, thumbs, inputDir);
    const parsedUpscaleMaxPx = Number.parseInt(upscaleMaxPx, 10);
    start({
      folderMode, doUpscale, scale, doRembg, inputDir, outputDir,
      excludeList: activeExclude, skipList, rembgModel, resume: false,
      upscaleMaxPx: Number.isFinite(parsedUpscaleMaxPx) && parsedUpscaleMaxPx > 0 ? parsedUpscaleMaxPx : 0,
      reuseExactDuplicates,
    });
    rememberInputDir?.(inputDir);
    rememberOutputDir?.(outputDir);
    setShowResume(false);
  }, [start, folderMode, doUpscale, scale, doRembg, inputDir, outputDir, excludeTags, removedImages, thumbs, rembgModel, upscaleMaxPx, reuseExactDuplicates, rememberInputDir, rememberOutputDir]);

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
      upscaleMaxPx: Number.isFinite(parsedUpscaleMaxPx) && parsedUpscaleMaxPx > 0 ? parsedUpscaleMaxPx : 0,
      reuseExactDuplicates,
    });
    rememberInputDir?.(resumeInputDir);
    rememberOutputDir?.(resumeOutputDir);
    setShowResume(false);
  }, [resumeSession, setInputDir, setOutputDir, removedImages, excludeTags, thumbs, start, folderMode, doUpscale, scale, doRembg, outputDir, rembgModel, upscaleMaxPx, reuseExactDuplicates, rememberInputDir, rememberOutputDir]);

  const handleStartFresh = useCallback(async () => {
    try { await fetch(`${BASE}/session`, { method: "DELETE" }); } catch { void 0; }
    setShowResume(false);
    setResumeSession(null);
  }, []);

  const handleReuseExactDuplicatesChange = useCallback((enabled) => {
    setReuseExactDuplicates(enabled);
    saveProcessingSettingsPatch({ reuse_exact_duplicates: enabled }).catch(() => {});
  }, []);

  const nothingSelected = !doUpscale && !doRembg;
  const skipCount = removedImages?.size ?? 0;
  const activeExcludeCount = excludeTags.filter(n => !removedImages?.has(n)).length;

  return (
    <div className="pipeline-screen" style={{
      display: "flex", flexDirection: "column", background: C.bg, height: "100%",
      overflow: "hidden", fontFamily: "'Outfit','DM Sans',system-ui,sans-serif",
      color: C.text, fontSize: 13
    }}>
      <style>{`
        button:hover { filter: brightness(1.15); }
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:var(--scrollbar);border-radius:2px}
        select option{background:var(--panel2)}
      `}</style>

      <div className="pipeline-header">
        <div className="pipeline-header-title">Process · Pipeline</div>
        <div className="pipeline-header-actions">
          {!running ? (
            <button
              className="pipeline-btn pipeline-header-run-button"
              onClick={handleStart}
              disabled={nothingSelected}
            >
              ▶  Run Pipeline
            </button>
          ) : (
            <button
              className="pipeline-btn pipeline-header-stop-button"
              onClick={stop}
            >
              ■  Stop
            </button>
          )}
          {done && !running && (
            <button
              className="pipeline-btn pipeline-secondary-button pipeline-open-editor-button"
              onClick={() => onGoToEditor?.({ canvasSize: parseInt(canvasSize, 10) || 1440, thumbnail })}
            >
              Open Editor →
            </button>
          )}
        </div>
      </div>

      <div className="pipeline-main pipeline-layout" style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0 }}>

        {/* Sidebar */}
        <div className="pipeline-settings-panel" style={{
          width: 300, background: C.panel, borderRight: `1px solid ${C.border}`,
          padding: "14px", display: "flex", flexDirection: "column",
          flexShrink: 0, overflow: "hidden"
        }}>
          <div className="pipeline-settings-scroll">
          {showResume && resumeSession && (
            <div className="pipeline-resume-card" style={{
              marginBottom: 12,
              background: "color-mix(in srgb, var(--accent) 10%, transparent)",
              border: `1px solid color-mix(in srgb, var(--accent) 35%, transparent)`,
              borderRadius: 6, padding: "10px 10px 8px",
            }}>
              <button
                className="pipeline-resume-dismiss"
                onClick={() => setShowResume(false)}
                aria-label="Dismiss resume prompt"
              >
                ×
              </button>
              <div style={{ fontSize: 11, color: C.text, fontWeight: 600, marginBottom: 4 }}>
                Resume previous session?
              </div>
              <div style={{ fontSize: 10, color: C.dim, lineHeight: 1.5 }}>
                {Math.max(0, (resumeSession.total ?? 0) - (resumeSession.queue_index ?? 0))} image(s) remaining
              </div>
              <div style={{ fontSize: 9, color: C.dim2, fontFamily: "JetBrains Mono", marginTop: 4, wordBreak: "break-all" }}>
                {resumeSession.src_root}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button className="pipeline-btn pipeline-run-button" onClick={handleResume} style={{
                  flex: 1, background: C.greenBg, color: C.green, border: `1px solid ${C.greenBdr}`,
                  borderRadius: 6, padding: "6px 8px", fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                }}>Resume</button>
                <button className="pipeline-btn pipeline-secondary-button" onClick={handleStartFresh} style={{
                  flex: 1, background: C.panel2, color: C.dim, border: `1px solid ${C.border}`,
                  borderRadius: 6, padding: "6px 8px", fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                }}>Start fresh</button>
              </div>
            </div>
          )}

          <ProcessPanelSection title="Folders">
            <div className="pipeline-panel-field">
              <FieldLabel>Input folder</FieldLabel>
              <FolderInput
                value={inputDir}
                onChange={setInputDir}
                placeholder="default: ./input"
                recent={recentInputDirs}
                onRemember={rememberInputDir}
              />
            </div>
            <div className="pipeline-panel-field">
              <FieldLabel>Output folder</FieldLabel>
              <FolderInput
                value={outputDir}
                onChange={setOutputDir}
                placeholder="default: ./output"
                recent={recentOutputDirs}
                onRemember={rememberOutputDir}
              />
            </div>
          </ProcessPanelSection>

          <ProcessPanelSection title="Processing">
            <Row label="Folder mode">
              <Btn label="Bulk" active={folderMode === "bulk"} onClick={() => setFolderMode("bulk")} />
              <Btn label="Clean" active={folderMode === "clean"} onClick={() => setFolderMode("clean")} />
            </Row>

            <Row label="Upscale (NCNN)">
              <PillToggle value={doUpscale} onChange={setDoUpscale} />
            </Row>

            {doUpscale && (
              <Row label="Scale factor">
                <Btn label="2×" active={scale === "2"} onClick={() => setScale("2")} />
                <Btn label="4×" active={scale === "4"} onClick={() => setScale("4")} />
              </Row>
            )}

            <Row label="Remove BG">
              <PillToggle value={doRembg} onChange={setDoRembg} />
            </Row>
            <Row label="Reuse exact duplicates" className="pipeline-row-duplicate-reuse" controlsClassName="pipeline-row-controls-wrap">
              <div className="pipeline-duplicate-toggle">
                <span>Process identical files once and copy results to duplicates.</span>
                <PillToggle value={reuseExactDuplicates} onChange={handleReuseExactDuplicatesChange} />
              </div>
            </Row>
            {doRembg && (
              <Row label="BG model">
                <select
                  value={rembgModel} onChange={e => setRembgModel(e.target.value)}
                  style={{
                    background: C.panel2, color: C.text, border: `1px solid ${C.border}`,
                    borderRadius: 4, padding: "4px 8px", fontSize: 11, width: 170,
                    outline: "none", fontFamily: "inherit", colorScheme: "dark",
                  }}
                >
                  {rembgModels.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </Row>
            )}
          </ProcessPanelSection>

          <ProcessPanelSection title="Output Settings">
            <Row label="Skip upscale if any side >=" className="pipeline-row-output-limit" controlsClassName="pipeline-row-controls-wrap">
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="number"
                  value={upscaleMaxPx}
                  onChange={e => setUpscaleMaxPx(e.target.value)}
                  placeholder="no limit"
                  min={256} max={8192}
                  style={{
                    width: 90, background: C.panel2, color: C.text,
                    border: `1px solid ${C.border}`, borderRadius: 4,
                    padding: "4px 5px", fontSize: 11, fontFamily: "JetBrains Mono",
                    outline: "none", textAlign: "center"
                  }}
                />
                <span style={{ fontSize: 10, color: C.dim }}>empty = no limit</span>
              </div>
            </Row>

            <Row label="Canvas size (px)" className="pipeline-row-canvas-size" controlsClassName="pipeline-row-controls-wrap">
              <div className="pipeline-canvas-size-controls" style={{ display: "flex", gap: 4, alignItems: "center" }}>
                {["1080", "1440", "2048"].map(s => (
                  <Btn key={s} label={s} active={canvasSize === s} onClick={() => setCanvasSize(s)} />
                ))}
                <input type="number" value={canvasSize} onChange={e => setCanvasSize(e.target.value)}
                  min={256} max={8192}
                  style={{
                    width: 54, background: C.panel2, color: C.text,
                    border: `1px solid ${C.border}`, borderRadius: 4,
                    padding: "4px 5px", fontSize: 11, fontFamily: "JetBrains Mono",
                    outline: "none", textAlign: "center"
                  }}
                />
              </div>
            </Row>
          </ProcessPanelSection>

          </div>

          {/* Action buttons */}
          <div className="pipeline-top pipeline-settings-actions" style={{ paddingTop: 12 }}>
            <button
              className="pipeline-btn pipeline-secondary-button"
              onClick={() => openFolder(outputDir.trim())}
              style={{
                width: "100%", marginTop: 0, padding: "10px 0",
                background: C.panel2, color: C.dim, border: `1px solid ${C.border}`,
                borderRadius: 8, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              📁 Open Output Folder
            </button>
          </div>
        </div>

        {/* Right zone */}
        <div className="pipeline-results-area pipeline-workspace" style={{ flex: 1, display: "flex", minWidth: 0, minHeight: 0, padding: "0 12px 12px 12px", overflowY: "auto", overflowX: "hidden" }}>
          <div className="pipeline-results-column" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, gap: 10 }}>

            <div className="pipeline-status-area" style={{ flex: "0 0 auto", minHeight: 0, display: "flex", flexDirection: "column" }}>
              <div className="pipeline-status-card-slot">
                {(running || done) && (
                  <Zone2
                    upStats={upStats} bgStats={bgStats}
                    totalImages={totalImages} elapsed={elapsed}
                    done={done} stage={stage}
                    doUpscale={doUpscale} doRembg={doRembg}
                    oomGpuCount={oomGpuCount}
                    imageProgress={imageProgress}
                  />
                )}
                {!running && !done && (
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

              <div className="pipeline-live-area">
                <Zone1
                  imageDone={imageDone} totalImages={totalImages}
                  previewPath={previewPath}
                  livePreviewStrip={livePreviewStrip}
                />
              </div>
            </div>

            <div className="pipeline-bottom-panels" style={{ flex: "1 1 auto", minHeight: 210, display: "flex", flexDirection: "column", gap: 8 }}>
              <ActivityPanel
                logRef={logRef} log={log} running={running}
                open={logOpen} setOpen={setLogOpen}
                errors={errors} imageError={imageError}
                imageProgress={imageProgress}
              />
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}


