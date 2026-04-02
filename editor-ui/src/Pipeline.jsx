import { useState, useRef, useEffect, useCallback } from "react";

const BASE = "/api";

const C = {
  bg:"#0b0d14", panel:"#0f1219", panel2:"#161926",
  border:"#1d2235", text:"#d8e0f0", dim:"#454f6b", dim2:"#262d44",
  green:"#4ade80", blue:"#60a5fa", yellow:"#facc15",
  red:"#f87171", magenta:"#e879f9",
};

function Row({ label, children }) {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
      padding:"8px 0", borderBottom:`1px solid ${C.border}` }}>
      <span style={{ fontSize:12, color:C.dim }}>{label}</span>
      <div style={{ display:"flex", gap:6 }}>{children}</div>
    </div>
  );
}

function Pill({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: active ? C.panel2 : "transparent",
      color:      active ? C.text   : C.dim,
      border: `1px solid ${active ? C.border : "transparent"}`,
      borderRadius:4, padding:"3px 10px", fontSize:11,
      cursor:"pointer", fontFamily:"inherit",
    }}>{label}</button>
  );
}

function Spinner() {
  const [frame, setFrame] = useState(0);
  const chars = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
  useEffect(() => {
    const t = setInterval(() => setFrame(f => (f+1) % chars.length), 80);
    return () => clearInterval(t);   // ✓ cleanup on unmount
  }, []);
  return <span style={{ fontFamily:"JetBrains Mono" }}>{chars[frame]} running…</span>;
}

