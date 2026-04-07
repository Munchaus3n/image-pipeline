import { useState, useRef, useEffect, useCallback } from "react";
import {
  getConfig, getSource, getImages,
  imageUrl, saveComposition, skipImage,
  getSession, saveSession, clearSession,
  browseFolder,
} from "./api.js";

let CANVAS_SIZE = 1440;
// Compute display size from available viewport height (minus header + status bar)
const DS = Math.min(720, Math.floor(window.innerHeight - 110));
const scaleFactor = () => DS / CANVAS_SIZE;

const C = {
  bg: "#0b0d14", panel: "#0f1219", panel2: "#161926",
  border: "#1d2235", text: "#e2e8f8", dim: "#6b7a9e", dim2: "#2a3350",
  green: "#4ade80", blue: "#60a5fa", yellow: "#facc15",
  red: "#f87171", magenta: "#e879f9",
};

function itemBounds(item) {
  const S = scaleFactor();
  const w = item.origW * item.scale * S;
  const h = item.origH * item.scale * S;
  return { x: item.canvasX * S - w / 2, y: item.canvasY * S - h / 2, w, h };
}

function loadImageSize(url) {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 500, height: 500 });
    img.src = url;
  });
}

function Divider({ label }) {
  return (
    <div style={{ margin: "14px 0 6px", borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
      <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.12em", color: C.dim, textTransform: "uppercase" }}>
        {label}
      </span>
    </div>
  );
}

function Btn({ children, onClick, style = {} }) {
  return (
    <button onClick={onClick} style={{
      background: C.panel2, color: C.text, border: `1px solid ${C.border}`,
      borderRadius: 4, padding: "5px 8px", fontSize: 11, cursor: "pointer",
      width: "100%", textAlign: "left", fontFamily: "inherit", ...style,
    }}>{children}</button>
  );
}

export default function App({ onGoPipeline, outputDir = "", canvasSize: canvasSizeProp = null, thumbnail: thumbnailProp = true }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const dragRef = useRef(null);
  const undoRef = useRef(null);
  const imagesRef = useRef([]);

  const [guides, setGuides] = useState({});
  const [templates, setTemplates] = useState({});
  const [srcFolder, setSrcFolder] = useState("");
  const [srcLabel, setSrcLabel] = useState("…");
  const [queue, setQueue] = useState([]);
  const [queueIdx, setQueueIdx] = useState(0);
  const [items, setItems] = useState([]);
  const [selId, setSelId] = useState(null);
  const [template, setTemplate] = useState("— none —");
  const [scaleLocked, setScaleLocked] = useState(false);
  const [comboMode, setComboMode] = useState(false);
  const [status, setStatus] = useState("loading…");
  const [saved, setSaved] = useState(false);
  const [loading,        setLoading]        = useState(true);
  const [guideOpacity,   setGuideOpacity]   = useState(0.33);   // read from settings
  const [refImgOpacity,  setRefImgOpacity]  = useState(0.20);   // read from settings
  const [refImgRef,      setRefImgRef]      = useState(null);    // loaded HTMLImageElement for template ref
  const [refImgVersion,  setRefImgVersion]  = useState(0);       // bumps to trigger redraw

  const sel = items.find(it => it.id === selId) ?? null;

  // Load template reference image as HTMLImageElement whenever template changes
  useEffect(() => {
    const tmpl = templates[template];
    const src = tmpl?.ref_image;
    if (!src) { setRefImgRef(null); return; }
    const img = new window.Image();
    img.onload  = () => { setRefImgRef(img); setRefImgVersion(v => v + 1); };
    img.onerror = () => { setRefImgRef(null); };
    img.src = src.startsWith("data:") ? src : `/api/image?path=${encodeURIComponent(src)}`;
  }, [template, templates]);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await getConfig();
        // canvasSizeProp from Pipeline settings overrides the server config
        CANVAS_SIZE = canvasSizeProp ?? cfg.canvas_size;
        setGuides(cfg.guides);
        // Read appearance settings — /config now returns cfg.settings from settings.json
        if (cfg.settings?.appearance) {
          const a = cfg.settings.appearance;
          if (a.guide_opacity   != null) setGuideOpacity(a.guide_opacity);
          if (a.ref_img_opacity != null) setRefImgOpacity(a.ref_img_opacity);
        }
        // Load from /templates/list so edits made in Templates tab are reflected
        try {
          const tplData = await fetch("/api/templates/list").then(r => r.json());
          setTemplates(tplData.templates || cfg.templates);
        } catch {
          setTemplates(cfg.templates);
        }

        const session = await getSession();
        if (session.exists) {
          const resume = window.confirm(
            `Resume from image ${session.queue_index + 1}/${session.total}?\n${session.src_root}`
          );
          if (resume) {
            await initFromFolder(session.src_root, session.queue_index, cfg.guides);
            if (session.template && cfg.templates[session.template]) setTemplate(session.template);
            setLoading(false);
            return;
          } else {
            await clearSession();
          }
        }

        // Use outputDir from the pipeline run if available, otherwise auto-detect
        const src = await getSource(outputDir);
        setSrcLabel(src.label);
        await initFromFolder(src.folder, 0, cfg.guides);
        setLoading(false);
      } catch (e) {
        setStatus(`API error: ${e.message}\nIs api.py running?`);
        setLoading(false);
      }
    })();
  }, []);

  async function initFromFolder(folder, startIdx, guidesOverride) {
    const result = await getImages(folder);
    setSrcFolder(folder);
    setSrcLabel(folder.split(/[\\/]/).pop());
    setQueue(result.images);
    setQueueIdx(startIdx);
    setItems([]);
    setSelId(null);
    await loadImage(result.images, startIdx, false, guidesOverride);
    setStatus("drag=move  scroll=resize  arrows=nudge  ctrl+z=undo");
  }

  async function loadImage(q, idx, isCombo, guidesOverride) {
    if (idx >= q.length) { allDone(); return; }
    const path = q[idx];
    const url = imageUrl(path);
    const { width, height } = await loadImageSize(url);

    const htmlImg = new window.Image();
    await new Promise(r => { htmlImg.onload = r; htmlImg.onerror = r; htmlImg.src = url; });

    const g = (guidesOverride ?? guides)["green"] ?? { top: 224, bottom: 1216 };
    const initScale = (g.bottom - g.top) / height;

    const newItem = {
      id: Date.now(),
      label: path.split(/[\\/]/).pop(),
      filePath: path,
      canvasX: CANVAS_SIZE / 2,
      canvasY: Math.round((g.top + g.bottom) / 2),
      scale: initScale,
      origW: width,
      origH: height,
      htmlImg,
    };

    if (isCombo) {
      setItems(prev => [...prev, newItem]);
      imagesRef.current = [...imagesRef.current, htmlImg];
    } else {
      setItems([newItem]);
      imagesRef.current = [htmlImg];
    }
    setSelId(newItem.id);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || Object.keys(guides).length === 0) return;
    const ctx = canvas.getContext("2d");
    const S = scaleFactor();
    ctx.clearRect(0, 0, DS, DS);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, DS, DS);

    for (const g of Object.values(guides)) {
      const t = g.top * S, b = g.bottom * S, l = g.left * S, r = g.right * S;
      const opHex = Math.round(guideOpacity * 255).toString(16).padStart(2,"0");
      ctx.strokeStyle = g.color + opHex;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(0, t); ctx.lineTo(DS, t);
      ctx.moveTo(0, b); ctx.lineTo(DS, b);
      ctx.moveTo(l, 0); ctx.lineTo(l, DS);
      ctx.moveTo(r, 0); ctx.lineTo(r, DS);
      ctx.stroke();
    }

    const tmpl = templates[template];
    if (tmpl?.zone && guides[tmpl.zone]) {
      const g = guides[tmpl.zone];
      const t = g.top * S, b = g.bottom * S, l = g.left * S, r = g.right * S;
      ctx.setLineDash([]);
      ctx.strokeStyle = g.color + "cc";
      ctx.lineWidth = 2;
      ctx.strokeRect(l, t, r - l, b - t);
      ctx.fillStyle = g.color + "14";
      ctx.fillRect(l, t, r - l, b - t);
    }

    ctx.setLineDash([]);

    // Draw template reference image at user-configured opacity
    if (refImgRef?.complete && refImgRef.naturalWidth > 0) {
      ctx.save();
      ctx.globalAlpha = refImgOpacity;
      const ri = refImgRef;
      const rScale = Math.min(DS / ri.naturalWidth, DS / ri.naturalHeight);
      const rw = ri.naturalWidth  * rScale;
      const rh = ri.naturalHeight * rScale;
      ctx.drawImage(ri, (DS - rw) / 2, (DS - rh) / 2, rw, rh);
      ctx.restore();
    }

    for (const item of items) {
      const { x, y, w, h } = itemBounds(item);
      if (item.htmlImg?.complete) {
        ctx.drawImage(item.htmlImg, x, y, w, h);
      } else {
        ctx.fillStyle = "#3b82f644";
        ctx.fillRect(x, y, w, h);
      }
    }

    if (sel) {
      const { x, y, w, h } = itemBounds(sel);
      ctx.strokeStyle = C.yellow;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
      ctx.setLineDash([]);
      ctx.fillStyle = C.yellow;
      [[x - 2, y - 2], [x + w + 2, y - 2], [x - 2, y + h + 2], [x + w + 2, y + h + 2]].forEach(([hx, hy]) => {
        ctx.fillRect(hx - 3, hy - 3, 6, 6);
      });
      const lock = scaleLocked ? " [lock]" : "";
      const info = `x:${sel.canvasX}  y:${sel.canvasY}  scale:${sel.scale.toFixed(3)}${lock}`;
      ctx.fillStyle = "rgba(0,0,0,0.72)";
      ctx.fillRect(4, DS - 20, info.length * 5.6 + 8, 16);
      ctx.fillStyle = C.yellow;
      ctx.font = "8px 'JetBrains Mono', monospace";
      ctx.textAlign = "left";
      ctx.fillText(info, 8, DS - 8);
    }
  }, [items, selId, template, scaleLocked, guides, templates, guideOpacity, refImgOpacity, refImgRef, refImgVersion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e) => {
      e.preventDefault();
      if (scaleLocked || !selId) return;
      const f = e.deltaY < 0 ? 1.04 : 0.96;
      setItems(prev => prev.map(it =>
        it.id === selId ? { ...it, scale: Math.max(0.02, Math.min(4.0, it.scale * f)) } : it
      ));
    };
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, [scaleLocked, selId]);

  const onMouseDown = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      const { x, y, w, h } = itemBounds(it);
      if (mx >= x && mx <= x + w && my >= y && my <= y + h) {
        undoRef.current = { id: it.id, canvasX: it.canvasX, canvasY: it.canvasY, scale: it.scale };
        setSelId(it.id);
        dragRef.current = { itemId: it.id, ox: mx - it.canvasX * scaleFactor(), oy: my - it.canvasY * scaleFactor() };
        containerRef.current?.focus();
        return;
      }
    }
    setSelId(null);
    dragRef.current = null;
  }, [items]);

  const onMouseMove = useCallback((e) => {
    if (!dragRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const S = scaleFactor();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { itemId, ox, oy } = dragRef.current;
    setItems(prev => prev.map(it =>
      it.id === itemId ? { ...it, canvasX: Math.round((mx - ox) / S), canvasY: Math.round((my - oy) / S) } : it
    ));
  }, []);

  const onMouseUp = useCallback(() => { dragRef.current = null; }, []);

  const onKeyDown = useCallback((e) => {
    const n = e.shiftKey ? 10 : 1;
    const map = { ArrowLeft: [-n, 0], ArrowRight: [n, 0], ArrowUp: [0, -n], ArrowDown: [0, n] };
    if (map[e.key]) {
      e.preventDefault();
      if (!selId) return;
      const [dx, dy] = map[e.key];
      setItems(prev => prev.map(it => it.id === selId ? { ...it, canvasX: it.canvasX + dx, canvasY: it.canvasY + dy } : it));
      return;
    }
    if (e.key === "Enter") doSave();
    if (e.key === "s" || e.key === "S") doSkip();
    if ((e.ctrlKey || e.metaKey) && e.key === "z") doUndo();
  }, [selId, items, queue, queueIdx, srcFolder, template, comboMode]);

  function doUndo() {
    if (!undoRef.current) return;
    const { id, canvasX, canvasY, scale } = undoRef.current;
    setItems(prev => prev.map(it => it.id === id ? { ...it, canvasX, canvasY, scale } : it));
    undoRef.current = null;
    setStatus("undone.");
  }

  async function doSave() {
    if (!items.length) return;
    try {
      const payload = items.map(it => ({
        image_path: it.filePath,
        canvas_x: it.canvasX,
        canvas_y: it.canvasY,
        scale: it.scale,
      }));
      const result = await saveComposition(
        payload, srcFolder, queueIdx, comboMode,
        thumbnailProp,          // thumbnail on/off from Pipeline settings
        canvasSizeProp,         // canvas size override from Pipeline settings
      );
      setSaved(true);
      setStatus(`saved: ${result.saved.split(/[\\/]/).pop()}`);
      setTimeout(() => setSaved(false), 1600);
      await saveSession({ src_root: srcFolder, queue_index: queueIdx + 1, template });
      advance();
    } catch (e) {
      setStatus(`save failed: ${e.message}`);
    }
  }

  async function doSkip() {
    if (queueIdx < queue.length) {
      try { await skipImage(queue[queueIdx]); } catch (_) { }
    }
    setStatus("skipped.");
    advance();
  }

  function advance() {
    const nextIdx = queueIdx + 1;
    setQueueIdx(nextIdx);
    if (!comboMode) { setItems([]); setSelId(null); }
    loadImage(queue, nextIdx, comboMode);
  }

  function allDone() {
    setItems([]); setSelId(null);
    setStatus("all images processed.\noutput → output/final/");
    clearSession();
  }

  function removeSelected() {
    if (!selId) return;
    setItems(prev => prev.filter(it => it.id !== selId));
    setSelId(null);
  }

  function snapTo(zone) {
    if (!sel) { setStatus("select an item first."); return; }
    const g = guides[zone];
    if (!g) return;
    undoRef.current = { id: sel.id, canvasX: sel.canvasX, canvasY: sel.canvasY, scale: sel.scale };
    setItems(prev => prev.map(it =>
      it.id === selId ? {
        ...it,
        scale: (g.bottom - g.top) / it.origH,
        canvasX: CANVAS_SIZE / 2,
        canvasY: Math.round((g.top + g.bottom) / 2),
      } : it
    ));
  }

  function doAlign(axis) {
    if (!selId) return;
    undoRef.current = sel ? { id: sel.id, canvasX: sel.canvasX, canvasY: sel.canvasY, scale: sel.scale } : null;
    setItems(prev => prev.map(it =>
      it.id === selId
        ? axis === "h" ? { ...it, canvasX: CANVAS_SIZE / 2 } : { ...it, canvasY: CANVAS_SIZE / 2 }
        : it
    ));
  }

  function onTemplateChange(name) {
    setTemplate(name);
    const tmpl = templates[name];
    if (tmpl?.zone && sel) snapTo(tmpl.zone);
  }

  function nudgeScale(d) {
    if (scaleLocked || !sel) return;
    undoRef.current = { id: sel.id, canvasX: sel.canvasX, canvasY: sel.canvasY, scale: sel.scale };
    setItems(prev => prev.map(it =>
      it.id === selId ? { ...it, scale: Math.max(0.02, Math.min(4.0, it.scale + d)) } : it
    ));
  }

  const snapBtns = [
    { lbl: "G", zone: "green", col: C.green },
    { lbl: "B", zone: "blue", col: C.blue },
    { lbl: "M", zone: "magenta", col: C.magenta },
    { lbl: "R", zone: "red", col: C.red },
  ];

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      style={{
        display: "flex", background: C.bg, height: "100vh", overflow: "hidden",
        fontFamily: "'Outfit','DM Sans',system-ui,sans-serif",
        color: C.text, outline: "none", userSelect: "none", fontSize: 13,
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        ::-webkit-scrollbar{width:5px} ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#1d2235;border-radius:3px}
        button:hover{filter:brightness(1.12)} button:active{filter:brightness(0.9)}
        select,input{outline:none} input[type=range]{accent-color:#4ade80}
        input[type=checkbox]{accent-color:#4ade80}
      `}</style>

      {/* Canvas column — flex:1 fills all remaining width */}
      <div style={{
        flex: 1, padding: "10px 8px 10px 12px", display: "flex",
        flexDirection: "column", gap: 8, minWidth: 0
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 24 }}>
          <span style={{ fontSize: 10, letterSpacing: "0.1em", color: C.dim, textTransform: "uppercase", fontWeight: 700 }}>
            Placement Editor
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 10, color: C.dim2, fontFamily: "JetBrains Mono" }}>{CANVAS_SIZE} × {CANVAS_SIZE}</span>
            <button onClick={onGoPipeline} style={{
              background: "transparent", color: C.dim, border: `1px solid ${C.border}`,
              borderRadius: 4, padding: "3px 12px", fontSize: 11, cursor: "pointer", fontFamily: "inherit",
            }}>← Pipeline</button>
          </div>
        </div>

        {/* Canvas + status bar centered */}
        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "flex-start", minHeight: 0
        }}>
          <canvas
            ref={canvasRef} width={DS} height={DS}
            onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
            style={{
              border: `1px solid ${C.border}`, cursor: "crosshair",
              display: "block", borderRadius: 2, flexShrink: 0
            }}
          />
          <div style={{
            marginTop: 6, width: DS,
            display: "flex", alignItems: "center", gap: 12,
            background: C.panel, border: `1px solid ${C.border}`,
            borderRadius: 4, padding: "5px 10px", flexShrink: 0,
          }}>
            {[
              { lbl: "Upscale", done: true },
              { lbl: "Rembg", done: true },
              { lbl: "Place", done: false, active: true },
              { lbl: "Export", done: false },
            ].map(({ lbl, done, active }) => (
              <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: done ? C.green : active ? C.yellow : C.dim2,
                  boxShadow: active ? `0 0 6px ${C.yellow}88` : "none",
                }} />
                <span style={{ fontSize: 10, color: active ? C.yellow : done ? C.green + "cc" : C.dim }}>{lbl}</span>
              </div>
            ))}
            <div style={{ marginLeft: "auto", fontSize: 10, color: C.dim, fontFamily: "JetBrains Mono" }}>
              {Math.min(queueIdx + 1, queue.length)} / {queue.length || "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <div style={{
        width: 230, background: C.panel, borderLeft: `1px solid ${C.border}`,
        padding: "10px 10px 16px", overflowY: "auto",
        display: "flex", flexDirection: "column", flexShrink: 0,
      }}>
        <Divider label="Source" />
        <div style={{ fontFamily: "JetBrains Mono", fontSize: 10, color: C.green, marginBottom: 6 }}>
          {srcLabel || "…"}
        </div>
        <Btn onClick={async () => {
          try {
            const { path } = await browseFolder(srcFolder);
            if (!path) return;
            await initFromFolder(path, 0);
          } catch {
            // fallback if browse dialog unavailable
            const folder = window.prompt("Enter absolute path to source folder:");
            if (!folder) return;
            await initFromFolder(folder, 0);
          }
        }}>Change Folder</Btn>

        <Divider label="Queue" />
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 8 }}>
          <span style={{ fontSize: 22, fontWeight: 600, lineHeight: 1 }}>{Math.min(queueIdx + 1, queue.length || 1)}</span>
          <span style={{ fontSize: 12, color: C.dim }}>/ {queue.length || "—"}</span>
          <span style={{ fontSize: 10, color: C.dim, marginLeft: 4 }}>images</span>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: C.dim, marginBottom: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={comboMode} onChange={e => setComboMode(e.target.checked)} />
          Combo mode
        </label>

        <button onClick={doSave} style={{
          background: saved ? "#1a5c30" : "#0f2818",
          color: saved ? "#6ee79a" : C.green,
          border: `1px solid ${saved ? "#2a7a40" : "#1a4a2a"}`,
          borderRadius: 4, padding: "7px 8px", fontSize: 11, fontWeight: 600,
          cursor: "pointer", width: "100%", marginBottom: 4, textAlign: "left",
          fontFamily: "inherit", transition: "background 0.15s",
        }}>{saved ? "Saved!" : "Save + Next  [Enter]"}</button>

        <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
          <Btn onClick={doSkip} style={{ flex: 1, color: C.yellow, borderColor: "#2a2200" }}>Skip  [S]</Btn>
          <Btn onClick={removeSelected} style={{ flex: 1, color: C.red, borderColor: "#2a1515" }}>Remove</Btn>
        </div>

        <Divider label="Template" />
        <select value={template} onChange={e => onTemplateChange(e.target.value)} style={{
          background: C.panel2, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4,
          padding: "5px 6px", fontSize: 11, width: "100%", marginBottom: 4, fontFamily: "inherit",
        }}>
          {Object.keys(templates).map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        {templates[template]?.hint && (
          <div style={{ fontSize: 10, color: C.dim, marginBottom: 2, paddingLeft: 2 }}>
            {templates[template].hint}
          </div>
        )}
        {templates[template]?.ref_image && (
          <div style={{
            marginTop: 6, marginBottom: 2, borderRadius: 3, overflow: "hidden",
            border: `1px solid ${C.border}`, background: "#ffffff10"
          }}>
            <img
              src={templates[template].ref_image?.startsWith("data:") ? templates[template].ref_image : `/api/image?path=${encodeURIComponent(templates[template].ref_image || "")}`}
              alt="reference"
              style={{ width: "100%", display: "block", objectFit: "contain", maxHeight: 140 }}
              onError={e => { e.target.style.display = "none"; }}
            />
            <div style={{ fontSize: 9, color: C.dim, padding: "3px 6px", fontFamily: "JetBrains Mono" }}>
              reference
            </div>
          </div>
        )}

        <Divider label="Snap / Align" />
        <div style={{ display: "flex", gap: 3, marginBottom: 5 }}>
          {snapBtns.map(({ lbl, zone, col }) => (
            <button key={zone} onClick={() => snapTo(zone)} style={{
              flex: 1, background: C.panel2, color: col, border: `1px solid ${C.border}`,
              borderRadius: 4, padding: "5px 0", fontSize: 12, fontWeight: 700,
              cursor: "pointer", fontFamily: "inherit",
            }}>{lbl}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <Btn onClick={() => doAlign("h")} style={{ flex: 1, textAlign: "center", fontSize: 10 }}>H-Center</Btn>
          <Btn onClick={() => doAlign("v")} style={{ flex: 1, textAlign: "center", fontSize: 10 }}>V-Center</Btn>
        </div>

        <Divider label="Scale (selected)" />
        <input
          type="range" min={0.05} max={3.0} step={0.005}
          value={sel?.scale ?? 1.0}
          onChange={e => {
            if (scaleLocked || !selId) return;
            setItems(prev => prev.map(it => it.id === selId ? { ...it, scale: parseFloat(e.target.value) } : it));
          }}
          disabled={scaleLocked || !sel}
          style={{ width: "100%", marginBottom: 5 }}
        />
        <div style={{ display: "flex", gap: 3, marginBottom: 6 }}>
          {[["−5%", -0.05], ["−1%", -0.01], ["+1%", 0.01], ["+5%", 0.05]].map(([l, d]) => (
            <Btn key={l} onClick={() => nudgeScale(d)} style={{ flex: 1, textAlign: "center", fontSize: 9, padding: "3px 0" }}>{l}</Btn>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: C.dim, cursor: "pointer" }}>
            <input type="checkbox" checked={scaleLocked} onChange={e => setScaleLocked(e.target.checked)} style={{ accentColor: C.red }} />
            Lock scale
          </label>
          {sel && <span style={{ fontSize: 10, color: C.dim, fontFamily: "JetBrains Mono" }}>{sel.scale.toFixed(3)}</span>}
        </div>

        <Divider label="Canvas Items" />
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {items.map(item => (
            <button key={item.id} onClick={() => setSelId(item.id)} style={{
              background: item.id === selId ? "#161e38" : C.panel2,
              color: item.id === selId ? C.yellow : "#7a8aad",
              border: `1px solid ${item.id === selId ? "#22306a" : C.border}`,
              borderRadius: 4, padding: "5px 8px", fontSize: 10,
              cursor: "pointer", textAlign: "left", fontFamily: "JetBrains Mono",
            }}>
              {item.id === selId ? "▸ " : "   "}{item.label}
            </button>
          ))}
          {items.length === 0 && !loading && (
            <div style={{ fontSize: 10, color: C.dim, paddingLeft: 2 }}>No items on canvas</div>
          )}
        </div>

        <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 9, color: C.dim, lineHeight: 1.8, fontFamily: "JetBrains Mono", whiteSpace: "pre-wrap" }}>
            {status}
          </div>
        </div>
      </div>
    </div>
  );
}