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

function Pill({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: active ? "#1e2a42" : "transparent",
      color: active ? C.text : C.dim,
      border: `1px solid ${active ? "#2e4060" : "transparent"}`,
      borderRadius: 4, padding: "3px 10px", fontSize: 11,
      cursor: "pointer", fontFamily: "inherit",
    }}>{label}</button>
  );
}

function Toggle({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 3 }}>
      <button onClick={() => onChange(true)} style={{
        background: value ? "#0d2818" : "transparent",
        color: value ? C.green : C.dim,
        border: `1px solid ${value ? "#1e4a2e" : "transparent"}`,
        borderRadius: 4, padding: "3px 12px", fontSize: 11, minWidth: 40,
        cursor: "pointer", fontFamily: "inherit", fontWeight: value ? 600 : 400,
      }}>On</button>
      <button onClick={() => onChange(false)} style={{
        background: !value ? "#2a0d0d" : "transparent",
        color: !value ? C.red : C.dim,
        border: `1px solid ${!value ? "#4a1a1a" : "transparent"}`,
        borderRadius: 4, padding: "3px 12px", fontSize: 11, minWidth: 40,
        cursor: "pointer", fontFamily: "inherit", fontWeight: !value ? 600 : 400,
      }}>Off</button>
    </div>
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
        background: C.panel2, color: C.dim, border: `1px solid ${C.border}`,
        borderRadius: 4, padding: "5px 9px", fontSize: 12,
        cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
      }}>…</button>
    </div>
  );
}

