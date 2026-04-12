import { useState, useRef, useEffect, useCallback } from "react";

const BASE = "/api";

// Opens a folder in the native OS file explorer via the API server.
// path="" → server defaults to OUTPUT_ROOT.
const openFolder = (path = "") =>
  fetch(`${BASE}/open-folder?path=${encodeURIComponent(path)}`).catch(() => {});

const C = {
  bg: "#0b0d14", panel: "#0f1219", panel2: "#161926",
  border: "#1d2235", text: "#e2e8f8", dim: "#6b7a9e", dim2: "#2a3350",
  green: "#4ade80", blue: "#60a5fa", yellow: "#facc15",
  red: "#f87171", magenta: "#e879f9",
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
  const bg = active ? (color ? color + "22" : "#1e2a42") : "transparent";
  const fg = active ? (color || C.text) : C.dim;
  const bdr = active ? (color ? color + "55" : "#2e4060") : "transparent";
  return (
    <button onClick={onClick} style={{
      background: bg, color: fg, border: `1px solid ${bdr}`,
      borderRadius: 4, padding: "4px 12px", fontSize: 11, minWidth: 42,
      cursor: "pointer", fontFamily: "inherit", fontWeight: active ? 600 : 400,
      ...style,
    }}>{label}</button>
  );
}