// ─── Custom hook: isolates all pipeline logic from UI ───────────────────────
function usePipeline() {
  const [running,  setRunning]  = useState(false);
  const [done,     setDone]     = useState(false);
  const [log,      setLog]      = useState([]);
  const abortRef = useRef(null);   // holds the AbortController
  const logRef   = useRef(null);   // for auto-scroll

  // Auto-scroll log to bottom whenever it updates
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const appendLog = useCallback((line) => {
    setLog(prev => [...prev.slice(-400), line]);
  }, []);

  const start = useCallback(async ({ folderMode, doUpscale, scale, doRembg }) => {
    if (running) return;

    // Create a fresh AbortController for this run
    const controller = new AbortController();
    abortRef.current = controller;

    setLog([]);
    setDone(false);
    setRunning(true);

    try {
      const body = { folder_mode: folderMode, do_upscale: doUpscale, scale, do_rembg: doRembg };
      const r = await fetch(`${BASE}/pipeline/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,   // ← abort hook
      });

      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: r.statusText }));
        appendLog(`Error: ${err.detail}`);
        setRunning(false);
        return;
      }

      const reader  = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const msg = line.slice(6);
          if (msg.startsWith("__done__")) {
            appendLog(msg.includes("exit=0") ? "── Pipeline complete ──" : "── Pipeline exited with errors ──");
            setDone(true);
            setRunning(false);
          } else if (msg.startsWith("__error__")) {
            appendLog(`Error: ${msg.replace("__error__ ", "")}`);
            setRunning(false);
          } else {
            appendLog(msg);
          }
        }
      }
    } catch (e) {
      if (e.name === "AbortError") {
        // User clicked Stop — already handled in stop()
        return;
      }
      appendLog(`Connection error: ${e.message}`);
      setRunning(false);
    }
  }, [running, appendLog]);

  const stop = useCallback(async () => {
    // 1. Cancel the in-flight fetch/stream immediately (client-side)
    abortRef.current?.abort();

    // 2. Ask the backend to terminate the subprocess too
    try {
      await fetch(`${BASE}/pipeline/stop`, { method: "POST" });
    } catch {
      // Best-effort — backend may already be dead
    }

    appendLog("── Stopped by user ──");
    setRunning(false);
  }, [appendLog]);

  return { running, done, log, logRef, start, stop };
}
// ────────────────────────────────────────────────────────────────────────────

export default function Pipeline({ onGoToEditor }) {
  const [folderMode, setFolderMode] = useState("bulk");
  const [doUpscale,  setDoUpscale]  = useState(true);
  const [scale,      setScale]      = useState("4");
  const [doRembg,    setDoRembg]    = useState(true);

  const { running, done, log, logRef, start, stop } = usePipeline();

  // Stable callback — avoids re-creating the function on every render
  const handleStart = useCallback(() => {
    start({ folderMode, doUpscale, scale, doRembg });
  }, [start, folderMode, doUpscale, scale, doRembg]);

  const nothingSelected = !doUpscale && !doRembg;

  return (
    <div style={{
      display:"flex", flexDirection:"column", background:C.bg, minHeight:"100vh",
      fontFamily:"'Outfit','DM Sans',system-ui,sans-serif", color:C.text, fontSize:13,
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        button:hover{filter:brightness(1.15)} button:active{filter:brightness(0.9)}
      `}</style>

      {/* ── Header ── */}
      <div style={{
        display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"10px 20px", borderBottom:`1px solid ${C.border}`, background:C.panel,
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:16 }}>
          <span style={{ fontSize:9, letterSpacing:"0.12em", color:C.dim, textTransform:"uppercase", fontWeight:600 }}>
            Image Pipeline
          </span>
          <span style={{ fontSize:9, color:C.dim2, fontFamily:"JetBrains Mono" }}>v3.2</span>
        </div>
        <button onClick={onGoToEditor} style={{
          background:"transparent", color:C.dim, border:`1px solid ${C.border}`,
          borderRadius:4, padding:"4px 12px", fontSize:11, cursor:"pointer", fontFamily:"inherit",
        }}>Placement Editor →</button>
      </div>

      <div style={{ display:"flex", flex:1, overflow:"hidden" }}>

        {/* ── Sidebar ── */}
        <div style={{
          width:280, background:C.panel, borderRight:`1px solid ${C.border}`,
          padding:"16px", display:"flex", flexDirection:"column", flexShrink:0,
        }}>
          <div style={{ fontSize:9, letterSpacing:"0.12em", color:C.dim, textTransform:"uppercase", fontWeight:600, marginBottom:12 }}>
            Configuration
          </div>

          <Row label="Folder mode">
            <Pill label="Bulk"  active={folderMode==="bulk"}  onClick={() => setFolderMode("bulk")} />
            <Pill label="Clean" active={folderMode==="clean"} onClick={() => setFolderMode("clean")} />
          </Row>
          <Row label="Upscale (NCNN)">
            <Pill label="On"  active={doUpscale}  onClick={() => setDoUpscale(true)} />
            <Pill label="Off" active={!doUpscale} onClick={() => setDoUpscale(false)} />
          </Row>
          {doUpscale && (
            <Row label="Scale factor">
              <Pill label="2×" active={scale==="2"} onClick={() => setScale("2")} />
              <Pill label="4×" active={scale==="4"} onClick={() => setScale("4")} />
            </Row>
          )}
          <Row label="Remove BG (BiRefNet)">
            <Pill label="On"  active={doRembg}  onClick={() => setDoRembg(true)} />
            <Pill label="Off" active={!doRembg} onClick={() => setDoRembg(false)} />
          </Row>

          {/* Will-run summary */}
          <div style={{
            marginTop:16, background:C.panel2, border:`1px solid ${C.border}`,
            borderRadius:4, padding:"10px 12px",
          }}>
            <div style={{ fontSize:9, color:C.dim, marginBottom:6, letterSpacing:"0.1em", textTransform:"uppercase" }}>
              Will run
            </div>
            {[
              doUpscale && `Upscale ×${scale} (NCNN Vulkan)`,
              doRembg   && `Remove BG (BiRefNet)`,
              nothingSelected && "Nothing — enable at least one stage",
            ].filter(Boolean).map((s, i) => (
              <div key={i} style={{ fontSize:11, color: String(s).startsWith("Nothing") ? C.red : C.green, marginBottom:2 }}>
                {String(s).startsWith("Nothing") ? "✕ " : "✓ "}{s}
              </div>
            ))}
          </div>

          {/* ── Action buttons ── */}
          <div style={{ marginTop:"auto", paddingTop:16 }}>
            {!running ? (
              <button
                onClick={handleStart}
                disabled={nothingSelected}
                style={{
                  width:"100%", padding:"9px 0",
                  background: nothingSelected ? C.dim2 : "#0f2818",
                  color:      nothingSelected ? C.dim  : C.green,
                  border:`1px solid ${nothingSelected ? C.border : "#1a4a2a"}`,
                  borderRadius:4, fontSize:12, fontWeight:600,
                  cursor: nothingSelected ? "not-allowed" : "pointer", fontFamily:"inherit",
                }}
              >
                Run Pipeline
              </button>
            ) : (
              // Real Stop — aborts fetch stream + calls backend terminate
              <button
                onClick={stop}
                style={{
                  width:"100%", padding:"9px 0", background:"#1a0f0f", color:C.red,
                  border:`1px solid #2a1515`, borderRadius:4, fontSize:12, fontWeight:600,
                  cursor:"pointer", fontFamily:"inherit",
                }}
              >
                ■ Stop
              </button>
            )}
            {done && (
              <button onClick={onGoToEditor} style={{
                width:"100%", marginTop:8, padding:"9px 0",
                background:"#0f1a2a", color:C.blue, border:`1px solid #1a2a4a`,
                borderRadius:4, fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit",
              }}>Open Placement Editor →</button>
            )}
          </div>
        </div>

        {/* ── Log panel ── */}
        <div style={{ flex:1, display:"flex", flexDirection:"column", padding:"12px 16px" }}>
          <div style={{ fontSize:9, letterSpacing:"0.12em", color:C.dim, textTransform:"uppercase", fontWeight:600, marginBottom:8 }}>
            Output
          </div>
          <div ref={logRef} style={{
            flex:1, overflowY:"auto", background:C.panel,
            border:`1px solid ${C.border}`, borderRadius:4,
            padding:"10px 12px", fontFamily:"JetBrains Mono",
            fontSize:11, lineHeight:1.7,
          }}>
            {log.length === 0 && !running && (
              <div style={{ color:C.dim }}>Configure options and press Run Pipeline.</div>
            )}
            {log.map((line, i) => (
              <div key={i} style={{
                whiteSpace:"pre-wrap", wordBreak:"break-all",
                color:
                  line.includes("complete")          ? C.green  :
                  line.includes("Stopped by user")   ? C.yellow :
                  line.includes("Error")             ? C.red    :
                  line.includes("warn")              ? C.yellow :
                  line.includes("skip")              ? C.dim    :
                  "#8fa0c0",
              }}>{line}</div>
            ))}
            {running && <div style={{ color:C.yellow, marginTop:4 }}><Spinner /></div>}
          </div>
        </div>
      </div>
    </div>
  );
}