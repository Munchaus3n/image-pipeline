import { useState, useRef, useEffect, useCallback } from "react";
/*
KNOWN LIMITATIONS (web build):
- Focus-based settings reload is a temporary sync workaround; desktop Electron should use explicit app events.
- /api/browse relies on tkinter; Electron should use native dialog APIs.
- Editor refresh still depends on UI state transitions rather than native IPC events.
*/

const BASE = "/api";

// Opens a folder in the native OS file explorer via the API server.
// path="" â†’ server defaults to OUTPUT_ROOT.
const openFolder = (path = "") =>
  fetch(`${BASE}/open-folder?path=${encodeURIComponent(path)}`).catch(() => {});

const C = {
  bg:      "var(--bg)",      panel:   "var(--panel)",   panel2:  "var(--panel2)",
  border:  "var(--border)",  text:    "var(--text)",    dim:     "var(--dim)",
  dim2:    "var(--dim2)",    accent:  "var(--accent)",
  green:   "var(--green)",   greenBg: "var(--green-bg)", greenBdr: "var(--green-bdr)",
  red:     "var(--red)",     redBg:   "var(--red-bg)",   redBdr:  "var(--red-bdr)",
  yellow:  "var(--yellow)",  blue:    "var(--accent)",   magenta: "var(--magenta)",
};

const PIPELINE_DEFAULTS = {
  folderMode: "bulk",
  doUpscale: true,
  scale: "2",
  doRembg: true,
  canvasSize: "1440",
  thumbnail: true,
  rembgModel: "birefnet-general",
  upscaleMaxPx: "",
};

function mergeSettingsDefaults(current, incomingSettings = {}, editedKeys = new Set()) {
  const out = incomingSettings?.output ?? {};
  const proc = incomingSettings?.processing ?? {};

  const incoming = {
    folderMode: out.folder_mode === "clean" ? "clean" : "bulk",
    doUpscale: typeof out.do_upscale === "boolean" ? out.do_upscale : PIPELINE_DEFAULTS.doUpscale,
    scale: out.upscale_scale === "4" ? "4" : "2",
    doRembg: typeof out.do_rembg === "boolean" ? out.do_rembg : PIPELINE_DEFAULTS.doRembg,
    canvasSize: Number.isFinite(Number(out.canvas_size)) && Number(out.canvas_size) > 0
      ? String(out.canvas_size)
      : PIPELINE_DEFAULTS.canvasSize,
    thumbnail: typeof out.thumbnail === "boolean" ? out.thumbnail : PIPELINE_DEFAULTS.thumbnail,
    rembgModel: typeof proc.rembg_model === "string" && proc.rembg_model.trim()
      ? proc.rembg_model.trim()
      : PIPELINE_DEFAULTS.rembgModel,
    upscaleMaxPx: Number.isFinite(Number(proc.upscale_max_px)) && Number(proc.upscale_max_px) > 0
      ? String(Number(proc.upscale_max_px))
      : PIPELINE_DEFAULTS.upscaleMaxPx,
  };

  const merged = { ...current };
  for (const key of Object.keys(incoming)) {
    if (!editedKeys.has(key)) merged[key] = incoming[key];
  }
  return merged;
}

// â”€â”€ Primitives â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function Row({ label, children }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "7px 0", borderBottom: `1px solid ${C.border}`
    }}>
      <span style={{ fontSize: 12, color: C.dim }}>{label}</span>
      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>{children}</div>
    </div>
  );
}

function Btn({ label, active, color, onClick, style = {} }) {
  const bg  = active ? (color ? color + "22" : "color-mix(in srgb, var(--accent) 12%, transparent)") : "transparent";
  const fg  = active ? (color || C.text) : C.dim;
  const bdr = active ? (color ? color + "55" : "color-mix(in srgb, var(--accent) 35%, transparent)") : "transparent";
  return (
    <button onClick={onClick} style={{
      background: bg, color: fg, border: `1px solid ${bdr}`,
      borderRadius: 8, padding: "4px 12px", fontSize: 11, minWidth: 42,
      cursor: "pointer", fontFamily: "inherit", fontWeight: active ? 600 : 400,
      ...style,
    }}>{label}</button>
  );
}

