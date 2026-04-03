import { useState, useRef, useEffect, useCallback } from "react";

const BASE = "/api";

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

// Unified button — used for both pills and on/off toggles with consistent size
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
  const [errors, setErrors] = useState([]);
  const [imageDone, setImageDone] = useState(0);
  const [imageSkipped, setImageSkipped] = useState(0);
  const [imageError, setImageError] = useState(0);
  const [totalImages, setTotalImages] = useState(0);
  const [currentFile, setCurrentFile] = useState("");
  const [recentDone, setRecentDone] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  // stage: null | "upscale" | "rembg" | "done"
  const [stage, setStage] = useState(null);
  // which stages are complete
  const [stagesDone, setStagesDone] = useState({ upscale: false, rembg: false });

  const abortRef = useRef(null);
  const logRef = useRef(null);
  const errorRef = useRef(null);
  const timerRef = useRef(null);
  const startRef = useRef(null);
  const doneSet = useRef(new Set());
  const skipSet = useRef(new Set());
  const errSet = useRef(new Set());

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
    // Must come before generic ✓ check — these are stage completion lines
    if (/→ bg_removed/.test(raw) || /→ upscaled/.test(raw)) return "ok";
    if (/✓/.test(raw)) return "ok";
    if (/✗|Error|error|failed on |Traceback|Exception/i.test(raw)) return "error";
    if (/⚠|warn/i.test(raw)) return "warn";
    if (/↷|skip|already (upscaled|processed)/i.test(raw)) return "skip";
    if (/Stage \d|─{4,}|═{4,}/.test(raw)) return "section";
    return "info";
  }, []);

  const appendLine = useCallback((raw) => {
    const kind = classify(raw);
    const entry = { raw, kind };
    setLog(prev => [...prev.slice(-800), entry]);

    // ── Stage tracking ─────────────────────────────────────────────────────
    if (/Stage 1|Upscaling/.test(raw)) {
      setStage("upscale");
    } else if (/Stage 2|Background Removal/.test(raw)) {
      setStagesDone(s => ({ ...s, upscale: true }));
      setStage("rembg");
    }

    // ── Total image count from summary table ───────────────────────────────
    // pipeline.py: table.add_row("Images", str(len(images)))
    // After Rich grid render → "Images    9"  or "Images  9"
    const totalM = raw.match(/\bImages\s+(\d+)/i);
    if (totalM) setTotalImages(parseInt(totalM[1], 10));

    // ── Per-image completion counting (by filename, deduplicated) ─────────
    // ok() format: "  ✓ {src.name} → bg_removed/{rel_path}"
    // After ANSI+ctrl strip:  "✓ filename.ext → bg_removed/filename.ext"

    const bgM = raw.match(/→ bg_removed[/\\](.+)$/);
    if (bgM) {
      const fname = bgM[1].split(/[/\\]/).pop();
      if (!doneSet.current.has(fname)) {
        doneSet.current.add(fname);
        setImageDone(doneSet.current.size);
        setRecentDone(prev => [fname, ...prev].slice(0, 8));
      }
      setCurrentFile("");
      return;
    }

    const upM = raw.match(/→ upscaled[/\\](.+)$/);
    if (upM) {
      const fname = upM[1].split(/[/\\]/).pop();
      // Count upscaled if this is an upscale-only run (no rembg stage yet seen)
      if (!doneSet.current.has(fname)) {
        doneSet.current.add(fname);
        setImageDone(doneSet.current.size);
        setRecentDone(prev => [fname, ...prev].slice(0, 8));
      }
      setCurrentFile("");
      return;
    }

    // Skipped images
    const skipM = raw.match(/↷ skip: (.+?)(?:\s*\(|$)/);
    if (skipM) {
      const fname = skipM[1].trim().split(/[/\\]/).pop();
      if (!skipSet.current.has(fname)) {
        skipSet.current.add(fname);
        setImageSkipped(skipSet.current.size);
      }
      return;
    }

    // Current file being processed (progress description lines)
    // e.g. "tools-fine-blade-scissors-31741324230713.webp" alone on a line
    const extM = raw.match(/^([^\s✓✗↷─═]+\.(png|jpg|jpeg|webp|tiff))$/i);
    if (extM) setCurrentFile(extM[1].trim());

    // Errors
    if (kind === "error") {
      setErrors(prev => {
        if (prev[prev.length - 1]?.raw === raw) return prev;
        return [...prev.slice(-200), entry];
      });
      const errFileM = raw.match(/(?:failed on |on )([^\s:,]+\.(png|jpg|jpeg|webp|tiff))/i);
      const key = errFileM ? errFileM[1] : raw.slice(0, 60);
      if (!errSet.current.has(key)) {
        errSet.current.add(key);
        setImageError(errSet.current.size);
      }
    }
  }, [classify]);

  const start = useCallback(async ({ folderMode, doUpscale, scale, doRembg, inputDir, outputDir }) => {
    if (running) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLog([]); setErrors([]);
    setImageDone(0); setImageSkipped(0); setImageError(0);
    setTotalImages(0); setCurrentFile(""); setRecentDone([]);
    setElapsed(0); setDone(false); setRunning(true);
    setStage(null); setStagesDone({ upscale: false, rembg: false });
    doneSet.current = new Set(); skipSet.current = new Set(); errSet.current = new Set();

    try {
      const r = await fetch(`${BASE}/pipeline/run`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_mode: folderMode, do_upscale: doUpscale, scale,
          do_rembg: doRembg, input_dir: inputDir.trim(), output_dir: outputDir.trim()
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
    totalImages, currentFile, recentDone, elapsed, stage, stagesDone,
    logRef, errorRef, start, stop
  };
}

// ── Zone 1: Drop zone / Live stage animation ──────────────────────────────────

function Zone1({ running, done, stage, stagesDone, currentFile, recentDone,
  imageDone, totalImages, doUpscale, doRembg, inputDir, setInputDir }) {
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
    // In Electron: file.path gives the full path; derive folder from first file
    const p = files[0].path;
    if (p) {
      const folder = p.replace(/[/\\][^/\\]+$/, "");
      setInputDir(folder);
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

  // ── IDLE / DROP STATE ──────────────────────────────────────────────────────
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
        /* Empty drop zone */
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
        /* Dropped files grid */
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
          {/* Fixed-height scrollable grid of file chips */}
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

  // ── DONE STATE ─────────────────────────────────────────────────────────────
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

  // ── RUNNING: Stage diagram ─────────────────────────────────────────────────
  // Each stage card: grey=not started, yellow+pulse=active, green=complete
  const stages = [
    {
      id: "input", label: "Input", sub: currentFile
        ? currentFile.split(/[/\\]/).pop()
        : "reading files", active: stage === "upscale" && !currentFile, done: false
    },
    { id: "upscale", label: "Upscaling", sub: "NCNN Vulkan", active: stage === "upscale", done: stagesDone.upscale, skip: !doUpscale },
    { id: "rembg", label: "Remove BG", sub: "BiRefNet", active: stage === "rembg", done: stagesDone.rembg, skip: !doRembg },
    { id: "output", label: "Output", sub: `${imageDone} done`, active: false, done: stagesDone.rembg || stagesDone.upscale },
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

      {/* Stage labels */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        {stages.map(s => (
          <div key={s.id} style={{
            flex: 1, textAlign: "center", padding: "5px 0",
            fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700,
            color: s.done ? C.green : s.active ? C.yellow : s.skip ? C.dim2 : C.dim
          }}>
            {s.label}
          </div>
        ))}
      </div>

      {/* Stage cards */}
      <div style={{
        flex: 1, display: "flex", alignItems: "center",
        padding: "0 12px", gap: 0, minHeight: 0
      }}>
        {stages.map((s, i) => {
          const cardBg = s.done ? "#0d2010" : s.active ? "#140c28" : C.panel2;
          const cardBdr = s.done ? "#1e4020" : s.active ? "#3a2070" : C.border;
          const cardGlow = s.active ? "0 0 18px #3a207066" : s.done ? "0 0 12px #1a402044" : "none";
          const textColor = s.done ? C.green : s.active ? C.yellow : s.skip ? C.dim2 : C.dim;

          return (
            <div key={s.id} style={{ display: "flex", alignItems: "center", flex: 1 }}>
              <div style={{
                flex: 1, background: cardBg, border: `1px solid ${cardBdr}`,
                borderRadius: 5, padding: "10px 8px", textAlign: "center",
                boxShadow: cardGlow, transition: "all 0.4s ease"
              }}>

                {s.done && (
                  <div style={{ fontSize: 16, color: C.green, lineHeight: 1, marginBottom: 2 }}>✓</div>
                )}
                {s.active && (
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    gap: 6, animation: "pulseFade 1.4s ease-in-out infinite"
                  }}>
                    <Spinner color={C.yellow} size={13} />
                    <span style={{ fontSize: 10, color: C.yellow, fontWeight: 600 }}>{s.sub}</span>
                  </div>
                )}
                {!s.active && !s.done && (
                  <div style={{
                    fontSize: 10, color: textColor,
                    fontFamily: s.id === "input" || s.id === "output" ? "JetBrains Mono" : "inherit",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
                  }}>
                    {s.skip ? "skipped" : s.id === "output" ? (imageDone > 0 ? `${imageDone} done` : "—") : s.sub}
                  </div>
                )}
              </div>

              {/* Flow arrow */}
              {i < stages.length - 1 && (
                <div style={{
                  width: 28, height: 2, background: C.dim2,
                  flexShrink: 0, position: "relative", margin: "0 2px"
                }}>
                  <div style={{
                    position: "absolute", top: -4, left: 0, width: 10, height: 10,
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

      {/* Recently completed file chips */}
      {recentDone.length > 0 && (
        <div style={{
          borderTop: `1px solid ${C.border}`, padding: "5px 12px",
          display: "flex", gap: 5, overflowX: "hidden", flexShrink: 0, alignItems: "center"
        }}>
          <span style={{
            fontSize: 9, color: C.dim, textTransform: "uppercase",
            letterSpacing: "0.08em", flexShrink: 0
          }}>Done:</span>
          {recentDone.slice(0, 6).map((f, i) => (
            <div key={i} style={{
              background: "#0d2010", border: `1px solid #1a3a20`,
              borderRadius: 3, padding: "2px 7px", fontSize: 9,
              fontFamily: "JetBrains Mono", color: C.green, flexShrink: 0,
              animation: "slideIn 0.2s ease"
            }}>
              ✓ {f}
            </div>
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

// ── Zone 2: Progress bar ──────────────────────────────────────────────────────

function Zone2({ imageDone, imageSkipped, imageError, totalImages, elapsed, running, done }) {
  const total = totalImages || 0;
  const finished = imageDone + imageSkipped;
  const pct = total > 0 ? Math.min(100, Math.round(finished / total * 100)) : 0;
  const fmt = s => s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;

  return (
    <div style={{ margin: "10px 12px 0 0", flexShrink: 0 }}>
      <div style={{
        height: 6, background: C.panel2, borderRadius: 3,
        overflow: "hidden", border: `1px solid ${C.border}`
      }}>
        <div style={{
          height: "100%", borderRadius: 3, transition: "width 0.5s ease",
          width: running ? `${pct}%` : done ? "100%" : "0%",
          background: done ? (imageError > 0 ? C.yellow : C.green) : `linear-gradient(90deg,#22c55e,#4ade80)`,
        }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 7 }}>
        <Chip value={imageDone} label="Done" color={imageDone > 0 ? C.green : C.dim} />
        <Chip value={imageSkipped} label="Skipped" color={imageSkipped > 0 ? C.yellow : C.dim} />
        <Chip value={imageError} label="Errors" color={imageError > 0 ? C.red : C.dim} />
        {total > 0 && (
          <span style={{ fontSize: 12, color: C.dim, fontFamily: "JetBrains Mono" }}>
            {finished}/{total}
            {(running || done) && (
              <span style={{ marginLeft: 8, color: C.text, fontWeight: 600 }}>{pct}%</span>
            )}
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {(running || done) && (
            <span style={{ fontSize: 12, color: C.dim, fontFamily: "JetBrains Mono" }}>⏱ {fmt(elapsed)}</span>
          )}
          {running && <Spinner color={C.yellow} size={12} />}
          {done && !running && (
            <span style={{
              fontSize: 12, fontFamily: "JetBrains Mono",
              color: imageError > 0 ? C.yellow : C.green
            }}>
              {imageError > 0 ? "⚠ done with errors" : "✓ complete"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({ label, value, color }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
      <span style={{ fontSize: 16, fontWeight: 700, color, fontFamily: "JetBrains Mono", lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
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
  const [showErrors, setShowErrors] = useState(true);

  const {
    running, done, log, errors, imageDone, imageSkipped, imageError,
    totalImages, currentFile, recentDone, elapsed, stage, stagesDone,
    logRef, errorRef, start, stop,
  } = usePipeline();

  const handleStart = useCallback(() => {
    start({ folderMode, doUpscale, scale, doRembg, inputDir, outputDir });
  }, [start, folderMode, doUpscale, scale, doRembg, inputDir, outputDir]);

  const handleGoToEditor = useCallback(() => {
    onGoToEditor({ outputDir: outputDir.trim(), canvasSize: parseInt(canvasSize, 10) || 1440, thumbnail });
  }, [onGoToEditor, outputDir, canvasSize, thumbnail]);

  const nothingSelected = !doUpscale && !doRembg;

  return (
    <div style={{
      display: "flex", flexDirection: "column", background: C.bg, height: "100vh",
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

      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 18px", height: 44, borderBottom: `1px solid ${C.border}`,
        background: C.panel, flexShrink: 0
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Image Pipeline</span>
          <span style={{ fontSize: 9, color: C.dim2, fontFamily: "JetBrains Mono" }}>v3.2</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {onGoToTemplates && (
            <button onClick={onGoToTemplates} style={{
              background: "transparent", color: C.dim,
              border: `1px solid ${C.border}`, borderRadius: 4, padding: "4px 14px",
              fontSize: 12, cursor: "pointer", fontFamily: "inherit"
            }}>Templates</button>
          )}
          <button onClick={handleGoToEditor} style={{
            background: "transparent", color: C.dim,
            border: `1px solid ${C.border}`, borderRadius: 4, padding: "4px 14px",
            fontSize: 12, cursor: "pointer", fontFamily: "inherit"
          }}>Editor →</button>
        </div>
      </div>

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

          {/* Will run */}
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
                {doRembg && <div style={{ fontSize: 12, color: C.green }}>✓ Remove BG (BiRefNet)</div>}
              </>
            }
          </div>

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
            {done && (
              <button onClick={handleGoToEditor} style={{
                width: "100%", marginTop: 6, padding: "10px 0",
                background: "#0d1a2a", color: C.blue, border: `1px solid #1a2e4a`,
                borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              }}>Open Editor →</button>
            )}
          </div>
        </div>

        {/* Right: 4-zone layout */}
        <div style={{
          flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0,
          padding: "0 0 12px 12px"
        }}>

          {/* Zone 1 */}
          <div style={{ flex: "0 0 42%", display: "flex", minHeight: 0 }}>
            <Zone1
              running={running} done={done}
              stage={stage} stagesDone={stagesDone}
              currentFile={currentFile} recentDone={recentDone}
              imageDone={imageDone} totalImages={totalImages}
              doUpscale={doUpscale} doRembg={doRembg}
              inputDir={inputDir} setInputDir={setInputDir}
            />
          </div>

          {/* Zone 2 */}
          <Zone2
            imageDone={imageDone} imageSkipped={imageSkipped}
            imageError={imageError} totalImages={totalImages}
            elapsed={elapsed} running={running} done={done}
          />

          {/* Zones 3 + 4 */}
          <div style={{ flex: 1, display: "flex", gap: 10, minHeight: 0, marginTop: 10 }}>

            {/* Zone 3: output log */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
              <div style={{
                fontSize: 10, letterSpacing: "0.12em", color: C.dim,
                textTransform: "uppercase", fontWeight: 700, marginBottom: 6
              }}>Output log</div>
              <div ref={logRef} style={{
                flex: 1, overflowY: "auto", background: C.panel,
                border: `1px solid ${C.border}`, borderRadius: 4,
                padding: "8px 12px", fontFamily: "JetBrains Mono",
                fontSize: 11, lineHeight: 1.75
              }}>
                {log.length === 0 && !running ? (
                  <div style={{ color: C.dim, fontSize: 12 }}>Configure and press Run Pipeline.</div>
                ) : log.map((e, i) => (
                  <div key={i} style={{
                    whiteSpace: "pre-wrap", wordBreak: "break-all",
                    color: KIND_COLOR[e.kind] ?? C.dim,
                    opacity: e.kind === "info" ? 0.6 : 1,
                    paddingLeft: e.kind === "section" ? 0 : 4,
                    borderLeft: e.kind === "section" ? `2px solid ${C.dim2}` : "2px solid transparent",
                    marginBottom: e.kind === "section" ? 2 : 0,
                  }}>
                    {e.raw}
                  </div>
                ))}
              </div>
            </div>

            {/* Zone 4: error log */}
            <div style={{ width: 264, display: "flex", flexDirection: "column", flexShrink: 0 }}>
              <div style={{
                display: "flex", alignItems: "center",
                justifyContent: "space-between", marginBottom: 6
              }}>
                <div style={{
                  fontSize: 10, letterSpacing: "0.12em", fontWeight: 700,
                  textTransform: "uppercase",
                  color: imageError > 0 ? C.red : C.dim
                }}>
                  Errors {imageError > 0 ? `(${imageError})` : ""}
                </div>
                <button onClick={() => setShowErrors(v => !v)} style={{
                  background: "transparent", color: C.dim, border: "none",
                  fontSize: 11, cursor: "pointer", fontFamily: "inherit", padding: 0
                }}>
                  {showErrors ? "▾ hide" : "▸ show"}
                </button>
              </div>
              {showErrors && (
                <div ref={errorRef} style={{
                  flex: 1, overflowY: "auto",
                  background: imageError > 0 ? "#110808" : C.panel,
                  border: `1px solid ${imageError > 0 ? "#3a1515" : C.border}`,
                  borderRadius: 4, padding: "8px 12px",
                  fontFamily: "JetBrains Mono", fontSize: 11, lineHeight: 1.75
                }}>
                  {errors.length === 0 ? (
                    <div style={{ color: C.dim, fontSize: 12 }}>No errors</div>
                  ) : errors.map((e, i) => (
                    <div key={i} style={{
                      color: C.red, whiteSpace: "pre-wrap",
                      wordBreak: "break-all", paddingBottom: 7, marginBottom: 7,
                      borderBottom: i < errors.length - 1 ? `1px solid #2a1212` : "none"
                    }}>
                      {e.raw}
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}