function SectionLabel({ children, style = {} }) {
  return (
    <div style={{
      fontSize: 10, letterSpacing: "0.12em", color: C.dim,
      textTransform: "uppercase", fontWeight: 700, marginBottom: 8, ...style
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
  const chars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  useEffect(() => {
    const t = setInterval(() => setF(x => (x + 1) % chars.length), 80);
    return () => clearInterval(t);
  }, []);
  return <span style={{ fontFamily: "JetBrains Mono", fontSize: size, color }}>{chars[f]}</span>;
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

  const abortRef = useRef(null);
  const logRef = useRef(null);
  const errorRef = useRef(null);
  const timerRef = useRef(null);
  const startRef = useRef(null);
  const doneFilesRef = useRef(new Set());
  const skipFilesRef = useRef(new Set());
  const errorFilesRef = useRef(new Set());

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
    if (/→ (upscaled|bg_removed)[\\/]/.test(raw)) return "ok";
    if (/✗|Error|error|failed on |Traceback|Exception/i.test(raw)) return "error";
    if (/⚠|warn/i.test(raw)) return "warn";
    if (/↷|skip|already (upscaled|processed)/i.test(raw)) return "skip";
    if (/Stage \d|─{3,}|═{3,}|Summary|Configuration/.test(raw)) return "section";
    return "info";
  }, []);

  const appendLine = useCallback((raw) => {
    const kind = classify(raw);
    const entry = { raw, kind };
    setLog(prev => [...prev.slice(-800), entry]);

    // Parse total images from summary "Images    N"
    const totalM = raw.match(/Images[\s│]+(\d+)/);
    if (totalM) setTotalImages(parseInt(totalM[1], 10));

    // Track current file from description lines
    const currM = raw.match(/([^\s✓✗↷│ ][^\s│]{2,}\.(png|jpg|jpeg|webp|tiff))/i);
    if (currM && kind === "info") setCurrentFile(currM[1].trim());

    // Image-level completion — only count each image ONCE (final stage)
    const bgM = raw.match(/→ bg_removed[\\/](.+)$/);
    if (bgM) {
      const fname = bgM[1].split(/[\\/]/).pop();
      doneFilesRef.current.add(fname);
      setImageDone(doneFilesRef.current.size);
      setCurrentFile("");
      setRecentDone(prev => [fname, ...prev].slice(0, 8));
    } else {
      const upM = raw.match(/→ upscaled[\\/](.+)$/);
      if (upM) {
        const fname = upM[1].split(/[\\/]/).pop();
        // Only count if bg_removed won't come later (upscale-only run)
        // We add to doneFiles but rembg stage will overwrite the count if it runs
        if (!doneFilesRef.current.has(fname)) {
          doneFilesRef.current.add(fname);
          setImageDone(doneFilesRef.current.size);
          setRecentDone(prev => [fname, ...prev].slice(0, 8));
        }
        setCurrentFile("");
      }
    }

    // Skipped images
    const skipM = raw.match(/↷ skip: (.+?)(?: \(|$)/);
    if (skipM) {
      const fname = skipM[1].trim().split(/[\\/]/).pop();
      skipFilesRef.current.add(fname);
      setImageSkipped(skipFilesRef.current.size);
    }

    // Errors — add to error panel, count unique per-image errors
    if (kind === "error") {
      setErrors(prev => {
        if (prev[prev.length - 1]?.raw === raw) return prev;
        return [...prev.slice(-200), entry];
      });
      const errFileM = raw.match(/(?:failed on |on )([^\s:]+\.(png|jpg|jpeg|webp|tiff))/i);
      if (errFileM) {
        errorFilesRef.current.add(errFileM[1]);
        setImageError(errorFilesRef.current.size);
      } else {
        setImageError(c => c + 1);
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
    doneFilesRef.current = new Set();
    skipFilesRef.current = new Set();
    errorFilesRef.current = new Set();

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
          if (msg.startsWith("__done__")) { appendLine(msg.includes("exit=0") ? "✓ Pipeline complete." : "✗ Pipeline exited with errors."); setDone(true); setRunning(false); setCurrentFile(""); }
          else if (msg.startsWith("__error__")) { appendLine(`Error: ${msg.replace("__error__ ", "")}`); setRunning(false); setCurrentFile(""); }
          else { appendLine(msg); }
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
    setRunning(false); setCurrentFile("");
  }, [appendLine]);

  return {
    running, done, log, errors, imageDone, imageSkipped, imageError,
    totalImages, currentFile, recentDone, elapsed, logRef, errorRef, start, stop
  };
}

// ── Zone 1: Drop zone / Live animation ───────────────────────────────────────

function Zone1({ running, done, currentFile, recentDone, imageDone, totalImages, inputDir, setInputDir }) {
  const [dragOver, setDragOver] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState([]);

  const onDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);
  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    setDroppedFiles(files.map(f => f.name));
    const p = files[0].path;
    if (p) setInputDir(p.replace(/[\\/][^\\/]+$/, ""));
  };

  // Idle / drop state
  if (!running && !done) return (
    <div onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
      style={{
        flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", gap: 12,
        background: dragOver ? "#0d1a2e" : "transparent",
        border: `2px dashed ${dragOver ? C.blue : C.border}`,
        borderRadius: 6, margin: "12px 12px 0 0", transition: "all 0.15s", cursor: "default"
      }}>
      {droppedFiles.length === 0 ? (
        <>
          <div style={{ fontSize: 32, opacity: 0.2 }}>⬇</div>
          <div style={{ fontSize: 13, color: C.dim, textAlign: "center", lineHeight: 1.8 }}>
            Drop images here to auto-set input folder
            <br />
            <span style={{ fontSize: 11, color: C.dim2 }}>or use the Input field on the left</span>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 12, color: C.green }}>
            {droppedFiles.length} file{droppedFiles.length > 1 ? "s" : ""} queued
            {inputDir && <span style={{ color: C.dim, fontFamily: "JetBrains Mono", fontSize: 10, marginLeft: 6 }}>from {inputDir}</span>}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, justifyContent: "center", maxWidth: 400, padding: "0 16px" }}>
            {droppedFiles.slice(0, 14).map((f, i) => (
              <div key={i} style={{
                background: C.panel2, border: `1px solid ${C.border}`,
                borderRadius: 3, padding: "2px 8px", fontSize: 10,
                fontFamily: "JetBrains Mono", color: C.text
              }}>{f}</div>
            ))}
            {droppedFiles.length > 14 && <div style={{ fontSize: 10, color: C.dim }}>+{droppedFiles.length - 14} more</div>}
          </div>
        </>
      )}
    </div>
  );

  // Done state
  if (done) return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", gap: 14,
      margin: "12px 12px 0 0", borderRadius: 6,
      border: `1px solid ${C.border}`, background: C.panel
    }}>
      <div style={{ fontSize: 36, lineHeight: 1, color: C.green }}>✓</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: C.green }}>Pipeline complete</div>
      <div style={{ display: "flex", gap: 20 }}>
        <SmStat label="Done" value={imageDone} color={C.green} />
        <SmStat label="Total" value={totalImages || "—"} color={C.dim} />
      </div>
    </div>
  );

  // Running: animated pipeline diagram
  const stages = [
    { id: "input", label: "Input", sub: "queued", active: false },
    { id: "upscale", label: "Upscaling", sub: "NCNN Vulkan", active: true },
    { id: "rembg", label: "Remove BG", sub: "BiRefNet", active: true },
    { id: "output", label: "Output", sub: `${imageDone} done`, active: false },
  ];

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      margin: "12px 12px 0 0", borderRadius: 6,
      border: `1px solid ${C.border}`, background: C.panel, overflow: "hidden"
    }}>
      <style>{`
        @keyframes slideIn  { from{opacity:0;transform:translateX(-10px)} to{opacity:1;transform:translateX(0)} }
        @keyframes pulse    { 0%,100%{opacity:1} 50%{opacity:0.45} }
        @keyframes flowDot  { 0%{transform:translateX(0);opacity:0.15} 50%{transform:translateX(14px);opacity:1} 100%{transform:translateX(28px);opacity:0.15} }
      `}</style>

      {/* Stage header labels */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, padding: "5px 0", flexShrink: 0 }}>
        {stages.map(s => (
          <div key={s.id} style={{
            flex: 1, textAlign: "center", fontSize: 9,
            letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700,
            color: s.active ? C.yellow : C.dim
          }}>
            {s.label}
          </div>
        ))}
      </div>

      {/* Stage cards + flow arrows */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "0 12px", gap: 0, minHeight: 0 }}>
        {stages.map((s, i) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", flex: 1 }}>
            <div style={{
              flex: 1, background: s.active ? "#140c28" : C.panel2,
              border: `1px solid ${s.active ? "#3a2070" : C.border}`,
              borderRadius: 5, padding: "10px 8px", textAlign: "center",
              boxShadow: s.active ? "0 0 16px #3a207044" : "none"
            }}>

              {s.id === "input" && (
                <div style={{
                  fontSize: 10, color: C.dim, fontFamily: "JetBrains Mono",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
                }}>
                  {currentFile
                    ? <span style={{ color: C.text }}>{currentFile}</span>
                    : <span style={{ opacity: 0.35 }}>waiting…</span>}
                </div>
              )}

              {s.active && (
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  gap: 6, animation: "pulse 1.5s ease-in-out infinite"
                }}>
                  <Spinner color={C.yellow} size={13} />
                  <span style={{ fontSize: 10, color: C.yellow, fontWeight: 600 }}>{s.sub}</span>
                </div>
              )}

              {s.id === "output" && (
                <div style={{
                  fontSize: 11, color: imageDone > 0 ? C.green : C.dim,
                  fontFamily: "JetBrains Mono", fontWeight: 600
                }}>
                  {imageDone > 0 ? `${imageDone} done` : <span style={{ opacity: 0.35 }}>—</span>}
                </div>
              )}
            </div>

            {/* Arrow between stages */}
            {i < stages.length - 1 && (
              <div style={{ width: 28, position: "relative", height: 2, background: C.dim2, flexShrink: 0, margin: "0 2px" }}>
                <div style={{
                  position: "absolute", top: -4, left: 0, width: 10, height: 10,
                  borderRadius: "50%", background: C.yellow, opacity: 0.7,
                  animation: `flowDot 1.3s ease-in-out infinite`,
                  animationDelay: `${i * 0.43}s`
                }} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Recently completed filenames */}
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
          background: done
            ? (imageError > 0 ? C.yellow : C.green)
            : `linear-gradient(90deg, #22c55e, #4ade80)`,
        }} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 7 }}>
        <StatChip value={imageDone} label="Done" color={imageDone > 0 ? C.green : C.dim} />
        <StatChip value={imageSkipped} label="Skipped" color={imageSkipped > 0 ? C.yellow : C.dim} />
        <StatChip value={imageError} label="Errors" color={imageError > 0 ? C.red : C.dim} />
        {total > 0 && (
          <div style={{ fontSize: 12, color: C.dim, fontFamily: "JetBrains Mono" }}>
            {finished} / {total}
            {(running || done) && total > 0 && (
              <span style={{ marginLeft: 8, color: C.text, fontWeight: 600, fontSize: 13 }}>{pct}%</span>
            )}
          </div>
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

function StatChip({ label, value, color }) {
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
    totalImages, currentFile, recentDone, elapsed, logRef, errorRef, start, stop,
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
      display: "flex", flexDirection: "column", background: C.bg, height: "100vh", overflow: "hidden",
      fontFamily: "'Outfit','DM Sans',system-ui,sans-serif", color: C.text, fontSize: 13
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
              background: "transparent", color: C.dim, border: `1px solid ${C.border}`,
              borderRadius: 4, padding: "4px 14px", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
            }}>Templates</button>
          )}
          <button onClick={handleGoToEditor} style={{
            background: "transparent", color: C.dim, border: `1px solid ${C.border}`,
            borderRadius: 4, padding: "4px 14px", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
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
            <Pill label="Bulk" active={folderMode === "bulk"} onClick={() => setFolderMode("bulk")} />
            <Pill label="Clean" active={folderMode === "clean"} onClick={() => setFolderMode("clean")} />
          </Row>
          <Row label="Upscale (NCNN)"><Toggle value={doUpscale} onChange={setDoUpscale} /></Row>
          {doUpscale && (
            <Row label="Scale factor">
              <Pill label="2×" active={scale === "2"} onClick={() => setScale("2")} />
              <Pill label="4×" active={scale === "4"} onClick={() => setScale("4")} />
            </Row>
          )}
          <Row label="Remove BG (BiRefNet)"><Toggle value={doRembg} onChange={setDoRembg} /></Row>

          <div style={{ marginTop: 16, marginBottom: 16, borderTop: `1px solid ${C.border}` }} />
          <SectionLabel>Output settings</SectionLabel>

          <Row label="Canvas size (px)">
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {["1080", "1440", "2048"].map(s => (
                <Pill key={s} label={s} active={canvasSize === s} onClick={() => setCanvasSize(s)} />
              ))}
              <input type="number" value={canvasSize} onChange={e => setCanvasSize(e.target.value)}
                min={256} max={8192}
                style={{
                  width: 54, background: C.panel2, color: C.text,
                  border: `1px solid ${C.border}`, borderRadius: 4,
                  padding: "3px 5px", fontSize: 11, fontFamily: "JetBrains Mono",
                  outline: "none", textAlign: "center"
                }}
              />
            </div>
          </Row>
          <Row label="Thumbnail (400px)"><Toggle value={thumbnail} onChange={setThumbnail} /></Row>

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

          {/* Zone 1 — drop zone / animation (top ~45%) */}
          <div style={{ flex: "0 0 43%", display: "flex", minHeight: 0 }}>
            <Zone1
              running={running} done={done}
              currentFile={currentFile} recentDone={recentDone}
              imageDone={imageDone} totalImages={totalImages}
              inputDir={inputDir} setInputDir={setInputDir}
            />
          </div>

          {/* Zone 2 — progress bar */}
          <Zone2
            imageDone={imageDone} imageSkipped={imageSkipped}
            imageError={imageError} totalImages={totalImages}
            elapsed={elapsed} running={running} done={done}
          />

          {/* Zones 3+4 — logs (bottom ~55% minus progress) */}
          <div style={{ flex: 1, display: "flex", gap: 10, minHeight: 0, marginTop: 10 }}>

            {/* Zone 3: output log */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
              <div style={{
                fontSize: 10, letterSpacing: "0.12em", color: C.dim,
                textTransform: "uppercase", fontWeight: 700, marginBottom: 6
              }}>
                Output log
              </div>
              <div ref={logRef} style={{
                flex: 1, overflowY: "auto", background: C.panel,
                border: `1px solid ${C.border}`, borderRadius: 4,
                padding: "10px 12px", fontFamily: "JetBrains Mono",
                fontSize: 11, lineHeight: 1.8
              }}>
                {log.length === 0 && !running && (
                  <div style={{ color: C.dim, fontSize: 12 }}>Configure and press Run Pipeline.</div>
                )}
                {log.map((e, i) => (
                  <div key={i} style={{
                    whiteSpace: "pre-wrap", wordBreak: "break-all",
                    color: KIND_COLOR[e.kind] ?? C.dim,
                    opacity: e.kind === "info" ? 0.6 : 1
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
                  borderRadius: 4, padding: "10px 12px",
                  fontFamily: "JetBrains Mono", fontSize: 11, lineHeight: 1.8
                }}>
                  {errors.length === 0 ? (
                    <div style={{ color: C.dim, fontSize: 12 }}>No errors</div>
                  ) : errors.map((e, i) => (
                    <div key={i} style={{
                      color: C.red, whiteSpace: "pre-wrap", wordBreak: "break-all",
                      paddingBottom: 7, marginBottom: 7,
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