function FolderInput({ value, onChange, placeholder }) {
  const browse = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/browse?initial=${encodeURIComponent(value)}`);
      const { path } = await r.json();
      if (path) onChange(path);
    } catch { }
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
        border: `1px solid ${C.border}`, borderRadius: 4, padding: "5px 9px",
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
  const [f, setF] = useState(0);
  const ch = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  useEffect(() => {
    const t = setInterval(() => setF(x => (x + 1) % ch.length), 80);
    return () => clearInterval(t);
  }, []);
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
  const [currentFile, setCurrentFile] = useState("");
  const [previewPath, setPreviewPath] = useState("");  // absolute path for live preview
  const [recentDone, setRecentDone] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const [stage, setStage] = useState(null);
  const [stagesDone, setStagesDone] = useState({ upscale: false, rembg: false });
  const [upStats, setUpStats] = useState({ done: 0, skip: 0, err: 0 });
  const [bgStats, setBgStats] = useState({ done: 0, skip: 0, err: 0 });

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
      if (!doneSet.current.has(fname)) {
        doneSet.current.add(fname);
        setImageDone(doneSet.current.size);
        setRecentDone(prev => [fname, ...prev].slice(0, 8));
      }
      setUpStats(s => ({ ...s, done: s.done + 1 }));
      setCurrentFile("");
      return;
    }
    if (raw.startsWith("__ok_rembg__:")) {
      const fname = raw.slice(13);
      if (!doneSet.current.has(fname)) {
        doneSet.current.add(fname);
        setImageDone(doneSet.current.size);
        setRecentDone(prev => [fname, ...prev].slice(0, 8));
      }
      setBgStats(s => ({ ...s, done: s.done + 1 }));
      setCurrentFile("");
      return;
    }
    if (raw.startsWith("__skip_upscale__:")) {
      const fname = raw.slice(17);
      if (!skipSet.current.has(fname)) { skipSet.current.add(fname); setImageSkipped(skipSet.current.size); }
      setUpStats(s => ({ ...s, skip: s.skip + 1 }));
      return;
    }
    if (raw.startsWith("__skip_rembg__:")) {
      const fname = raw.slice(15);
      if (!skipSet.current.has(fname)) { skipSet.current.add(fname); setImageSkipped(skipSet.current.size); }
      setBgStats(s => ({ ...s, skip: s.skip + 1 }));
      return;
    }
    if (raw.startsWith("__err_upscale__:")) {
      const fname = raw.slice(16);
      if (!errSet.current.has(fname)) { errSet.current.add(fname); setImageError(errSet.current.size); }
      setUpStats(s => ({ ...s, err: s.err + 1 }));
      return;
    }
    if (raw.startsWith("__err_rembg__:")) {
      const fname = raw.slice(14);
      if (!errSet.current.has(fname)) { errSet.current.add(fname); setImageError(errSet.current.size); }
      setBgStats(s => ({ ...s, err: s.err + 1 }));
      return;
    }

    if (raw.startsWith("__processing__:")) {
      const fullPath = raw.slice(15);
      setPreviewPath(fullPath);
      setCurrentFile(fullPath.replace(/.*[/\\]/, ""));
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

    const extM = raw.match(/^([^\s✓✗↷─═]+\.(png|jpg|jpeg|webp|tiff))$/i);
    if (extM) setCurrentFile(extM[1].trim());

    if (kind === "error") {
      setErrors(prev => {
        if (prev[prev.length - 1]?.raw === raw) return prev;
        return [...prev.slice(-200), { raw, kind, context: [...recentLog.current.slice(0, -1)] }];
      });
    }
  }, [classify]);

  const start = useCallback(async ({ folderMode, doUpscale, scale, doRembg, inputDir, outputDir, excludeList = [] }) => {
    if (running) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLog([]); setErrors([]);
    setImageDone(0); setImageSkipped(0); setImageError(0);
    setTotalImages(0); setCurrentFile(""); setPreviewPath(""); setRecentDone([]);
    setElapsed(0); setDone(false); setRunning(true);
    setStage(null); setStagesDone({ upscale: false, rembg: false });
    setUpStats({ done: 0, skip: 0, err: 0 });
    setBgStats({ done: 0, skip: 0, err: 0 });
    stageRef.current = "upscale";
    recentLog.current = [];
    doneSet.current = new Set(); skipSet.current = new Set(); errSet.current = new Set();

    try {
      const r = await fetch(`${BASE}/pipeline/run`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_mode: folderMode, do_upscale: doUpscale, scale,
          do_rembg: doRembg, input_dir: inputDir.trim(), output_dir: outputDir.trim(),
          exclude_rembg: excludeList,
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
            setStage("done"); setDone(true); setRunning(false); setCurrentFile("");
          } else if (msg.startsWith("__error__")) {
            appendLine(`Error: ${msg.replace("__error__ ", "")}`);
            setRunning(false); setCurrentFile("");
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
    try { await fetch(`${BASE}/pipeline/stop`, { method: "POST" }); } catch { }
    appendLine("Stopped by user.");
    setRunning(false); setCurrentFile(""); setStage(null);
  }, [appendLine]);

  return {
    running, done, log, errors, imageDone, imageSkipped, imageError,
    totalImages, currentFile, previewPath, recentDone, elapsed, stage, stagesDone,
    upStats, bgStats,
    logRef, errorRef, start, stop
  };
}

// ── Zone 1: Drop zone / Live stage animation ──────────────────────────────────

function Zone1({ running, done, stage, stagesDone, currentFile, previewPath, recentDone,
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
    } catch { }
    setBrowseLoading(false);
  };

  if (!running && !done) return (
    <div onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
      style={{
        flex: 1, display: "flex", flexDirection: "column",
        margin: "12px 12px 0 0", borderRadius: 6, overflow: "hidden",
        border: `2px dashed ${dragOver ? C.blue : C.border}`,
        background: dragOver ? "#0d1a2e" : "transparent",
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
    { id: "upscale", label: "Upscaling",  sub: "NCNN Vulkan", active: stage === "upscale", done: stagesDone.upscale, skip: !doUpscale },
    { id: "rembg",   label: "Remove BG",  sub: rembgModel || "birefnet-general", active: stage === "rembg", done: stagesDone.rembg, skip: !doRembg },
  ];

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "row",
      margin: "12px 12px 0 0", borderRadius: 6,
      border: `1px solid ${C.border}`, background: C.panel, overflow: "hidden"
    }}>
      <style>{`
        @keyframes pulseFade  { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes flowDot    { 0%{transform:translateX(0);opacity:0.15} 50%{transform:translateX(16px);opacity:1} 100%{transform:translateX(32px);opacity:0.15} }
        @keyframes slideIn    { from{opacity:0;transform:translateX(-8px)} to{opacity:1;transform:translateX(0)} }
        @keyframes previewIn  { from{opacity:0} to{opacity:1} }
        @keyframes blurPulse  { 0%,100%{filter:blur(8px) brightness(0.7)} 50%{filter:blur(5px) brightness(0.8)} }
      `}</style>

      {/* ── Left: stage cards ─────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", width: 220, flexShrink: 0, borderRight: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          {stages.map(s => (
            <div key={s.id} style={{
              flex: 1, textAlign: "center", padding: "5px 0",
              fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700,
              color: s.done ? C.green : s.active ? C.yellow : s.skip ? C.dim2 : C.dim
            }}>{s.label}</div>
          ))}
        </div>

        <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "0 8px", gap: 0, minHeight: 0 }}>
          {stages.map((s, i) => {
            const cardBg  = s.done ? "#0d2010" : s.active ? "#140c28" : C.panel2;
            const cardBdr = s.done ? "#1e4020" : s.active ? "#3a2070" : C.border;
            const cardGlow = s.active ? "0 0 14px #3a207066" : s.done ? "0 0 8px #1a402044" : "none";
            const textColor = s.done ? C.green : s.active ? C.yellow : s.skip ? C.dim2 : C.dim;
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", flex: 1 }}>
                <div style={{
                  flex: 1, background: cardBg, border: `1px solid ${cardBdr}`,
                  borderRadius: 5, padding: "10px 6px", textAlign: "center",
                  boxShadow: cardGlow, transition: "all 0.4s ease"
                }}>
                  {s.done && <div style={{ fontSize: 16, color: C.green, lineHeight: 1, marginBottom: 2 }}>✓</div>}
                  {s.active && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, animation: "pulseFade 1.4s ease-in-out infinite" }}>
                      <Spinner color={C.yellow} size={12} />
                      <span style={{ fontSize: 9, color: C.yellow, fontWeight: 600 }}>{s.sub}</span>
                    </div>
                  )}
                  {!s.active && !s.done && (
                    <div style={{ fontSize: 9, color: textColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {s.skip ? "skipped" : s.sub}
                    </div>
                  )}
                </div>
                {i < stages.length - 1 && (
                  <div style={{ width: 20, height: 2, background: C.dim2, flexShrink: 0, position: "relative", margin: "0 2px" }}>
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
            borderTop: `1px solid ${C.border}`, padding: "4px 8px",
            display: "flex", gap: 4, overflowX: "hidden", flexShrink: 0, alignItems: "center"
          }}>
            <span style={{ fontSize: 8, color: C.dim, textTransform: "uppercase", letterSpacing: "0.08em", flexShrink: 0 }}>Done:</span>
            {recentDone.slice(0, 3).map((f, i) => (
              <div key={i} style={{
                background: "#0d2010", border: `1px solid #1a3a20`,
                borderRadius: 3, padding: "2px 5px", fontSize: 8,
                fontFamily: "JetBrains Mono", color: C.green, flexShrink: 0,
                animation: "slideIn 0.2s ease",
                maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
              }}>✓ {f}</div>
            ))}
          </div>
        )}
      </div>

      {/* ── Right: live image preview ─────────────────────────────────── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden", background: "#08090f", minWidth: 0 }}>
        {previewPath ? (
          <>
            <img
              key={previewPath}
              src={`${BASE}/image?path=${encodeURIComponent(previewPath)}`}
              alt=""
              style={{
                width: "100%", height: "100%", objectFit: "contain",
                display: "block",
                animation: "blurPulse 2s ease-in-out infinite",
              }}
              onLoad={e => { e.target.style.animation = "previewIn 0.3s ease"; }}
            />
            <div style={{
              position: "absolute", bottom: 6, left: 0, right: 0,
              textAlign: "center", fontSize: 9, color: "rgba(255,255,255,0.45)",
              fontFamily: "JetBrains Mono", pointerEvents: "none",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              padding: "0 8px"
            }}>{currentFile}</div>
          </>
        ) : (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: "100%", color: C.dim2, fontSize: 11
          }}>
            {stage ? <Spinner color={C.dim} size={14} /> : "—"}
          </div>
        )}
      </div>
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

function LivePreview({ running, done, previewPath, currentFile, imageDone, totalImages }) {
  const [loaded, setLoaded] = useState(false);
  const [prevSrc, setPrevSrc] = useState("");

  // Track source changes to show loading state
  const src = previewPath
    ? `${BASE}/image?path=${encodeURIComponent(previewPath)}`
    : "";

  useEffect(() => {
    if (src !== prevSrc) { setLoaded(false); setPrevSrc(src); }
  }, [src]);

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
      background: "#07080e", border: `1px solid ${C.border}`, minHeight: 0,
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
            onLoad={() => setLoaded(true)}
            onError={() => setLoaded(true)}
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
            {currentFile || previewPath.replace(/.*[/\\]/, "")}
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

function LogPanel({ logRef, log, running }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{
      flex: open ? 1 : "0 0 auto", minWidth: 0,
      display: "flex", flexDirection: "column",
      marginRight: 6, transition: "flex 0.2s ease"
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
          flex: 1, overflowY: "auto", background: C.panel,
          border: `1px solid ${C.border}`, borderRadius: 4,
          padding: "8px 12px", fontFamily: "JetBrains Mono",
          fontSize: 11, lineHeight: 1.7,
        }}>
          {log.length === 0 && !running ? (
            <div style={{ color: C.dim, fontSize: 12 }}>Configure and press Run Pipeline.</div>
          ) : log.map((e, i) => (
            <div key={i} style={{
              overflowWrap: "break-word", wordBreak: "break-word",
              color: KIND_COLOR[e.kind] ?? C.dim,
              opacity: e.kind === "info" ? 0.55 : 1,
              paddingLeft: e.kind === "section" ? 0 : 4,
              borderLeft: e.kind === "section" ? `2px solid ${C.dim2}` : "2px solid transparent",
              marginBottom: e.kind === "section" ? 3 : 0,
            }}>
              {e.raw}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ErrorPanel — collapsible with context lines ───────────────────────────────

function ErrorPanel({ errorRef, errors, imageError }) {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState({});
  const hasErrors = imageError > 0;

  return (
    <div style={{
      width: open ? 290 : "auto", flexShrink: 0,
      display: "flex", flexDirection: "column",
      transition: "width 0.2s ease"
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
          background: hasErrors ? "#110808" : C.panel,
          border: `1px solid ${hasErrors ? "#3a1515" : C.border}`,
          borderRadius: 4, padding: "8px 10px",
          fontFamily: "JetBrains Mono", fontSize: 10, lineHeight: 1.7,
        }}>
          {errors.length === 0 ? (
            <div style={{ color: C.dim, fontSize: 11 }}>No errors</div>
          ) : errors.map((e, i) => (
            <div key={i} style={{
              paddingBottom: 8, marginBottom: 8,
              borderBottom: i < errors.length - 1 ? `1px solid #2a1212` : "none"
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
                      background: "#0a0505", borderRadius: 3,
                      border: `1px solid #2a1212`,
                    }}>
                      {e.context.map((line, j) => (
                        <div key={j} style={{
                          color: "#7a5050", whiteSpace: "pre-wrap", wordBreak: "break-word",
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

export default function Pipeline({ onGoToEditor, onGoToTemplates }) {
  const [folderMode, setFolderMode] = useState("bulk");
  const [doUpscale, setDoUpscale] = useState(true);
  const [scale, setScale] = useState("4");
  const [doRembg, setDoRembg] = useState(true);
  const [inputDir, setInputDir] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [canvasSize, setCanvasSize] = useState("1440");
  const [thumbnail, setThumbnail] = useState(true);
  const [excludeTags, setExcludeTags] = useState([]);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [rembgModel, setRembgModel] = useState("birefnet-general");

  // Load persisted settings from the API on first mount
  useEffect(() => {
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
      .catch(() => {})
      .finally(() => setSettingsLoaded(true));
  }, []);

  const {
    running, done, log, errors, imageDone, imageSkipped, imageError,
    totalImages, currentFile, previewPath, recentDone, elapsed, stage, stagesDone,
    upStats, bgStats,
    logRef, errorRef, start, stop,
  } = usePipeline();

  const handleStart = useCallback(() => {
    start({ folderMode, doUpscale, scale, doRembg, inputDir, outputDir, excludeList: excludeTags });
  }, [start, folderMode, doUpscale, scale, doRembg, inputDir, outputDir, excludeTags]);

  const handleGoToEditor = useCallback(() => {
    onGoToEditor({ outputDir: outputDir.trim(), canvasSize: parseInt(canvasSize, 10) || 1440, thumbnail });
  }, [onGoToEditor, outputDir, canvasSize, thumbnail]);

  const nothingSelected = !doUpscale && !doRembg;

  return (
    <div style={{
      display: "flex", flexDirection: "column", background: C.bg, height: "100%",
      overflow: "hidden", fontFamily: "'Outfit','DM Sans',system-ui,sans-serif",
      color: C.text, fontSize: 13
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        button:hover{filter:brightness(1.18)} button:active{filter:brightness(0.88)}
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#1d2235;border-radius:2px}
        ::placeholder{color:#2e3850} input[type=number]{color-scheme:dark}
      `}</style>

      <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0 }}>

        {/* Sidebar */}
        <div style={{
          width: 282, background: C.panel, borderRight: `1px solid ${C.border}`,
          padding: "14px", display: "flex", flexDirection: "column",
          flexShrink: 0, overflowY: "auto"
        }}>

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
            <Btn label="On" active={doUpscale} color={C.green} onClick={() => setDoUpscale(true)} />
            <Btn label="Off" active={!doUpscale} color={C.red} onClick={() => setDoUpscale(false)} />
          </Row>

          {doUpscale && (
            <Row label="Scale factor">
              <Btn label="2×" active={scale === "2"} onClick={() => setScale("2")} />
              <Btn label="4×" active={scale === "4"} onClick={() => setScale("4")} />
            </Row>
          )}

          <Row label="Remove BG (BiRefNet)">
            <Btn label="On" active={doRembg} color={C.green} onClick={() => setDoRembg(true)} />
            <Btn label="Off" active={!doRembg} color={C.red} onClick={() => setDoRembg(false)} />
          </Row>

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
            <Btn label="On" active={thumbnail} color={C.green} onClick={() => setThumbnail(true)} />
            <Btn label="Off" active={!thumbnail} color={C.red} onClick={() => setThumbnail(false)} />
          </Row>

          {/* Exclude from BG removal */}
          {doRembg && (
            <>
              <div style={{ marginTop: 14, marginBottom: 6, borderTop: `1px solid ${C.border}`, paddingTop: 12 }} />
              <SectionLabel>Exclude from BG removal</SectionLabel>
              <div style={{ fontSize: 10, color: C.dim, marginBottom: 5, lineHeight: 1.5 }}>
                Type filename → Enter to add. Click × to remove.
              </div>
              <TagInput tags={excludeTags} onChange={setExcludeTags} />
            </>
          )}

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
                {doRembg && <div style={{ fontSize: 12, color: C.green }}>✓ Remove BG ({rembgModel || "birefnet-general"})</div>}
              </>
            }
          </div>

          {/* Action buttons — always visible */}
          <div style={{ marginTop: "auto", paddingTop: 16 }}>
            {!running ? (
              <button onClick={handleStart} disabled={nothingSelected} style={{
                width: "100%", padding: "10px 0",
                background: nothingSelected ? C.dim2 : "#0d2818",
                color: nothingSelected ? C.dim : C.green,
                border: `1px solid ${nothingSelected ? C.border : "#1e4a2e"}`,
                borderRadius: 4, fontSize: 13, fontWeight: 600,
                cursor: nothingSelected ? "not-allowed" : "pointer", fontFamily: "inherit",
              }}>▶  Run Pipeline</button>
            ) : (
              <button onClick={stop} style={{
                width: "100%", padding: "10px 0", background: "#200d0d", color: C.red,
                border: `1px solid #3a1515`, borderRadius: 4, fontSize: 13, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit",
              }}>■  Stop</button>
            )}

            <button onClick={handleGoToEditor} style={{
              width: "100%", marginTop: 6, padding: "10px 0",
              background: "#0d1a2a", color: C.blue, border: `1px solid #1a2e4a`,
              borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            }}>Open Editor →</button>

            <button
              onClick={() => openFolder(outputDir.trim())}
              style={{
                width: "100%", marginTop: 6, padding: "10px 0",
                background: C.panel2, color: C.dim, border: `1px solid ${C.border}`,
                borderRadius: 4, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              📁 Open Output Folder
            </button>
          </div>
        </div>

        {/* Right: new layout
            Idle/done:  drop-zone fills top | log+error share bottom
            Running:    preview fills top  | compact stage bar | log+error share bottom
        */}
        <div style={{
          flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0,
          padding: "0 0 12px 12px"
        }}>

          {/* Top area — changes by state */}
          {(running || done) ? (
            /* Running / done: big preview on top */
            <div style={{ flex: "0 0 52%", display: "flex", flexDirection: "column", minHeight: 0, marginTop: 12 }}>
              <LivePreview
                running={running} done={done}
                previewPath={previewPath} currentFile={currentFile}
                imageDone={imageDone} totalImages={totalImages}
              />
              {/* Compact stage bar below preview */}
              <Zone2
                upStats={upStats} bgStats={bgStats}
                totalImages={totalImages} elapsed={elapsed}
                running={running} done={done} stage={stage}
                doUpscale={doUpscale} doRembg={doRembg}
                stagesDone={stagesDone}
              />
            </div>
          ) : (
            /* Idle: drop-zone */
            <div style={{ flex: "0 0 42%", display: "flex", minHeight: 0 }}>
              <Zone1
                running={running} done={done}
                stage={stage} stagesDone={stagesDone}
                currentFile={currentFile} previewPath={previewPath} recentDone={recentDone}
                imageDone={imageDone} totalImages={totalImages}
                doUpscale={doUpscale} doRembg={doRembg}
                inputDir={inputDir} setInputDir={setInputDir}
                rembgModel={rembgModel}
              />
            </div>
          )}

          {/* Bottom: log + error panels always visible */}
          <div style={{ flex: 1, display: "flex", gap: 0, minHeight: 0, marginTop: 10 }}>
            <LogPanel logRef={logRef} log={log} running={running} />
            <ErrorPanel errorRef={errorRef} errors={errors} imageError={imageError} />
          </div>
        </div>
      </div>
    </div>
  );
}