function PillToggle({ value, onChange }) {
  return (
    <div onClick={() => onChange(!value)} style={{
      width: 40, height: 22, borderRadius: 11, cursor: "pointer", flexShrink: 0,
      background: value ? C.greenBg : C.redBg,
      border: `1px solid ${value ? C.greenBdr : C.redBdr}`,
      position: "relative", transition: "background 0.2s ease, border-color 0.2s ease",
    }}>
      <div style={{
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

function FolderInput({ value, onChange, placeholder }) {
  const browse = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/browse?initial=${encodeURIComponent(value)}`);
      const { path } = await r.json();
      if (path) onChange(path);
    } catch { void 0; }
  }, [value, onChange]);

  return (
    <div style={{ display: "flex", gap: 4, width: "100%" }}>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{
          flex: 1, background: C.panel2, color: C.text,
          border: `1px solid ${C.border}`, borderRadius: 4,
          padding: "5px 8px", fontSize: 11, fontFamily: "JetBrains Mono",
          outline: "none", minWidth: 0
        }}
      />
      <button onClick={browse} style={{
        background: C.panel2, color: C.dim,
        border: `1px solid ${C.border}`, borderRadius: 8, padding: "5px 9px",
        fontSize: 12, cursor: "pointer", fontFamily: "inherit", flexShrink: 0
      }}>â€¦</button>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, letterSpacing: "0.12em", color: C.dim,
      textTransform: "uppercase", fontWeight: 700, marginBottom: 8
    }}>
      {children}
    </div>
  );
}

function FieldLabel({ children }) {
  return <div style={{ fontSize: 11, color: C.dim, marginBottom: 4 }}>{children}</div>;
}

function Spinner({ color = C.yellow, size = 12 }) {
  const ch = ["â ‹", "â ™", "â ¹", "â ¸", "â ¼", "â ´", "â ¦", "â §", "â ‡", "â "];
  const [f, setF] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setF(x => (x + 1) % ch.length), 80);
    return () => clearInterval(t);
  }, [ch.length]);
  return <span style={{ fontFamily: "JetBrains Mono", fontSize: size, color }}>{ch[f]}</span>;
}

// â”€â”€ Pipeline hook â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const KIND_COLOR = {
  ok: "#4ade80", error: "#f87171", warn: "#facc15",
  skip: "#4a5a7a", section: "#7aa4d4", info: "#4a5a7a",
};

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
  const [stagesDone, setStagesDone] = useState({ upscale: false, rembg: false });
  const [upStats, setUpStats] = useState({ done: 0, skip: 0, err: 0 });
  const [bgStats, setBgStats] = useState({ done: 0, skip: 0, err: 0 });
  const [oomGpuCount, setOomGpuCount] = useState(0);
  const [imageProgress, setImageProgress] = useState({});

  const abortRef    = useRef(null);
  const logRef      = useRef(null);
  const errorRef    = useRef(null);
  const timerRef    = useRef(null);
  const startRef    = useRef(null);
  const doneSet     = useRef(new Set());
  const skipSet     = useRef(new Set());
  const errSet      = useRef(new Set());
  const sentinelSet = useRef(new Set());
  const stageRef    = useRef("upscale");
  const recentLog   = useRef([]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);
  useEffect(() => {
    if (errorRef.current) errorRef.current.scrollTop = errorRef.current.scrollHeight;
  }, [errors]);
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
    if (/â†’ bg_removed/.test(raw) || /â†’ upscaled/.test(raw)) return "ok";
    if (/âœ“/.test(raw)) return "ok";
    if (/âœ—|Error|error|failed on |Traceback|Exception/i.test(raw)) return "error";
    if (/âš |warn/i.test(raw)) return "warn";
    if (/â†·|skip|already (upscaled|processed)/i.test(raw)) return "skip";
    if (/Stage \d|â”€{4,}|â•{4,}/.test(raw)) return "section";
    return "info";
  }, []);

  const appendLine = useCallback((raw) => {
    // â”€â”€ Structured machine-readable tokens â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (raw.startsWith("__total__:")) {
      const n = parseInt(raw.slice(10), 10);
      if (!isNaN(n)) setTotalImages(n);
      return;
    }
    if (raw.startsWith("__ok_upscale__:")) {
      const fname = raw.slice(15);
      setImageProgress(prev => ({ ...prev, [fname]: { stage: "upscale", percent: 50, status: "ok" } }));
      if (!doneSet.current.has(fname)) {
        doneSet.current.add(fname);
        setImageDone(doneSet.current.size);
        setRecentDone(prev => [fname, ...prev].slice(0, 8));
      }
      setUpStats(s => ({ ...s, done: s.done + 1 }));
      return;
    }
    if (raw.startsWith("__ok_rembg__:")) {
      const fname = raw.slice(13);
      setImageProgress(prev => ({ ...prev, [fname]: { stage: "rembg", percent: 100, status: "ok" } }));
      if (!doneSet.current.has(fname)) {
        doneSet.current.add(fname);
        setImageDone(doneSet.current.size);
        setRecentDone(prev => [fname, ...prev].slice(0, 8));
      }
      setBgStats(s => ({ ...s, done: s.done + 1 }));
      return;
    }
    if (raw.startsWith("__skip_upscale__:")) {
      const fname = raw.slice(17);
      setImageProgress(prev => ({ ...prev, [fname]: { stage: "upscale", percent: 50, status: "skip" } }));
      if (!skipSet.current.has(fname)) { skipSet.current.add(fname); setImageSkipped(skipSet.current.size); }
      setUpStats(s => ({ ...s, skip: s.skip + 1 }));
      return;
    }
    if (raw.startsWith("__skip_rembg__:")) {
      const fname = raw.slice(15);
      setImageProgress(prev => ({ ...prev, [fname]: { stage: "rembg", percent: 100, status: "skip" } }));
      if (!skipSet.current.has(fname)) { skipSet.current.add(fname); setImageSkipped(skipSet.current.size); }
      setBgStats(s => ({ ...s, skip: s.skip + 1 }));
      return;
    }
    if (raw.startsWith("__err_upscale__:")) {
      const fname = raw.slice(16);
      setImageProgress(prev => ({ ...prev, [fname]: { stage: "upscale", percent: 50, status: "error" } }));
      if (!errSet.current.has(fname)) { errSet.current.add(fname); setImageError(errSet.current.size); }
      setUpStats(s => ({ ...s, err: s.err + 1 }));
      return;
    }
    if (raw.startsWith("__err_rembg__:")) {
      const fname = raw.slice(14);
      setImageProgress(prev => ({ ...prev, [fname]: { stage: "rembg", percent: 100, status: "error" } }));
      if (!errSet.current.has(fname)) { errSet.current.add(fname); setImageError(errSet.current.size); }
      setBgStats(s => ({ ...s, err: s.err + 1 }));
      return;
    }
    if (raw.startsWith("__err_oom_gpu__:")) {
      const fname = raw.slice(16);
      setImageProgress(prev => ({ ...prev, [fname]: { stage: "rembg", percent: 100, status: "oom" } }));
      setOomGpuCount(c => c + 1);
      setLog(prev => [...prev.slice(-800), { raw: `GPU OOM fallback â†’ CPU retry: ${fname}`, kind: "warn" }]);
      return;
    }

    if (raw.startsWith("__processing__:")) {
      const fullPath = raw.slice(15);
      const fileName = fullPath.replace(/.*[/\\]/, "");
      if (!sentinelSet.current.has(fileName)) {
        sentinelSet.current.add(fileName);
        setLog(prev => [...prev.slice(-800), { raw: "", kind: "progress", filename: fileName }]);
        setImageProgress(prev => ({ ...prev, [fileName]: { stage: "upscale", percent: 0, status: "running" } }));
      } else {
        setImageProgress(prev => ({ ...prev, [fileName]: { ...prev[fileName], status: "running" } }));
      }
      return;
    }

    // â”€â”€ Human-readable log lines â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const kind = classify(raw);
    const entry = { raw, kind };
    setLog(prev => [...prev.slice(-800), entry]);

    recentLog.current = [...recentLog.current.slice(-4), raw];

    if (/Stage 1|Upscaling/.test(raw)) {
      stageRef.current = "upscale";
      setStage("upscale");
    } else if (/Stage 2|Background Removal/.test(raw)) {
      stageRef.current = "rembg";
      setStagesDone(s => ({ ...s, upscale: true }));
      setStage("rembg");
    }

    if (kind === "error") {
      setErrors(prev => {
        if (prev[prev.length - 1]?.raw === raw) return prev;
        return [...prev.slice(-200), { raw, kind, context: [...recentLog.current.slice(0, -1)] }];
      });
    }
  }, [classify]);

  const start = useCallback(async ({ folderMode, doUpscale, scale, doRembg, inputDir, outputDir, excludeList = [], skipList = [], rembgModel = "", resume = false, upscaleMaxPx = 0 }) => {
    if (running) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLog([]); setErrors([]);
    setImageDone(0); setImageSkipped(0); setImageError(0);
    setTotalImages(0); setRecentDone([]);
    setElapsed(0); setDone(false); setRunning(true);
    setStage(null); setStagesDone({ upscale: false, rembg: false });
    setUpStats({ done: 0, skip: 0, err: 0 });
    setBgStats({ done: 0, skip: 0, err: 0 });
    setOomGpuCount(0);
    setImageProgress({});
    stageRef.current = "upscale";
    recentLog.current = [];
    doneSet.current = new Set(); skipSet.current = new Set(); errSet.current = new Set(); sentinelSet.current = new Set();

    try {
      const r = await fetch(`${BASE}/pipeline/run`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_mode: folderMode, do_upscale: doUpscale, scale,
          do_rembg: doRembg, input_dir: inputDir.trim(), output_dir: outputDir.trim(),
          exclude_rembg: excludeList, skip_files: skipList, rembg_model: rembgModel, resume,
          upscale_max_px: upscaleMaxPx,
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
            appendLine(msg.includes("exit=0") ? "âœ“ Pipeline complete." : "âœ— Pipeline exited with errors.");
            setStagesDone({ upscale: true, rembg: true });
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
    totalImages, recentDone, elapsed, stage, stagesDone,
    upStats, bgStats, imageProgress, oomGpuCount,
    logRef, errorRef, start, stop
  };
}

// â”€â”€ Zone 1: Drop zone / Live stage animation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function Zone1({ running, done, stage, stagesDone, recentDone,
  imageDone, totalImages, doUpscale, doRembg, inputDir, setInputDir, rembgModel }) {
  const [dragOver, setDragOver] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState([]);
  const [browseLoading, setBrowseLoading] = useState(false);

  const onDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); };
  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    const names = files.map(f => f.name);
    setDroppedFiles(names);
    const p = files[0].path;
    if (p) {
      const folder = p.replace(/[/\\][^/\\]+$/, "");
      setInputDir(folder);
    } else {
      browseInput();
    }
  };

  const browseInput = async () => {
    setBrowseLoading(true);
    try {
      const r = await fetch(`${BASE}/browse?initial=${encodeURIComponent(inputDir)}`);
      const { path } = await r.json();
      if (path) { setInputDir(path); setDroppedFiles([]); }
    } catch { void 0; }
    setBrowseLoading(false);
  };

  if (!running && !done) return (
    <div onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
      style={{
        flex: 1, display: "flex", flexDirection: "column",
        margin: "12px 12px 0 0", borderRadius: 6, overflow: "hidden",
        border: `2px dashed ${dragOver ? C.blue : C.border}`,
        background: dragOver ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "transparent",
        transition: "border-color 0.15s, background 0.15s"
      }}>

      {droppedFiles.length === 0 ? (
        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 10, padding: 20
        }}>
          <div style={{ fontSize: 28, opacity: 0.18 }}>â¬‡</div>
          <div style={{ fontSize: 13, color: C.dim, textAlign: "center", lineHeight: 1.8 }}>
            Drop images here to set input folder
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button onClick={browseInput} disabled={browseLoading} style={{
              background: C.panel2, color: C.text, border: `1px solid ${C.border}`,
              borderRadius: 4, padding: "6px 16px", fontSize: 12, cursor: "pointer",
              fontFamily: "inherit", opacity: browseLoading ? 0.6 : 1
            }}>
              {browseLoading ? "â€¦" : "Browse folder"}
            </button>
          </div>
          {inputDir && (
            <div style={{
              fontSize: 10, color: C.green, fontFamily: "JetBrains Mono",
              maxWidth: 360, textAlign: "center", wordBreak: "break-all", marginTop: 4
            }}>
              {inputDir}
            </div>
          )}
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 12, overflow: "hidden" }}>
          <div style={{ fontSize: 11, color: C.green, marginBottom: 8 }}>
            {droppedFiles.length} file{droppedFiles.length > 1 ? "s" : ""} from{" "}
            <span style={{ fontFamily: "JetBrains Mono", fontSize: 10, color: C.dim }}>
              {inputDir || "dropped folder"}
            </span>
            <button onClick={() => { setDroppedFiles([]); setInputDir(""); }}
              style={{
                marginLeft: 10, background: "transparent", color: C.dim, border: "none",
                fontSize: 11, cursor: "pointer", fontFamily: "inherit"
              }}>clear Ã—</button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, overflowY: "auto", alignContent: "flex-start" }}>
            {droppedFiles.map((f, i) => (
              <div key={i} style={{
                background: C.panel2, border: `1px solid ${C.border}`,
                borderRadius: 3, padding: "3px 8px", fontSize: 10,
                fontFamily: "JetBrains Mono", color: C.text,
                maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
              }}>{f}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  if (done) return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", gap: 14, margin: "12px 12px 0 0", borderRadius: 6,
      border: `1px solid ${C.border}`, background: C.panel
    }}>
      <div style={{ fontSize: 32, color: C.green, lineHeight: 1 }}>âœ“</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: C.green }}>Pipeline complete</div>
      <div style={{ display: "flex", gap: 20 }}>
        <SmStat label="Done" value={imageDone} color={C.green} />
        <SmStat label="Total" value={totalImages || "â€”"} color={C.dim} />
      </div>
    </div>
  );

  const stages = [
    { id: "upscale", label: "Upscaling",  sub: "NCNN Vulkan",              active: stage === "upscale", done: stagesDone.upscale, skip: !doUpscale },
    { id: "rembg",   label: "Remove BG",  sub: rembgModel || "birefnet-general", active: stage === "rembg",   done: stagesDone.rembg,   skip: !doRembg  },
  ];

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      margin: "12px 12px 0 0", borderRadius: 6,
      border: `1px solid ${C.border}`, background: C.panel, overflow: "hidden"
    }}>
      <style>{`
        @keyframes pulseFade { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes flowDot   { 0%{transform:translateX(0);opacity:0.15} 50%{transform:translateX(16px);opacity:1} 100%{transform:translateX(32px);opacity:0.15} }
        @keyframes slideIn   { from{opacity:0;transform:translateX(-8px)} to{opacity:1;transform:translateX(0)} }
      `}</style>

      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        {stages.map(s => (
          <div key={s.id} style={{
            flex: 1, textAlign: "center", padding: "6px 0",
            fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700,
            color: s.done ? C.green : s.active ? C.yellow : s.skip ? C.dim2 : C.dim
          }}>{s.label}</div>
        ))}
      </div>

      <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "0 16px", gap: 0, minHeight: 0 }}>
        {stages.map((s, i) => {
          const cardBg   = s.done ? "var(--green-bg)" : s.active ? "color-mix(in srgb, var(--accent) 10%, transparent)" : C.panel2;
          const cardBdr  = s.done ? "var(--green-bdr)" : s.active ? "color-mix(in srgb, var(--accent) 40%, transparent)" : C.border;
          const cardGlow = s.active ? "0 0 14px color-mix(in srgb, var(--accent) 30%, transparent)" : s.done ? "0 0 8px color-mix(in srgb, var(--green) 20%, transparent)" : "none";
          const textColor = s.done ? C.green : s.active ? C.yellow : s.skip ? C.dim2 : C.dim;
          return (
            <div key={s.id} style={{ display: "flex", alignItems: "center", flex: 1 }}>
              <div style={{
                flex: 1, background: cardBg, border: `1px solid ${cardBdr}`,
                borderRadius: 5, padding: "14px 10px", textAlign: "center",
                boxShadow: cardGlow, transition: "all 0.4s ease"
              }}>
                {s.done && <div style={{ fontSize: 20, color: C.green, lineHeight: 1, marginBottom: 4 }}>âœ“</div>}
                {s.active && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, animation: "pulseFade 1.4s ease-in-out infinite" }}>
                    <Spinner color={C.yellow} size={13} />
                    <span style={{ fontSize: 10, color: C.yellow, fontWeight: 600 }}>{s.sub}</span>
                  </div>
                )}
                {!s.active && !s.done && (
                  <div style={{ fontSize: 10, color: textColor }}>
                    {s.skip ? "skipped" : s.sub}
                  </div>
                )}
                <div style={{ fontSize: 9, color: textColor, marginTop: 5, opacity: 0.6, letterSpacing: "0.06em" }}>{s.label}</div>
              </div>
              {i < stages.length - 1 && (
                <div style={{ width: 28, height: 2, background: C.dim2, flexShrink: 0, position: "relative", margin: "0 4px" }}>
                  <div style={{
                    position: "absolute", top: -4, left: 0, width: 8, height: 8,
                    borderRadius: "50%", background: s.done ? C.green : C.yellow,
                    opacity: s.done ? 0.5 : 0.7,
                    animation: s.active || s.done ? `flowDot 1.4s ease-in-out infinite` : "none",
                    animationDelay: `${i * 0.46}s`
                  }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {recentDone.length > 0 && (
        <div style={{
          borderTop: `1px solid ${C.border}`, padding: "5px 12px",
          display: "flex", gap: 4, overflowX: "hidden", flexShrink: 0, alignItems: "center"
        }}>
          <span style={{ fontSize: 8, color: C.dim, textTransform: "uppercase", letterSpacing: "0.08em", flexShrink: 0 }}>Done:</span>
          {recentDone.slice(0, 5).map((f, i) => (
            <div key={i} style={{
              background: "var(--green-bg)", border: `1px solid var(--green-bdr)`,
              borderRadius: 3, padding: "2px 6px", fontSize: 8,
              fontFamily: "JetBrains Mono", color: C.green, flexShrink: 0,
              animation: "slideIn 0.2s ease",
              maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
            }}>âœ“ {f}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function SmStat({ label, value, color }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 24, fontWeight: 700, color, fontFamily: "JetBrains Mono", lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: C.dim, marginTop: 3, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
    </div>
  );
}

// â”€â”€ LivePreview â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function LivePreview({ running, done, previewPath, imageDone, totalImages }) {
  const [loadedSrc, setLoadedSrc] = useState("");
  const src = previewPath ? `${BASE}/image?path=${encodeURIComponent(previewPath)}` : "";
  const loaded = Boolean(src) && loadedSrc === src;

  if (done && !running) return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", gap: 14, borderRadius: 6,
      border: `1px solid ${C.border}`, background: C.panel, minHeight: 0,
    }}>
      <div style={{ fontSize: 36, color: C.green }}>âœ“</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: C.green }}>Pipeline complete</div>
      <div style={{ display: "flex", gap: 24 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: C.green, fontFamily: "JetBrains Mono" }}>{imageDone}</div>
          <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase" }}>Done</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: C.dim, fontFamily: "JetBrains Mono" }}>{totalImages || "â€”"}</div>
          <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase" }}>Total</div>
        </div>
      </div>
      {previewPath && (
        <img src={src} alt="" style={{ maxHeight: 180, maxWidth: "80%", objectFit: "contain", borderRadius: 4, opacity: 0.5 }} />
      )}
    </div>
  );

  return (
    <div style={{
      flex: 1, position: "relative", borderRadius: 6, overflow: "hidden",
      background: "var(--img-bg)", border: `1px solid ${C.border}`, minHeight: 0,
    }}>
      <style>{`
        @keyframes previewFadeIn { from{opacity:0} to{opacity:1} }
        @keyframes loadingPulse  { 0%,100%{opacity:0.4} 50%{opacity:0.8} }
      `}</style>
      {src ? (
        <>
          {!loaded && (
            <div style={{
              position: "absolute", inset: 0, display: "flex", alignItems: "center",
              justifyContent: "center", animation: "loadingPulse 1.2s ease-in-out infinite",
            }}>
              <Spinner color={C.dim} size={18} />
            </div>
          )}
          <img
            key={src} src={src} alt=""
            onLoad={() => setLoadedSrc(src)} onError={() => setLoadedSrc(src)}
            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block",
              opacity: loaded ? 1 : 0, transition: "opacity 0.3s ease" }}
          />
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0,
            padding: "16px 10px 6px",
            background: "linear-gradient(transparent, rgba(0,0,0,0.6))",
            fontSize: 9, color: "rgba(255,255,255,0.55)", fontFamily: "JetBrains Mono",
            pointerEvents: "none", overflow: "hidden", textOverflow: "ellipsis",
            whiteSpace: "nowrap", textAlign: "center",
          }}>
            {previewPath.replace(/.*[/\\]/, "")}
          </div>
        </>
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
          height: "100%", gap: 8, color: C.dim2, fontSize: 11 }}>
          <Spinner color={C.dim2} size={13} />
          <span style={{ fontFamily: "JetBrains Mono" }}>waitingâ€¦</span>
        </div>
      )}
    </div>
  );
}

// â”€â”€ Zone 2: Per-stage stats bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
      <StatChip icon="âœ“" value={stats.done} color={stats.done > 0 ? C.green  : C.dim} />
      <StatChip icon="â†·" value={stats.skip} color={stats.skip > 0 ? C.yellow : C.dim} />
      <StatChip icon="âœ—" value={stats.err}  color={stats.err  > 0 ? C.red    : C.dim} />
      {total > 0 && (
        <span style={{ fontSize: 10, color: C.dim, fontFamily: "JetBrains Mono", marginLeft: "auto" }}>
          {finished}/{total}
        </span>
      )}
      {active && <Spinner color={color} size={10} />}
      {stageDone && <span style={{ fontSize: 10, color: C.green }}>âœ“</span>}
    </div>
  );
}

function Zone2({ upStats, bgStats, totalImages, elapsed, running, done, stage, doUpscale, doRembg, stagesDone = {}, oomGpuCount = 0 }) {
  const fmt  = s => s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  const n    = totalImages || 0;
  const errs = upStats.err + bgStats.err;

  return (
    <div style={{ marginTop: 8, flexShrink: 0 }}>
      <div style={{
        background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4,
        padding: "7px 14px", display: "flex", flexDirection: "column", gap: 5,
      }}>
        {doUpscale && (
          <StageRow
            label="Upscale" stats={upStats} total={n}
            active={stage === "upscale"}
            stageDone={stagesDone.upscale || stage === "rembg" || stage === "done" || (done && !doRembg)}
            color={C.blue}
          />
        )}
        {doRembg && (
          <StageRow
            label="Remove BG" stats={bgStats} total={n}
            active={stage === "rembg"}
            stageDone={stagesDone.rembg || stage === "done" || (done && !doUpscale)}
            color={C.magenta}
          />
        )}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12,
          paddingTop: 4, borderTop: `1px solid ${C.border}`, marginTop: 1,
        }}>
          {(running || done) && (
            <span style={{ fontSize: 11, color: C.dim, fontFamily: "JetBrains Mono" }}>â± {fmt(elapsed)}</span>
          )}
          {running && <Spinner color={C.yellow} size={11} />}
          {done && !running && (
            <span style={{ fontSize: 11, fontFamily: "JetBrains Mono", color: errs > 0 ? C.yellow : C.green }}>
              {errs > 0 ? `âš  done â€” ${errs} error${errs > 1 ? "s" : ""}` : "âœ“ complete"}
            </span>
          )}
          {oomGpuCount > 0 && (
            <span style={{ fontSize: 11, color: C.yellow, fontFamily: "JetBrains Mono" }}>
              OOM fallback: {oomGpuCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// â”€â”€ Tag chip input â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
          }}>Ã—</button>
        </span>
      ))}
      <input
        value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey}
        onBlur={() => { if (input) { add(input); setInput(""); } }}
        placeholder={tags.length ? "" : "filename.webp  â†’  Enter"}
        style={{
          flex: 1, minWidth: 80, background: "transparent", border: "none",
          outline: "none", color: C.text, fontSize: 10,
          fontFamily: "JetBrains Mono", padding: "2px 2px",
        }}
      />
    </div>
  );
}

// â”€â”€ LogPanel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function LogPanel({ logRef, log, running, open, setOpen, flex, imageProgress }) {
  const progressColor = (status) => {
    if (status === "error") return C.red;
    if (status === "skip") return C.dim2;
    if (status === "ok") return C.green;
    if (status === "oom") return C.yellow;
    return C.yellow;
  };
  const isRuleLike = (raw) => /[â”€â•]{4,}/.test(raw);
  const isPureRule = (raw) => /^[\sâ”€â•]+$/.test(raw.trim());
  const extractRuleLabel = (raw) => raw.replace(/^[\sâ”€â•]+|[\sâ”€â•]+$/g, "").trim();

  return (
    <div style={{
      flex: open ? flex : "0 0 28px", minWidth: 0, minHeight: 0,
      display: "flex", flexDirection: "column",
      transition: "flex 0.2s ease"
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ fontSize: 10, letterSpacing: "0.12em", color: C.dim, textTransform: "uppercase", fontWeight: 700 }}>
          Output log
        </div>
        <button onClick={() => setOpen(v => !v)} style={{
          background: "transparent", color: C.dim, border: "none",
          fontSize: 11, cursor: "pointer", fontFamily: "inherit", padding: 0
        }}>{open ? "â–¾ hide" : "â–¸ show"}</button>
      </div>
      {open && (
        <div ref={logRef} style={{
          flex: 1, overflowY: "auto", overflowX: "hidden", background: C.panel,
          border: `1px solid ${C.border}`, borderRadius: 4,
          padding: "8px 12px", fontFamily: "JetBrains Mono",
          fontSize: 11, lineHeight: 1.7, display: "flex", flexDirection: "column", gap: 8,
        }}>
          {log.length === 0 && !running ? (
            <div style={{ color: C.dim, fontSize: 12 }}>Configure and press Run Pipeline.</div>
          ) : log.map((e, i) => {
            // BUG-05 FIX: inline ASCII progress bar instead of CSS width-transition div
            if (e.kind === "progress") {
              const meta = imageProgress[e.filename];
              if (!meta) return null;
              const color = progressColor(meta.status);
              const pct   = meta.percent;
              const filled = Math.round(pct / 10);
              const bar = `${"#".repeat(filled)}${"-".repeat(10 - filled)}`;
              return (
                <div key={i} style={{ fontFamily: "JetBrains Mono", color, fontSize: 11 }}>
                  [{bar}]  {String(pct).padStart(3)}%  {e.filename}
                </div>
              );
            }
            if (e.kind === "section" && isRuleLike(e.raw)) {
              const label = isPureRule(e.raw) ? "" : extractRuleLabel(e.raw);
              return (
                <div key={i} style={{ marginBottom: 3 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, borderTop: `1px solid ${C.dim2}`, opacity: 0.7 }} />
                    {label && <span style={{ color: KIND_COLOR.section, whiteSpace: "nowrap" }}>{label}</span>}
                    <div style={{ flex: 1, borderTop: `1px solid ${C.dim2}`, opacity: 0.7 }} />
                  </div>
                </div>
              );
            }
            return (
              <div key={i} style={{
                whiteSpace: "pre-wrap", wordBreak: "break-all",
                color: KIND_COLOR[e.kind] ?? C.dim,
                opacity: e.kind === "info" ? 0.55 : 1,
                paddingLeft: e.kind === "section" ? 0 : 4,
                borderLeft: e.kind === "section" ? `2px solid ${C.dim2}` : "2px solid transparent",
                marginBottom: e.kind === "section" ? 3 : 0,
              }}>
                {e.raw}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// â”€â”€ ErrorPanel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ErrorPanel({ errorRef, errors, imageError, open, setOpen, flex }) {
  const [expanded, setExpanded] = useState({});
  const hasErrors = imageError > 0;

  return (
    <div style={{
      flex: open ? flex : "0 0 28px", minHeight: 0,
      display: "flex", flexDirection: "column",
      transition: "flex 0.2s ease"
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{
          fontSize: 10, letterSpacing: "0.12em", fontWeight: 700,
          textTransform: "uppercase",
          color: hasErrors ? C.red : C.dim
        }}>
          Errors {hasErrors ? `(${imageError})` : ""}
        </div>
        <button onClick={() => setOpen(v => !v)} style={{
          background: "transparent", color: C.dim, border: "none",
          fontSize: 11, cursor: "pointer", fontFamily: "inherit", padding: 0
        }}>{open ? "â–¾ hide" : "â–¸ show"}</button>
      </div>
      {open && (
        <div ref={errorRef} style={{
          flex: 1, overflowY: "auto",
          background: hasErrors ? "var(--red-bg)" : C.panel,
          border: `1px solid ${hasErrors ? "var(--red-bdr)" : C.border}`,
          borderRadius: 4, padding: "8px 10px",
          fontFamily: "JetBrains Mono", fontSize: 10, lineHeight: 1.7,
        }}>
          {errors.length === 0 ? (
            <div style={{ color: C.dim, fontSize: 11 }}>No errors</div>
          ) : errors.map((e, i) => (
            <div key={i} style={{
              paddingBottom: 8, marginBottom: 8,
              borderBottom: i < errors.length - 1 ? `1px solid var(--red-bdr)` : "none"
            }}>
              <div style={{ color: C.red, whiteSpace: "pre-wrap", wordBreak: "break-word", fontWeight: 600 }}>{e.raw}</div>
              {e.context?.length > 0 && (
                <>
                  <button
                    onClick={() => setExpanded(p => ({ ...p, [i]: !p[i] }))}
                    style={{
                      marginTop: 3, background: "transparent", border: "none",
                      color: C.dim, fontSize: 9, cursor: "pointer",
                      fontFamily: "JetBrains Mono", padding: 0, letterSpacing: "0.05em"
                    }}
                  >
                    {expanded[i] ? "â–¾ hide context" : "â–¸ show context"}
                  </button>
                  {expanded[i] && (
                    <div style={{
                      marginTop: 4, padding: "4px 6px",
                      background: "color-mix(in srgb, var(--red) 6%, var(--panel))", borderRadius: 3,
                      border: `1px solid var(--red-bdr)`,
                    }}>
                      {e.context.map((line, j) => (
                        <div key={j} style={{ color: C.dim, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 9 }}>{line}</div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// BUG-18 FIX (receiver side): added onGoToTemplates to prop signature.
// main.jsx passes this prop but the old signature omitted it, so it was silently ignored.
export default function Pipeline({ onGoToEditor, onGoToTemplates, onPipelineDone, inputDir, setInputDir, outputDir, setOutputDir, excludeTags, removedImages }) {
  const [folderMode, setFolderMode] = useState(PIPELINE_DEFAULTS.folderMode);
  const [doUpscale, setDoUpscale] = useState(PIPELINE_DEFAULTS.doUpscale);
  const [scale, setScale] = useState(PIPELINE_DEFAULTS.scale);
  const [doRembg, setDoRembg] = useState(PIPELINE_DEFAULTS.doRembg);
  const [canvasSize, setCanvasSize] = useState(PIPELINE_DEFAULTS.canvasSize);
  const [thumbnail, setThumbnail] = useState(PIPELINE_DEFAULTS.thumbnail);
  const [rembgModel, setRembgModel] = useState(PIPELINE_DEFAULTS.rembgModel);
  const [upscaleMaxPx, setUpscaleMaxPx] = useState(PIPELINE_DEFAULTS.upscaleMaxPx);
  const [rembgModels, setRembgModels] = useState(["birefnet-general"]);
  const [logOpen, setLogOpen] = useState(true);
  const [errOpen, setErrOpen] = useState(true);
  const [resumeSession, setResumeSession] = useState(null);
  const [showResume, setShowResume] = useState(false);
  const [preflight, setPreflight] = useState(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const doneNotifiedRef = useRef(false);
  const initializedRef = useRef(false);
  const editedKeysRef = useRef(new Set());
  const pipelineStateRef = useRef({
    folderMode: PIPELINE_DEFAULTS.folderMode,
    doUpscale: PIPELINE_DEFAULTS.doUpscale,
    scale: PIPELINE_DEFAULTS.scale,
    doRembg: PIPELINE_DEFAULTS.doRembg,
    canvasSize: PIPELINE_DEFAULTS.canvasSize,
    thumbnail: PIPELINE_DEFAULTS.thumbnail,
    rembgModel: PIPELINE_DEFAULTS.rembgModel,
    upscaleMaxPx: PIPELINE_DEFAULTS.upscaleMaxPx,
  });
  const inputDirRef = useRef(inputDir);
  const outputDirRef = useRef(outputDir);

  const markEdited = useCallback((key) => {
    editedKeysRef.current.add(key);
  }, []);

  useEffect(() => {
    pipelineStateRef.current = {
      folderMode,
      doUpscale,
      scale,
      doRembg,
      canvasSize,
      thumbnail,
      rembgModel,
      upscaleMaxPx,
    };
  }, [folderMode, doUpscale, scale, doRembg, canvasSize, thumbnail, rembgModel, upscaleMaxPx]);

  useEffect(() => {
    inputDirRef.current = inputDir;
    outputDirRef.current = outputDir;
  }, [inputDir, outputDir]);

  const setPipelineStateFromSettings = useCallback((settings) => {
    const merged = mergeSettingsDefaults(pipelineStateRef.current, settings, editedKeysRef.current);
    setFolderMode(merged.folderMode);
    setDoUpscale(merged.doUpscale);
    setScale(merged.scale);
    setDoRembg(merged.doRembg);
    setCanvasSize(merged.canvasSize);
    setThumbnail(merged.thumbnail);
    setRembgModel(merged.rembgModel);
    setUpscaleMaxPx(merged.upscaleMaxPx);
    pipelineStateRef.current = merged;
  }, []);

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
        setPipelineStateFromSettings(data.settings);
        if (!initializedRef.current) {
          const out = data.settings.output ?? {};
          if (!inputDirRef.current && typeof out.input_dir === "string" && out.input_dir.trim()) setInputDir(out.input_dir);
          if (!outputDirRef.current && typeof out.output_dir === "string" && out.output_dir.trim()) setOutputDir(out.output_dir);
          initializedRef.current = true;
        }
      })
      .catch(() => {});
  }, [setPipelineStateFromSettings, setInputDir, setOutputDir]);

  // Load defaults on mount. On focus, reload defaults without overwriting fields edited in this session.
  useEffect(() => {
    loadSettings();
    window.addEventListener("focus", loadSettings);
    return () => window.removeEventListener("focus", loadSettings);
  }, [loadSettings]);

  useEffect(() => {
    fetch(`${BASE}/session`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.exists) { setResumeSession(data); setShowResume(true); }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setPreflight(null);
  }, [folderMode, doUpscale, scale, doRembg, inputDir, outputDir, rembgModel, upscaleMaxPx]);

  const {
    running, done, log, errors, imageDone, imageError,
    totalImages, recentDone, elapsed, stage, stagesDone,
    upStats, bgStats, imageProgress, oomGpuCount,
    logRef, errorRef, start, stop,
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
    onPipelineDone?.({
      canvasSize: parseInt(canvasSize, 10) || 1440,
      thumbnail,
    });
  }, [done, onPipelineDone, canvasSize, thumbnail]);

  const runPreflight = useCallback(async () => {
    const parsedUpscaleMaxPx = Number.parseInt(upscaleMaxPx, 10);
    const payload = {
      folder_mode: folderMode,
      do_upscale: doUpscale,
      scale,
      do_rembg: doRembg,
      input_dir: inputDir,
      output_dir: outputDir,
      exclude_rembg: [],
      skip_files: [],
      rembg_model: rembgModel,
      resume: false,
      upscale_max_px: Number.isFinite(parsedUpscaleMaxPx) && parsedUpscaleMaxPx > 0 ? parsedUpscaleMaxPx : 0,
    };

    setPreflightLoading(true);
    try {
      const r = await fetch(`${BASE}/pipeline/preflight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) return null;
      const data = await r.json();
      const pf = data?.preflight ?? null;
      setPreflight(pf);
      return pf;
    } catch {
      return null;
    } finally {
      setPreflightLoading(false);
    }
  }, [folderMode, doUpscale, scale, doRembg, inputDir, outputDir, rembgModel, upscaleMaxPx]);

  const handleStart = useCallback(async () => {
    const pf = await runPreflight();
    if (!pf) {
      if (!window.confirm("Preflight check failed. Continue anyway?")) return;
    } else if (pf.has_serious_warnings) {
      const msg = [
        "Preflight warnings:",
        ...pf.warnings.map(w => `- ${w.message}`),
        "",
        "Continue anyway?",
      ].join("\n");
      if (!window.confirm(msg)) return;
    }
    const skipList     = removedImages ? [...removedImages] : [];
    const activeExclude = excludeTags.filter(n => !removedImages?.has(n));
    const parsedUpscaleMaxPx = Number.parseInt(upscaleMaxPx, 10);
    start({
      folderMode, doUpscale, scale, doRembg, inputDir, outputDir,
      excludeList: activeExclude, skipList, rembgModel, resume: false,
      upscaleMaxPx: Number.isFinite(parsedUpscaleMaxPx) && parsedUpscaleMaxPx > 0 ? parsedUpscaleMaxPx : 0,
    });
    setShowResume(false);
  }, [runPreflight, start, folderMode, doUpscale, scale, doRembg, inputDir, outputDir, excludeTags, removedImages, rembgModel, upscaleMaxPx]);

  const handleResume = useCallback(() => {
    if (!resumeSession?.src_root) return;
    setInputDir(resumeSession.src_root);
    const skipList = removedImages ? [...removedImages] : [];
    const activeExclude = excludeTags.filter(n => !removedImages?.has(n));
    const parsedUpscaleMaxPx = Number.parseInt(upscaleMaxPx, 10);
    start({
      folderMode, doUpscale, scale, doRembg,
      inputDir: resumeSession.src_root,
      outputDir, excludeList: activeExclude, skipList, rembgModel, resume: true,
      upscaleMaxPx: Number.isFinite(parsedUpscaleMaxPx) && parsedUpscaleMaxPx > 0 ? parsedUpscaleMaxPx : 0,
    });
    setShowResume(false);
  }, [resumeSession, setInputDir, removedImages, excludeTags, start, folderMode, doUpscale, scale, doRembg, outputDir, rembgModel, upscaleMaxPx]);

  const handleStartFresh = useCallback(async () => {
    try { await fetch(`${BASE}/session`, { method: "DELETE" }); } catch { void 0; }
    setShowResume(false);
    setResumeSession(null);
  }, []);

  // BUG-02 FIX: pass output root directly (no extra "/output" append).
  const handleGoToEditor = useCallback(() => {
    onGoToEditor({ canvasSize: parseInt(canvasSize, 10) || 1440, thumbnail });
  }, [onGoToEditor, canvasSize, thumbnail]);

  const nothingSelected = !doUpscale && !doRembg;

  return (
    <div style={{
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

      <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0 }}>

        {/* Sidebar */}
        <div style={{
          width: 300, background: C.panel, borderRight: `1px solid ${C.border}`,
          padding: "14px", display: "flex", flexDirection: "column",
          flexShrink: 0, overflowY: "auto"
        }}>
          {showResume && resumeSession && (
            <div style={{
              marginBottom: 12,
              background: "color-mix(in srgb, var(--accent) 10%, transparent)",
              border: `1px solid color-mix(in srgb, var(--accent) 35%, transparent)`,
              borderRadius: 6, padding: "10px 10px 8px",
            }}>
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
                <button onClick={handleResume} style={{
                  flex: 1, background: C.greenBg, color: C.green, border: `1px solid ${C.greenBdr}`,
                  borderRadius: 6, padding: "6px 8px", fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                }}>Resume</button>
                <button onClick={handleStartFresh} style={{
                  flex: 1, background: C.panel2, color: C.dim, border: `1px solid ${C.border}`,
                  borderRadius: 6, padding: "6px 8px", fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                }}>Start fresh</button>
              </div>
              <button onClick={() => setShowResume(false)} style={{
                marginTop: 6, background: "transparent", border: "none", color: C.dim2,
                padding: 0, fontSize: 10, cursor: "pointer", fontFamily: "inherit",
              }}>dismiss</button>
            </div>
          )}

          <SectionLabel>Folders</SectionLabel>
          <div style={{ marginBottom: 8 }}>
            <FieldLabel>Input folder</FieldLabel>
            <FolderInput value={inputDir} onChange={(value) => setInputDir(value)} placeholder="default: ./input" />
          </div>
          <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: `1px solid ${C.border}` }}>
            <FieldLabel>Output folder</FieldLabel>
            <FolderInput value={outputDir} onChange={(value) => setOutputDir(value)} placeholder="default: ./output" />
          </div>

          <SectionLabel>Processing</SectionLabel>

          <Row label="Folder mode">
            <Btn label="Bulk" active={folderMode === "bulk"} onClick={() => { markEdited("folderMode"); setFolderMode("bulk"); }} />
            <Btn label="Clean" active={folderMode === "clean"} onClick={() => { markEdited("folderMode"); setFolderMode("clean"); }} />
          </Row>

          <Row label="Upscale (NCNN)">
            <PillToggle value={doUpscale} onChange={(value) => { markEdited("doUpscale"); setDoUpscale(value); }} />
          </Row>

          {doUpscale && (
            <Row label="Scale factor">
              <Btn label="2Ã—" active={scale === "2"} onClick={() => { markEdited("scale"); setScale("2"); }} />
              <Btn label="4Ã—" active={scale === "4"} onClick={() => { markEdited("scale"); setScale("4"); }} />
            </Row>
          )}

          <Row label="Remove BG">
            <PillToggle value={doRembg} onChange={(value) => { markEdited("doRembg"); setDoRembg(value); }} />
          </Row>
          {doRembg && (
            <>
              <Row label="BG model">
                <select
                  value={rembgModel} onChange={e => { markEdited("rembgModel"); setRembgModel(e.target.value); }}
                  style={{
                    background: C.panel2, color: C.text, border: `1px solid ${C.border}`,
                    borderRadius: 4, padding: "4px 8px", fontSize: 11, width: 170,
                    outline: "none", fontFamily: "inherit", colorScheme: "dark",
                  }}
                >
                  {rembgModels.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </Row>
              <Row label="Fallback">
                <span style={{ fontSize: 11, color: C.dim }}>auto</span>
              </Row>
            </>
          )}

          <div style={{ marginTop: 16, marginBottom: 16, borderTop: `1px solid ${C.border}` }} />
          <SectionLabel>Output settings</SectionLabel>

          <Row label="Skip upscale if any side â‰¥">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="number"
                value={upscaleMaxPx}
                onChange={e => { markEdited("upscaleMaxPx"); setUpscaleMaxPx(e.target.value); }}
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

          <Row label="Canvas size (px)">
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {["1080", "1440", "2048"].map(s => (
                <Btn key={s} label={s} active={canvasSize === s} onClick={() => { markEdited("canvasSize"); setCanvasSize(s); }} />
              ))}
              <input type="number" value={canvasSize} onChange={e => { markEdited("canvasSize"); setCanvasSize(e.target.value); }}
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

          <Row label="Thumbnail (400px)">
            <PillToggle value={thumbnail} onChange={(value) => { markEdited("thumbnail"); setThumbnail(value); }} />
          </Row>

          {/* Will run summary */}
          <div style={{
            marginTop: 14, background: C.panel2, border: `1px solid ${C.border}`,
            borderRadius: 4, padding: "9px 12px"
          }}>
            <div style={{
              fontSize: 9, color: C.dim, marginBottom: 6,
              letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700
            }}>Will run</div>
            {nothingSelected
              ? <div style={{ fontSize: 12, color: C.red }}>âœ• Enable at least one stage</div>
              : <>
                {doUpscale && <div style={{ fontSize: 12, color: C.green, marginBottom: 3 }}>âœ“ Upscale Ã—{scale} (NCNN Vulkan)</div>}
                {doRembg && (() => {
                  const skipCount = removedImages?.size ?? 0;
                  const exclCount = excludeTags.filter(n => !removedImages?.has(n)).length;
                  return (
                    <div style={{ fontSize: 12, color: C.green }}>
                      âœ“ Remove BG ({rembgModel || "birefnet-general"})
                      {exclCount > 0 && <span style={{ color: C.yellow }}> Â· {exclCount} excluded</span>}
                      {skipCount  > 0 && <span style={{ color: C.dim   }}> Â· {skipCount} skipped</span>}
                    </div>
                  );
                })()}
              </>
            }
          </div>

          {(preflightLoading || preflight) && (
            <div style={{
              marginTop: 8, background: C.panel2, border: `1px solid ${C.border}`,
              borderRadius: 4, padding: "9px 12px"
            }}>
              <div style={{
                fontSize: 9, color: C.dim, marginBottom: 6,
                letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700
              }}>Preflight</div>
              {preflightLoading ? (
                <div style={{ fontSize: 11, color: C.dim }}>Checkingâ€¦</div>
              ) : preflight ? (
                <>
                  <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.5 }}>
                    <div>Input: <span style={{ color: C.text, fontFamily: "JetBrains Mono" }}>{preflight.resolved?.input_dir}</span></div>
                    <div>Output: <span style={{ color: C.text, fontFamily: "JetBrains Mono" }}>{preflight.resolved?.output_dir}</span></div>
                    <div>Supported images: <span style={{ color: C.text }}>{preflight.counts?.supported_images ?? 0}</span></div>
                    <div>Unsupported image-like files: <span style={{ color: C.text }}>{preflight.counts?.unsupported_image_like ?? 0}</span></div>
                    <div>Mode: <span style={{ color: C.text }}>{preflight.folder_mode}</span></div>
                    <div>Stages: <span style={{ color: C.text }}>{preflight.stages?.do_upscale ? "upscale" : "no-upscale"} / {preflight.stages?.do_rembg ? "rembg" : "no-rembg"}</span></div>
                    <div>Scale: <span style={{ color: C.text }}>Ã—{preflight.stages?.upscale_scale}</span></div>
                    <div>Upscale max px: <span style={{ color: C.text }}>{preflight.stages?.upscale_max_px || 0}</span></div>
                    <div>Rembg model: <span style={{ color: C.text }}>{preflight.stages?.rembg_model || "birefnet-general"}</span></div>
                    <div>Output markers: <span style={{ color: C.text }}>{preflight.output?.markers?.length ? preflight.output.markers.join(", ") : "none"}</span></div>
                  </div>
                  {preflight.warnings?.length > 0 && (
                    <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.5 }}>
                      {preflight.warnings.map((w, i) => (
                        <div key={`${w.code}-${i}`} style={{ color: w.severity === "serious" ? C.red : C.yellow }}>
                          {w.severity === "serious" ? "âš " : "â€¢"} {w.message}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 11, color: C.dim }}>No preflight data yet.</div>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ marginTop: "auto", paddingTop: 16 }}>
            {!running ? (
              <button onClick={handleStart} disabled={nothingSelected || preflightLoading} style={{
                width: "100%", padding: "10px 0",
                background: (nothingSelected || preflightLoading) ? C.dim2 : C.greenBg,
                color: (nothingSelected || preflightLoading) ? C.dim : C.green,
                border: `1px solid ${(nothingSelected || preflightLoading) ? C.border : C.greenBdr}`,
                borderRadius: 8, fontSize: 13, fontWeight: 600,
                cursor: (nothingSelected || preflightLoading) ? "not-allowed" : "pointer", fontFamily: "inherit",
              }}>{preflightLoading ? "Checking…" : "Run Pipeline"}</button>
            ) : (
              <button onClick={stop} style={{
                width: "100%", padding: "10px 0", background: C.redBg, color: C.red,
                border: `1px solid ${C.redBdr}`, borderRadius: 8, fontSize: 13, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit",
              }}>â–   Stop</button>
            )}

            <button onClick={handleGoToEditor} style={{
              width: "100%", marginTop: 6, padding: "10px 0",
              background: "color-mix(in srgb, var(--accent) 12%, transparent)",
              color: C.accent, border: `1px solid color-mix(in srgb, var(--accent) 30%, transparent)`,
              borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            }}>Open Editor â†’</button>

            {/* BUG-18 FIX (usage): onGoToTemplates now wired to the button */}
            {onGoToTemplates && (
              <button onClick={onGoToTemplates} style={{
                width: "100%", marginTop: 6, padding: "10px 0",
                background: C.panel2, color: C.dim, border: `1px solid ${C.border}`,
                borderRadius: 8, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
              }}>Manage Templates</button>
            )}

            <button
              onClick={() => openFolder(outputDir.trim())}
              style={{
                width: "100%", marginTop: 6, padding: "10px 0",
                background: C.panel2, color: C.dim, border: `1px solid ${C.border}`,
                borderRadius: 8, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              ðŸ“ Open Output Folder
            </button>
          </div>
        </div>

        {/* Right zone */}
        <div style={{ flex: 1, display: "flex", minWidth: 0, minHeight: 0, padding: "0 12px 12px 12px" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, gap: 8 }}>

            <div style={{ flex: "0 0 56%", minHeight: 0, display: "flex", flexDirection: "column" }}>
              <Zone1
                running={running} done={done}
                stage={stage} stagesDone={stagesDone}
                recentDone={recentDone}
                imageDone={imageDone} totalImages={totalImages}
                doUpscale={doUpscale} doRembg={doRembg}
                inputDir={inputDir} setInputDir={setInputDir}
                rembgModel={rembgModel}
              />
              {(running || done) && (
                <Zone2
                  upStats={upStats} bgStats={bgStats}
                  totalImages={totalImages} elapsed={elapsed}
                  running={running} done={done} stage={stage}
                  doUpscale={doUpscale} doRembg={doRembg}
                  stagesDone={stagesDone}
                  oomGpuCount={oomGpuCount}
                />
              )}
            </div>

            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              <ErrorPanel
                errorRef={errorRef} errors={errors} imageError={imageError}
                open={errOpen} setOpen={setErrOpen}
                flex={logOpen && errOpen ? 1 : (errOpen ? 9 : 1)}
              />
              <LogPanel
                logRef={logRef} log={log} running={running}
                open={logOpen} setOpen={setLogOpen}
                flex={logOpen && errOpen ? 1 : (logOpen ? 9 : 1)}
                imageProgress={imageProgress}
              />
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}




