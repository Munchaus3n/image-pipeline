import { useState, useRef, useEffect, useCallback } from "react";

const BASE = "/api";

// Opens a folder in the native OS file explorer via the API server.
// path="" → server defaults to OUTPUT_ROOT.
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

// ── Primitives ────────────────────────────────────────────────────────────────

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
  const bg = active ? (color ? color + "22" : "color-mix(in srgb, var(--accent) 12%, transparent)") : "transparent";
  const fg = active ? (color || C.text) : C.dim;
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

// Sliding pill toggle — replaces On/Off Btn pairs. CSS-only, no library.
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
    } catch {
      void 0;
    }
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
      }}>…</button>
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
  const ch = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const [f, setF] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setF(x => (x + 1) % ch.length), 80);
    return () => clearInterval(t);
  }, [ch.length]);
  return <span style={{ fontFamily: "JetBrains Mono", fontSize: size, color }}>{ch[f]}</span>;
}

// ── Pipeline hook ─────────────────────────────────────────────────────────────

const KIND_COLOR = {
  ok: "#4ade80", error: "#f87171", warn: "#facc15",
  skip: "#4a5a7a", section: "#7aa4d4", info: "#4a5a7a",
};

function usePipeline() {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [log, setLog] = useState([]);
  const [errors, setErrors] = useState([]);   // each: { raw, kind, context: string[] }
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
  const [imageProgress, setImageProgress] = useState({});

  const abortRef   = useRef(null);
  const logRef     = useRef(null);
  const errorRef   = useRef(null);
  const timerRef   = useRef(null);
  const startRef   = useRef(null);
  const doneSet    = useRef(new Set());
  const skipSet    = useRef(new Set());
  const errSet     = useRef(new Set());
  const stageRef   = useRef("upscale");
  const recentLog  = useRef([]);   // last 5 human-readable lines for error context

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
    if (/→ bg_removed/.test(raw) || /→ upscaled/.test(raw)) return "ok";
    if (/✓/.test(raw)) return "ok";
    if (/✗|Error|error|failed on |Traceback|Exception/i.test(raw)) return "error";
    if (/⚠|warn/i.test(raw)) return "warn";
    if (/↷|skip|already (upscaled|processed)/i.test(raw)) return "skip";
    if (/Stage \d|─{4,}|═{4,}/.test(raw)) return "section";
    return "info";
  }, []);

  const appendLine = useCallback((raw) => {
    // ── Structured machine-readable tokens (emitted by pipeline.py print()) ──
    // These are NOT displayed in the log — they only drive stats.
    // Using tokens avoids the "Rich console wraps long folder paths → regex breaks" bug.
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

    if (raw.startsWith("__processing__:")) {
      const fullPath = raw.slice(15);
      const fileName = fullPath.replace(/.*[/\\]/, "");
      setImageProgress(prev => {
        const current = prev[fileName];
        if (current) {
          return {
            ...prev,
            [fileName]: { ...current, status: "running" },
          };
        }
        return { ...prev, [fileName]: { stage: "upscale", percent: 0, status: "running" } };
      });
      return;
    }

    // ── Human-readable log lines ─────────────────────────────────────────────
    const kind = classify(raw);
    const entry = { raw, kind };
    setLog(prev => [...prev.slice(-800), entry]);

    // Keep a rolling window of the last 5 human lines for error context
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

  const start = useCallback(async ({ folderMode, doUpscale, scale, doRembg, inputDir, outputDir, excludeList = [], skipList = [], rembgModel = "" }) => {
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
    setImageProgress({});
    stageRef.current = "upscale";
    recentLog.current = [];
    doneSet.current = new Set(); skipSet.current = new Set(); errSet.current = new Set();

    try {
      const r = await fetch(`${BASE}/pipeline/run`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_mode: folderMode, do_upscale: doUpscale, scale,
          do_rembg: doRembg, input_dir: inputDir.trim(), output_dir: outputDir.trim(),
          exclude_rembg: excludeList, skip_files: skipList, rembg_model: rembgModel,
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
            appendLine(msg.includes("exit=0") ? "✓ Pipeline complete." : "✗ Pipeline exited with errors.");
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
    upStats, bgStats, imageProgress,
    logRef, errorRef, start, stop
  };
}

// ── Zone 1: Drop zone / Live stage animation ──────────────────────────────────

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
    const p = files[0].path;   // only available in Electron
    if (p) {
      const folder = p.replace(/[/\\][^/\\]+$/, "");
      setInputDir(folder);
    } else {
      // Browser context — path not available; open native folder picker instead
      browseInput();
    }
  };

  const browseInput = async () => {
    setBrowseLoading(true);
    try {
      const r = await fetch(`${BASE}/browse?initial=${encodeURIComponent(inputDir)}`);
      const { path } = await r.json();
      if (path) { setInputDir(path); setDroppedFiles([]); }
    } catch {
      void 0;
    }
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
          <div style={{ fontSize: 28, opacity: 0.18 }}>⬇</div>
          <div style={{ fontSize: 13, color: C.dim, textAlign: "center", lineHeight: 1.8 }}>
            Drop images here to set input folder
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button onClick={browseInput} disabled={browseLoading} style={{
              background: C.panel2, color: C.text, border: `1px solid ${C.border}`,
              borderRadius: 4, padding: "6px 16px", fontSize: 12, cursor: "pointer",
              fontFamily: "inherit", opacity: browseLoading ? 0.6 : 1
            }}>
              {browseLoading ? "…" : "Browse folder"}
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
              }}>clear ×</button>
          </div>
          <div style={{
            display: "flex", flexWrap: "wrap", gap: 5,
            overflowY: "auto", alignContent: "flex-start"
          }}>
            {droppedFiles.map((f, i) => (
              <div key={i} style={{
                background: C.panel2, border: `1px solid ${C.border}`,
                borderRadius: 3, padding: "3px 8px", fontSize: 10,
                fontFamily: "JetBrains Mono", color: C.text,
                maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
              }}>
                {f}
              </div>
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
      <div style={{ fontSize: 32, color: C.green, lineHeight: 1 }}>✓</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: C.green }}>Pipeline complete</div>
      <div style={{ display: "flex", gap: 20 }}>
        <SmStat label="Done" value={imageDone} color={C.green} />
        <SmStat label="Total" value={totalImages || "—"} color={C.dim} />
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

      {/* Stage header labels */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        {stages.map(s => (
          <div key={s.id} style={{
            flex: 1, textAlign: "center", padding: "6px 0",
            fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700,
            color: s.done ? C.green : s.active ? C.yellow : s.skip ? C.dim2 : C.dim
          }}>{s.label}</div>
        ))}
      </div>

      {/* Stage cards — fill full width */}
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
                {s.done && <div style={{ fontSize: 20, color: C.green, lineHeight: 1, marginBottom: 4 }}>✓</div>}
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
            }}>✓ {f}</div>
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

// ── LivePreview — full-area image preview during run ─────────────────────────

function LivePreview({ running, done, previewPath, imageDone, totalImages }) {
  const [loadedSrc, setLoadedSrc] = useState("");

  // Track source changes to show loading state
  const src = previewPath
    ? `${BASE}/image?path=${encodeURIComponent(previewPath)}`
    : "";

  const loaded = Boolean(src) && loadedSrc === src;

  if (done && !running) return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", gap: 14, borderRadius: 6,
      border: `1px solid ${C.border}`, background: C.panel, minHeight: 0,
    }}>
      <div style={{ fontSize: 36, color: C.green }}>✓</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: C.green }}>Pipeline complete</div>
      <div style={{ display: "flex", gap: 24 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: C.green, fontFamily: "JetBrains Mono" }}>{imageDone}</div>
          <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase" }}>Done</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: C.dim, fontFamily: "JetBrains Mono" }}>{totalImages || "—"}</div>
          <div style={{ fontSize: 10, color: C.dim, textTransform: "uppercase" }}>Total</div>
        </div>
      </div>
      {previewPath && (
        <img src={src} alt="" style={{
          maxHeight: 180, maxWidth: "80%", objectFit: "contain",
          borderRadius: 4, opacity: 0.5,
        }} />
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
          {/* Loading shimmer shown while new image loads */}
          {!loaded && (
            <div style={{
              position: "absolute", inset: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              animation: "loadingPulse 1.2s ease-in-out infinite",
            }}>
              <Spinner color={C.dim} size={18} />
            </div>
          )}
          <img
            key={src}
            src={src}
            alt=""
            onLoad={() => setLoadedSrc(src)}
            onError={() => setLoadedSrc(src)}
            style={{
              width: "100%", height: "100%", objectFit: "contain", display: "block",
              opacity: loaded ? 1 : 0,
              transition: "opacity 0.3s ease",
            }}
          />
          {/* Filename label */}
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0,
            padding: "16px 10px 6px",
            background: "linear-gradient(transparent, rgba(0,0,0,0.6))",
            fontSize: 9, color: "rgba(255,255,255,0.55)",
            fontFamily: "JetBrains Mono", pointerEvents: "none",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            textAlign: "center",
          }}>
            {previewPath.replace(/.*[/\\]/, "")}
          </div>
        </>
      ) : (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          height: "100%", gap: 8, color: C.dim2, fontSize: 11,
        }}>
          <Spinner color={C.dim2} size={13} />
          <span style={{ fontFamily: "JetBrains Mono" }}>waiting…</span>
        </div>
      )}
    </div>
  );
}

// ── Zone 2: Per-stage stats bar ───────────────────────────────────────────────

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

function Zone2({ upStats, bgStats, totalImages, elapsed, running, done, stage, doUpscale, doRembg, stagesDone = {} }) {
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
            <span style={{ fontSize: 11, color: C.dim, fontFamily: "JetBrains Mono" }}>⏱ {fmt(elapsed)}</span>
          )}
          {running && <Spinner color={C.yellow} size={11} />}
          {done && !running && (
            <span style={{ fontSize: 11, fontFamily: "JetBrains Mono", color: errs > 0 ? C.yellow : C.green }}>
              {errs > 0 ? `⚠ done — ${errs} error${errs > 1 ? "s" : ""}` : "✓ complete"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tag chip input for exclude list ──────────────────────────────────────────

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

// ── LogPanel — collapsible output log ────────────────────────────────────────

function LogPanel({ logRef, log, running, open, setOpen, flex, imageProgress }) {
  const progressEntries = Object.entries(imageProgress);
  const progressColor = (status) => {
    if (status === "error") return C.red;
    if (status === "skip") return C.dim2;
    if (status === "ok") return C.green;
    return C.yellow;
  };
  const isRuleLike = (raw) => /[─═]{4,}/.test(raw);
  const isPureRule = (raw) => /^[\s─═]+$/.test(raw.trim());
  const extractRuleLabel = (raw) => raw.replace(/^[\s─═]+|[\s─═]+$/g, "").trim();

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
        }}>{open ? "▾ hide" : "▸ show"}</button>
      </div>
      {open && (
        <div ref={logRef} style={{
          flex: 1, overflowY: "auto", overflowX: "hidden", background: C.panel,
          border: `1px solid ${C.border}`, borderRadius: 4,
          padding: "8px 12px", fontFamily: "JetBrains Mono",
          fontSize: 11, lineHeight: 1.7, display: "flex", flexDirection: "column", gap: 8,
        }}>
          {progressEntries.length > 0 && (
            <div style={{
              borderBottom: `1px solid ${C.border}`,
              paddingBottom: 8,
              marginBottom: 2,
            }}>
              {progressEntries.slice(-8).map(([name, meta]) => (
                <div key={name} style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 8,
                  alignItems: "center",
                  marginBottom: 4,
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      color: C.dim,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}>
                      #{name}
                    </div>
                    <div style={{
                      marginTop: 3,
                      height: 4,
                      borderRadius: 999,
                      background: "color-mix(in srgb, var(--border) 55%, transparent)",
                    }}>
                      <div style={{
                        width: `${meta.percent}%`,
                        height: "100%",
                        borderRadius: 999,
                        background: progressColor(meta.status),
                        transition: "width 0.18s ease",
                      }} />
                    </div>
                  </div>
                  <div style={{ color: progressColor(meta.status), fontWeight: 600 }}>
                    {meta.percent}%
                  </div>
                </div>
              ))}
            </div>
          )}
          {log.length === 0 && !running ? (
            <div style={{ color: C.dim, fontSize: 12 }}>Configure and press Run Pipeline.</div>
          ) : log.map((e, i) => {
            if (e.kind === "section" && isRuleLike(e.raw)) {
              const label = isPureRule(e.raw) ? "" : extractRuleLabel(e.raw);
              return (
                <div key={i} style={{ marginBottom: 3 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, borderTop: `1px solid ${C.dim2}`, opacity: 0.7 }} />
                    {label && (
                      <span style={{ color: KIND_COLOR.section, whiteSpace: "nowrap" }}>
                        {label}
                      </span>
                    )}
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

// ── ErrorPanel — collapsible with context lines ───────────────────────────────

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
        }}>{open ? "▾ hide" : "▸ show"}</button>
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
              {/* Main error line */}
              <div style={{
                color: C.red, whiteSpace: "pre-wrap", wordBreak: "break-word", fontWeight: 600,
              }}>{e.raw}</div>

              {/* Context toggle */}
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
                    {expanded[i] ? "▾ hide context" : "▸ show context"}
                  </button>
                  {expanded[i] && (
                    <div style={{
                      marginTop: 4, padding: "4px 6px",
                      background: "color-mix(in srgb, var(--red) 6%, var(--panel))", borderRadius: 3,
                      border: `1px solid var(--red-bdr)`,
                    }}>
                      {e.context.map((line, j) => (
                        <div key={j} style={{
                          color: C.dim, whiteSpace: "pre-wrap", wordBreak: "break-word",
                          fontSize: 9,
                        }}>{line}</div>
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

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Pipeline({ onGoToEditor, inputDir, setInputDir, outputDir, setOutputDir, excludeTags, removedImages }) {
  const [folderMode, setFolderMode] = useState("bulk");
  const [doUpscale, setDoUpscale] = useState(true);
  const [scale, setScale] = useState("4");
  const [doRembg, setDoRembg] = useState(true);
  const [canvasSize, setCanvasSize] = useState("1440");
  const [thumbnail, setThumbnail] = useState(true);
  const [rembgModel, setRembgModel] = useState("birefnet-general");
  const [rembgModels, setRembgModels] = useState(["birefnet-general"]);
  const [logOpen, setLogOpen] = useState(true);
  const [errOpen, setErrOpen] = useState(true);
  const [resumeSession, setResumeSession] = useState(null);
  const [showResume, setShowResume] = useState(false);

  const loadSettings = useCallback(() => {
    fetch(`${BASE}/models/rembg`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (Array.isArray(data?.models) && data.models.length) {
          setRembgModels(data.models);
        }
      })
      .catch(() => {});

    fetch(`${BASE}/settings`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.settings) return;
        const s = data.settings;
        if (s.output?.folder_mode) setFolderMode(s.output.folder_mode);
        if (s.output?.output_dir)  setOutputDir(s.output.output_dir);
        if (s.output?.canvas_size) setCanvasSize(String(s.output.canvas_size));
        if (typeof s.output?.thumbnail === "boolean") setThumbnail(s.output.thumbnail);
        if (s.processing?.rembg_model) setRembgModel(s.processing.rembg_model);
      })
      .catch(() => {
        void 0;
      });
  }, [setOutputDir]);

// Load persisted settings on mount and when window regains focus.
  useEffect(() => {
    loadSettings();
    window.addEventListener("focus", loadSettings);
    return () => window.removeEventListener("focus", loadSettings);
  }, [loadSettings]);

  useEffect(() => {
    fetch(`${BASE}/session`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.exists) {
          setResumeSession(data);
          setShowResume(true);
        }
      })
      .catch(() => {});
  }, []);

  const {
    running, done, log, errors, imageDone, imageError,
    totalImages, recentDone, elapsed, stage, stagesDone,
    upStats, bgStats, imageProgress,
    logRef, errorRef, start, stop,
  } = usePipeline();

  const handleStart = useCallback(() => {
    // removedImages is a Set of filenames — convert to array for the API
    const skipList    = removedImages ? [...removedImages] : [];
    // also strip any excludeTags that are in removedImages (shouldn't happen, but safety)
    const activeExclude = excludeTags.filter(n => !removedImages?.has(n));
    start({
      folderMode, doUpscale, scale, doRembg, inputDir, outputDir,
      excludeList: activeExclude, skipList, rembgModel,
    });
    setShowResume(false);
  }, [start, folderMode, doUpscale, scale, doRembg, inputDir, outputDir, excludeTags, removedImages, rembgModel]);

  const handleResume = useCallback(() => {
    if (!resumeSession?.src_root) return;
    setInputDir(resumeSession.src_root);
    const skipList = removedImages ? [...removedImages] : [];
    const activeExclude = excludeTags.filter(n => !removedImages?.has(n));
    start({
      folderMode, doUpscale, scale, doRembg,
      inputDir: resumeSession.src_root,
      outputDir,
      excludeList: activeExclude,
      skipList,
      rembgModel,
    });
    setShowResume(false);
  }, [resumeSession, setInputDir, removedImages, excludeTags, start, folderMode, doUpscale, scale, doRembg, outputDir, rembgModel]);

  const handleStartFresh = useCallback(async () => {
    try { await fetch(`${BASE}/session`, { method: "DELETE" }); } catch { void 0; }
    setShowResume(false);
    setResumeSession(null);
  }, []);

  const handleGoToEditor = useCallback(() => {
    const trimmed = outputDir.trim();
    // When a custom output dir is set, the pipeline wrote into <dir>/output.
    // Pass that resolved path so the editor opens the right source folder.
    const editorOutputDir = trimmed ? trimmed + "/output" : trimmed;
    onGoToEditor({ outputDir: editorOutputDir, canvasSize: parseInt(canvasSize, 10) || 1440, thumbnail });
  }, [onGoToEditor, outputDir, canvasSize, thumbnail]);

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
              borderRadius: 6,
              padding: "10px 10px 8px",
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
            <FolderInput value={inputDir} onChange={setInputDir} placeholder="default: ./input" />
          </div>
          <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: `1px solid ${C.border}` }}>
            <FieldLabel>Output folder</FieldLabel>
            <FolderInput value={outputDir} onChange={setOutputDir} placeholder="default: ./output" />
          </div>

          <SectionLabel>Processing</SectionLabel>

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
          {doRembg && (
            <>
              <Row label="BG model">
                <select
                  value={rembgModel}
                  onChange={e => setRembgModel(e.target.value)}
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

          <Row label="Canvas size (px)">
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
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

          <Row label="Thumbnail (400px)">
            <PillToggle value={thumbnail} onChange={setThumbnail} />
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
              ? <div style={{ fontSize: 12, color: C.red }}>✕ Enable at least one stage</div>
              : <>
                {doUpscale && <div style={{ fontSize: 12, color: C.green, marginBottom: 3 }}>✓ Upscale ×{scale} (NCNN Vulkan)</div>}
                {doRembg && (() => {
                  const skipCount    = removedImages?.size ?? 0;
                  const exclCount    = excludeTags.filter(n => !removedImages?.has(n)).length;
                  return (
                    <div style={{ fontSize: 12, color: C.green }}>
                      ✓ Remove BG ({rembgModel || "birefnet-general"})
                      {exclCount > 0 && <span style={{ color: C.yellow }}> · {exclCount} excluded</span>}
                      {skipCount  > 0 && <span style={{ color: C.dim   }}> · {skipCount} skipped</span>}
                    </div>
                  );
                })()}
              </>
            }
          </div>

          {/* Action buttons — always visible */}
          <div style={{ marginTop: "auto", paddingTop: 16 }}>
            {!running ? (
              <button onClick={handleStart} disabled={nothingSelected} style={{
                width: "100%", padding: "10px 0",
                background: nothingSelected ? C.dim2 : C.greenBg,
                color: nothingSelected ? C.dim : C.green,
                border: `1px solid ${nothingSelected ? C.border : C.greenBdr}`,
                borderRadius: 8, fontSize: 13, fontWeight: 600,
                cursor: nothingSelected ? "not-allowed" : "pointer", fontFamily: "inherit",
              }}>▶  Run Pipeline</button>
            ) : (
              <button onClick={stop} style={{
                width: "100%", padding: "10px 0", background: C.redBg, color: C.red,
                border: `1px solid ${C.redBdr}`, borderRadius: 8, fontSize: 13, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit",
              }}>■  Stop</button>
            )}

            <button onClick={handleGoToEditor} style={{
              width: "100%", marginTop: 6, padding: "10px 0",
              background: "color-mix(in srgb, var(--accent) 12%, transparent)",
              color: C.accent, border: `1px solid color-mix(in srgb, var(--accent) 30%, transparent)`,
              borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            }}>Open Editor →</button>

            <button
              onClick={() => openFolder(outputDir.trim())}
              style={{
                width: "100%", marginTop: 6, padding: "10px 0",
                background: C.panel2, color: C.dim, border: `1px solid ${C.border}`,
                borderRadius: 8, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              📁 Open Output Folder
            </button>
          </div>
        </div>

        {/* Right zone: Zone1 top + Zone2 stats + Log/Error full width */}
        <div style={{ flex: 1, display: "flex", minWidth: 0, minHeight: 0, padding: "0 12px 12px 12px" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, gap: 8 }}>

            {/* Top: drop zone / running animation / done */}
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
                />
              )}
            </div>

            {/* Bottom: Error + Log panels, full width */}
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              <ErrorPanel
                errorRef={errorRef}
                errors={errors}
                imageError={imageError}
                open={errOpen}
                setOpen={setErrOpen}
                flex={logOpen && errOpen ? 1 : (errOpen ? 9 : 1)}
              />
              <LogPanel
                logRef={logRef}
                log={log}
                running={running}
                open={logOpen}
                setOpen={setLogOpen}
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
