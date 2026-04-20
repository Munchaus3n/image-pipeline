import { useState, useRef, useEffect, useCallback } from "react";
import {
  getConfig, getSource, getImages,
  imageUrl, saveComposition, skipImage,
  getSession, saveSession, clearSession,
  browseFolder,
} from "./api.js";

// ── Constants ─────────────────────────────────────────────────────────────────
// CANVAS_SIZE: logical composition size (matches pipeline output, e.g. 1440)
// DS: internal canvas pixel buffer — fixed at 720, never changes
// zoom: CSS scale applied to the canvas element for view zoom
let CANVAS_SIZE = 1440;  // mutable module var — kept for non-React drawing functions
const DS = 720;
const scaleFactor = () => DS / CANVAS_SIZE;

const BASE = "/api";

// Opens a folder in the native OS file explorer via the API server
const openFolder = (path = "") =>
  fetch(`${BASE}/open-folder?path=${encodeURIComponent(path)}`).catch(() => {});

const C = {
  bg:"var(--bg)", panel:"var(--panel)", panel2:"var(--panel2)",
  border:"var(--border)", text:"var(--text)", dim:"var(--dim)", dim2:"var(--dim2)",
  green:"var(--green)", blue:"var(--accent)", yellow:"var(--yellow)",
  red:"var(--red)", magenta:"var(--magenta)",
};

// Returns canvas-pixel-space bounds for an item.
// All hit testing and drawing uses these values (DS-space, not CANVAS_SIZE-space).
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

// Renders a template reference image with a proper error fallback
// — key={template} on the call site ensures full remount when template changes
function RefImage({ src }) {
  const [err, setErr] = useState(false);
  // Reset error state when src changes (new template selected)
  const prevSrc = useRef(null);
  if (prevSrc.current !== src) { prevSrc.current = src; if (err) setErr(false); }

  if (!src) return null;
  return (
    <div style={{
      borderRadius:4, overflow:"hidden", marginBottom:2,
      border:`1px solid ${C.border}`,
      background:"color-mix(in srgb,var(--accent) 4%,transparent)",
    }}>
      {err ? (
        <div style={{
          height:60, display:"flex", flexDirection:"column",
          alignItems:"center", justifyContent:"center", gap:4,
          color:C.dim, fontSize:9, fontFamily:"JetBrains Mono",
          background:"color-mix(in srgb,var(--border) 30%,transparent)",
        }}>
          <span style={{ fontSize:16, opacity:0.4 }}>🖼</span>
          <span>reference image not found</span>
        </div>
      ) : (
        <img
          src={src}
          alt="reference"
          style={{ width:"100%", display:"block", objectFit:"contain", maxHeight:110 }}
          onError={() => setErr(true)}
        />
      )}
      <div style={{ fontSize:9, color:C.dim, padding:"2px 6px", fontFamily:"JetBrains Mono" }}>reference</div>
    </div>
  );
}

function CollSection({ label, accent, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom:2 }}>
      <button
        className="ed-btn"
        onClick={() => setOpen(v => !v)}
        style={{
          width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
          background:"transparent", border:"none", padding:"5px 0", cursor:"pointer",
          fontFamily:"inherit",
        }}
      >
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <div style={{ width:3, height:10, borderRadius:2, background: accent || "var(--accent)", flexShrink:0 }}/>
          <span style={{ fontSize:9, fontWeight:700, letterSpacing:"0.1em", color:"var(--dim)", textTransform:"uppercase" }}>{label}</span>
        </div>
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          style={{ transition:"transform 0.18s", transform: open ? "rotate(180deg)" : "rotate(0deg)", color:"var(--dim)", flexShrink:0 }}
        >
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
      {open && (
        <div style={{ paddingBottom:6 }}>
          {children}
        </div>
      )}
    </div>
  );
}

function Divider({ label, color }) {
  return (
    <div style={{ margin:"12px 0 6px", display:"flex", alignItems:"center", gap:6 }}>
      <div style={{
        width:3, height:10, borderRadius:2,
        background: color || "var(--accent)",
        flexShrink:0,
      }}/>
      <span style={{ fontSize:9, fontWeight:700, letterSpacing:"0.1em", color:C.dim, textTransform:"uppercase" }}>
        {label}
      </span>
    </div>
  );
}

function Btn({ children, onClick, style={} }) {
  return (
    <button onClick={onClick} style={{
      background:C.panel2, color:C.dim, border:`1px solid ${C.border}`,
      borderRadius:5, padding:"5px 8px", fontSize:11, cursor:"pointer",
      width:"100%", textAlign:"left", fontFamily:"inherit",
      transition:"background 0.12s, color 0.12s",
      ...style,
    }}>{children}</button>
  );
}

export default function App({ onGoPipeline, outputDir = "", canvasSize: canvasSizeProp = null, thumbnail: thumbnailProp = true }) {
  const canvasRef    = useRef(null);
  const containerRef = useRef(null);
  const dragRef      = useRef(null);
  const undoRef      = useRef(null);
  const prefetchRef  = useRef(null); // holds pre-loaded next htmlImg + metadata

  const [guides,     setGuides]     = useState({});
  const [templates,  setTemplates]  = useState({});
  const [srcFolder,  setSrcFolder]  = useState("");
  const [srcLabel,   setSrcLabel]   = useState("…");
  const [queue,      setQueue]      = useState([]);
  const [queueIdx,   setQueueIdx]   = useState(0);
  const [items,      setItems]      = useState([]);
  const [selId,      setSelId]      = useState(null);
  const [template,   setTemplate]   = useState("— none —");
  const [scaleLocked,setScaleLocked]= useState(false);
  const [comboMode,  setComboMode]  = useState(false);
  const [status,     setStatus]     = useState("loading…");
  const [saved,      setSaved]      = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [guideOpacity, setGuideOpacity] = useState(1.0);  // loaded from settings
  const [canvasBgColor, setCanvasBgColor] = useState("#ffffff");
  const [canvasSizeState, setCanvasSizeState] = useState(1440); // editable canvas size
  const [activeSnapZone, setActiveSnapZone] = useState(null); // tracks last snapped guide zone

  // Phase 4: canvas view zoom (CSS scale, does not affect composition output)
  // 0.75 = 75% of DS (540px rendered), 1.0 = 720px, 1.25 = 900px, 1.5 = 1080px
  const [zoom, setZoom] = useState(1.0);

  const sel = items.find(it => it.id === selId) ?? null;

  // Focus the canvas container whenever a valid item is selected.
  // Using useEffect (not an inline call) because it runs after React commits
  // the DOM — calling focus() before the render completes has no effect.
  useEffect(() => {
    if (selId !== null) {
      containerRef.current?.focus({ preventScroll: true });
    }
  }, [selId]);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await getConfig();
        // Priority: prop passed by Pipeline > settings.json > config.ini
        let resolvedSize = canvasSizeProp ?? cfg.canvas_size;
        // Also read from settings.json which is what Settings tab writes to
        try {
          const sRes = await fetch(`${BASE}/settings`);
          if (sRes.ok) {
            const sData = await sRes.json();
            const settings = sData?.settings ?? {};
            const fromSettings = settings?.output?.canvas_size;
            if (!canvasSizeProp && fromSettings && fromSettings > 0) {
              resolvedSize = fromSettings;
            }
          }
        } catch { }
        CANVAS_SIZE = resolvedSize;
        setCanvasSizeState(resolvedSize);
        setGuides(cfg.guides);
        setTemplates(cfg.templates);

        // Load appearance/settings overrides
        try {
          const sRes = await fetch(`${BASE}/settings`);
          if (sRes.ok) {
            const sData = await sRes.json();
            const settings = sData?.settings ?? {};
            const opacity = settings?.appearance?.guide_opacity;
            if (typeof opacity === "number") setGuideOpacity(Math.max(0, Math.min(1, opacity)));
                        const bg = settings?.appearance?.canvas_bg_color;
            if (typeof bg === "string" && bg) setCanvasBgColor(bg);
            if (settings?.guides?.use_custom && settings?.guides?.custom) {
              const mergedGuides = { ...cfg.guides };
              for (const [zone, vals] of Object.entries(settings.guides.custom)) {
                if (!mergedGuides[zone]) continue;
                mergedGuides[zone] = { ...mergedGuides[zone], ...vals };
              }
              setGuides(mergedGuides);
            }
          }
        } catch { }

        const session = await getSession();
        if (session.exists) {
          if (session.queue_index >= session.total) {
            // Already completed — clear silently, don't prompt.
            await clearSession().catch(() => {});
          } else {
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
        }

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

  // Pre-load the next image in the queue during the API save round-trip.
  // By the time saveComposition + saveSession resolve (~200-400ms), the next
  // image's HTMLImageElement is already decoded and ready in prefetchRef.
  function prefetchNextImage(q, nextIdx) {
    if (nextIdx >= q.length) { prefetchRef.current = null; return; }
    const path = q[nextIdx];
    const url  = imageUrl(path);
    const htmlImg = new window.Image();
    // Store a promise so advance() can await it if needed
    prefetchRef.current = new Promise((resolve) => {
      htmlImg.onload = () => {
        const activeZone = templates[template]?.zone || "green";
        const g = guides[activeZone] ?? guides["green"] ?? { top:224, bottom:1216 };
        resolve({
          path, url, htmlImg,
          width:  htmlImg.naturalWidth,
          height: htmlImg.naturalHeight,
          g,
        });
      };
      htmlImg.onerror = () => resolve(null);
      htmlImg.src = url;
    });
  }

  async function loadImage(q, idx, isCombo, guidesOverride) {
    if (idx >= q.length) { allDone(); return; }

    // Use the pre-fetched result if it's for this exact index
    let prefetched = null;
    if (prefetchRef.current) {
      prefetched = await prefetchRef.current;
      prefetchRef.current = null;
      // Discard if it's for a different image (combo mode re-use, etc.)
      if (prefetched && prefetched.path !== q[idx]) prefetched = null;
    }

    let htmlImg, width, height;
    if (prefetched) {
      // Already decoded — zero wait
      ({ htmlImg, width, height } = prefetched);
    } else {
      const path = q[idx];
      const url  = imageUrl(path);
      ({ width, height } = await loadImageSize(url));
      htmlImg = new window.Image();
      await new Promise(r => { htmlImg.onload = r; htmlImg.onerror = r; htmlImg.src = url; });
    }

    const path = q[idx];
    // Use active template zone for initial placement if one is set.
    // Falls back to green guide, then hardcoded default.
    const activeZone = templates[template]?.zone || "green";
    const guideSrc   = guidesOverride ?? guides;
    const g          = guideSrc[activeZone] ?? guideSrc["green"] ?? { top:224, bottom:1216, left:224, right:1216 };
    const initScale  = (g.bottom - g.top) / height;

    const newItem = {
      id:       Date.now(),
      label:    path.split(/[\\/]/).pop(),
      filePath: path,
      canvasX:  CANVAS_SIZE / 2,
      canvasY:  Math.round((g.top + g.bottom) / 2),
      scale:    initScale,
      origW:    width,
      origH:    height,
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

  // ── Canvas draw ───────────────────────────────────────────────────────────
  // Draws into the 720×720 pixel buffer. CSS zoom scales the element visually.
  // Draw order: background → items → selection UI → guides (always on top)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || Object.keys(guides).length === 0) return;
    const ctx = canvas.getContext("2d");
    const S   = scaleFactor();
    ctx.clearRect(0, 0, DS, DS);
    ctx.fillStyle = canvasBgColor;
    ctx.fillRect(0, 0, DS, DS);

    // ── 1. Draw product images ──────────────────────────────────────────────
    ctx.setLineDash([]);
    for (const item of items) {
      const { x, y, w, h } = itemBounds(item);
      if (item.htmlImg?.complete) {
        ctx.drawImage(item.htmlImg, x, y, w, h);
      } else {
        ctx.fillStyle = "#3b82f644";
        ctx.fillRect(x, y, w, h);
      }
    }

    // ── 2. Selection highlight ──────────────────────────────────────────────
    if (sel) {
      const { x, y, w, h } = itemBounds(sel);
      ctx.strokeStyle = "rgba(250,204,21,0.85)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(x-2, y-2, w+4, h+4);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(250,204,21,0.9)";
      [[x-2,y-2],[x+w+2,y-2],[x-2,y+h+2],[x+w+2,y+h+2]].forEach(([hx,hy]) => {
        ctx.fillRect(hx-3, hy-3, 6, 6);
      });
    }

    // ── 3. All guides — dashed lines ──────────────────────────────────────
    const opHex = Math.round(guideOpacity * 255).toString(16).padStart(2, "0");
    for (const g of Object.values(guides)) {
      const t=g.top*S, b=g.bottom*S, l=g.left*S, r=g.right*S;
      ctx.strokeStyle = g.color + opHex;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0,t); ctx.lineTo(DS,t);
      ctx.moveTo(0,b); ctx.lineTo(DS,b);
      ctx.moveTo(l,0); ctx.lineTo(l,DS);
      ctx.moveTo(r,0); ctx.lineTo(r,DS);
      ctx.stroke();
    }

    // ── 4. Active snap zone — solid colored border ────────────────────────
    const snapZone = activeSnapZone && guides[activeSnapZone] ? activeSnapZone
      : (templates[template]?.zone && guides[templates[template].zone]) ? templates[template].zone
      : null;
    if (snapZone) {
      const g = guides[snapZone];
      const t=g.top*S, b=g.bottom*S, l=g.left*S, r=g.right*S;
      ctx.setLineDash([]);
      ctx.fillStyle = g.color + "14";
      ctx.fillRect(l, t, r-l, b-t);
      ctx.strokeStyle = g.color + "ee";
      ctx.lineWidth = 2.5;
      ctx.strokeRect(l, t, r-l, b-t);
      // corner accent marks
      const cs = 10;
      ctx.lineWidth = 3;
      ctx.strokeStyle = g.color;
      [[l,t,1,1],[r,t,-1,1],[l,b,1,-1],[r,b,-1,-1]].forEach(([cx,cy,dx,dy]) => {
        ctx.beginPath();
        ctx.moveTo(cx+dx*cs, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy+dy*cs);
        ctx.stroke();
      });
    }

    ctx.setLineDash([]);
  }, [items, selId, template, scaleLocked, guides, templates, guideOpacity, canvasBgColor, activeSnapZone]);

  // ── Wheel zoom (product scale) ────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e) => {
      e.preventDefault();
      if (scaleLocked || !selId) return;
      const f = e.deltaY < 0 ? 1.04 : 0.96;
      setItems(prev => prev.map(it =>
        it.id===selId ? {...it, scale: Math.max(0.02, Math.min(4.0, it.scale*f))} : it
      ));
    };
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, [scaleLocked, selId]);

  // ── Mouse helpers ─────────────────────────────────────────────────────────
  // Converts CSS-space mouse coordinates to canvas pixel space.
  // Required because the canvas element is CSS-scaled by `zoom`, but its
  // internal pixel buffer is always DS×DS. getBoundingClientRect returns
  // CSS dimensions, so we divide by the actual render ratio.
  const toCanvasCoords = (clientX, clientY) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const rx = canvasRef.current.width  / rect.width;   // = 1/zoom
    const ry = canvasRef.current.height / rect.height;
    return {
      mx: (clientX - rect.left) * rx,
      my: (clientY - rect.top)  * ry,
    };
  };

  const onMouseDown = useCallback((e) => {
    const { mx, my } = toCanvasCoords(e.clientX, e.clientY);
    for (let i = items.length-1; i >= 0; i--) {
      const it = items[i];
      const { x,y,w,h } = itemBounds(it);
      if (mx>=x && mx<=x+w && my>=y && my<=y+h) {
        undoRef.current = { id:it.id, canvasX:it.canvasX, canvasY:it.canvasY, scale:it.scale };
        setSelId(it.id);
        dragRef.current = {
          itemId: it.id,
          ox: mx - it.canvasX * scaleFactor(),
          oy: my - it.canvasY * scaleFactor(),
        };
        containerRef.current?.focus();
        return;
      }
    }
    setSelId(null);
    dragRef.current = null;
  }, [items]);

  const onMouseMove = useCallback((e) => {
    if (!dragRef.current) return;
    const { mx, my } = toCanvasCoords(e.clientX, e.clientY);
    const S = scaleFactor();
    const { itemId, ox, oy } = dragRef.current;
    setItems(prev => prev.map(it =>
      it.id===itemId ? {...it, canvasX:Math.round((mx-ox)/S), canvasY:Math.round((my-oy)/S)} : it
    ));
  }, []);

  const onMouseUp = useCallback(() => { dragRef.current = null; }, []);

  const onKeyDown = useCallback((e) => {
    const n = e.shiftKey ? 10 : 1;
    const map = { ArrowLeft:[-n,0], ArrowRight:[n,0], ArrowUp:[0,-n], ArrowDown:[0,n] };
    if (map[e.key]) {
      e.preventDefault();
      if (!selId) return;
      const [dx,dy] = map[e.key];
      setItems(prev => prev.map(it => it.id===selId ? {...it,canvasX:it.canvasX+dx,canvasY:it.canvasY+dy} : it));
      return;
    }
    if (e.key==="Enter") doSave();
    if (e.key==="s"||e.key==="S") doSkip();
    if ((e.ctrlKey||e.metaKey) && e.key==="z") doUndo();
  }, [selId, items, queue, queueIdx, srcFolder, template, comboMode]);

  function doUndo() {
    if (!undoRef.current) return;
    const { id,canvasX,canvasY,scale } = undoRef.current;
    setItems(prev => prev.map(it => it.id===id ? {...it,canvasX,canvasY,scale} : it));
    undoRef.current = null;
    setStatus("undone.");
  }

  async function doSave() {
    if (!items.length) return;
    try {
      // Start pre-loading next image NOW — runs in parallel with the API calls below.
      // By the time saveComposition + saveSession resolve, next image is decoded.
      prefetchNextImage(queue, queueIdx + 1);

      const payload = items.map(it => ({
        image_path: it.filePath,
        canvas_x:   it.canvasX,
        canvas_y:   it.canvasY,
        scale:      it.scale,
      }));
      const result = await saveComposition(
        payload, srcFolder, queueIdx, comboMode,
        thumbnailProp,
        canvasSizeProp,
      );
      setSaved(true);
      setStatus(`saved: ${result.saved.split(/[\\/]/).pop()}`);
      setTimeout(() => setSaved(false), 1600);
      await saveSession({ src_root: srcFolder, queue_index: queueIdx + 1, template });
      advance();
    } catch (e) {
      prefetchRef.current = null; // clear stale prefetch on error
      setStatus(`save failed: ${e.message}`);
    }
  }

  async function doSkip() {
    prefetchNextImage(queue, queueIdx + 1);
    if (queueIdx < queue.length) {
      try { await skipImage(queue[queueIdx]); } catch (_) {}
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

  async function allDone() {
    setItems([]); setSelId(null);
    setStatus("all images processed.\noutput → output/final/");
    await clearSession().catch(() => {});
  }

  function removeSelected() {
    if (!selId) return;
    setItems(prev => prev.filter(it => it.id!==selId));
    setSelId(null);
  }

  function updateCanvasSize(newSize) {
    const s = Math.max(256, Math.min(8192, parseInt(newSize, 10) || CANVAS_SIZE));
    CANVAS_SIZE = s;
    setCanvasSizeState(s);
  }

  function snapTo(zone) {
    if (!sel) { setStatus("select an item first."); return; }
    const g = guides[zone];
    if (!g) return;
    undoRef.current = { id:sel.id, canvasX:sel.canvasX, canvasY:sel.canvasY, scale:sel.scale };
    setItems(prev => prev.map(it =>
      it.id===selId ? {
        ...it,
        scale:   (g.bottom - g.top) / it.origH,
        canvasX: CANVAS_SIZE / 2,
        canvasY: Math.round((g.top + g.bottom) / 2),
      } : it
    ));
    setActiveSnapZone(zone);
  }

  function snapToFull() {
    if (!sel) { setStatus("select an item first."); return; }
    undoRef.current = { id:sel.id, canvasX:sel.canvasX, canvasY:sel.canvasY, scale:sel.scale };
    // Contain: scale so the image fits entirely within canvas borders
    const snapScale = Math.min(CANVAS_SIZE / sel.origW, CANVAS_SIZE / sel.origH);
    setItems(prev => prev.map(it =>
      it.id===selId ? {
        ...it,
        scale:   snapScale,
        canvasX: CANVAS_SIZE / 2,
        canvasY: CANVAS_SIZE / 2,
      } : it
    ));
    setActiveSnapZone(null);
  }

  function doAlign(axis) {
    if (!selId) return;
    undoRef.current = sel ? { id:sel.id, canvasX:sel.canvasX, canvasY:sel.canvasY, scale:sel.scale } : null;
    setItems(prev => prev.map(it =>
      it.id===selId
        ? axis==="h" ? {...it,canvasX:CANVAS_SIZE/2} : {...it,canvasY:CANVAS_SIZE/2}
        : it
    ));
  }

  function onTemplateChange(name) {
    setTemplate(name);
    if (!name || name === "— none —") { setActiveSnapZone(null); return; }
    const tmpl = templates[name];
    if (tmpl?.zone && sel) snapTo(tmpl.zone);
    else if (tmpl?.zone) setActiveSnapZone(tmpl.zone);
  }

  function nudgeScale(d) {
    if (scaleLocked||!sel) return;
    undoRef.current = { id:sel.id, canvasX:sel.canvasX, canvasY:sel.canvasY, scale:sel.scale };
    setItems(prev => prev.map(it =>
      it.id===selId ? {...it, scale:Math.max(0.02,Math.min(4.0,it.scale+d))} : it
    ));
  }

  const snapBtns = [
    { lbl:"G", zone:"green",   col:C.green   },
    { lbl:"B", zone:"blue",    col:C.blue    },
    { lbl:"M", zone:"magenta", col:C.magenta },
    { lbl:"R", zone:"red",     col:C.red     },
  ];

  // Phase 4: zoom presets
  const zoomPresets = [
    { label:"75%",  value:0.75 },
    { label:"100%", value:1.0  },
    { label:"125%", value:1.25 },
    { label:"150%", value:1.5  },
  ];

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      style={{
        display:"flex", background:C.bg, height:"100%", minHeight:0,
        fontFamily:"'Outfit','DM Sans',system-ui,sans-serif",
        color:C.text, outline:"none", userSelect:"none", fontSize:13,
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:var(--scrollbar);border-radius:2px}
        .ed-btn:hover{filter:brightness(1.1)} .ed-btn:active{transform:scale(0.97)}
        .coll-section{}
        select,input{outline:none} input[type=range]{accent-color:var(--green)}
        input[type=checkbox]{accent-color:var(--accent)}
        [data-theme="dark"] select option{background:hsl(222,20%,16%);color:hsl(210,40%,95%)}
        [data-theme="light"] select option{background:hsl(220,14%,94%);color:hsl(224,20%,15%)}
      `}</style>

      {/* ── Canvas area — fills all space left of sidebar ──────────── */}
      <div style={{
        flex:1, display:"flex", flexDirection:"column", minWidth:0, minHeight:0, background:C.bg,
      }}>
        {/* Canvas scroll/center area */}
        <div style={{
          flex:1, display:"flex", alignItems:"center", justifyContent:"center",
          overflow:"auto", padding:16, minHeight:0,
        }}>
          <div style={{
            width: DS * zoom, height: DS * zoom,
            overflow:"hidden", flexShrink:0,
            border:`1px solid ${C.border}`, borderRadius:3,
            boxShadow:`0 0 0 1px color-mix(in srgb,var(--border) 60%,transparent), 0 12px 32px rgba(0,0,0,0.25)`,
          }}>
            <canvas
              ref={canvasRef} width={DS} height={DS}
              onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
              style={{ cursor:"crosshair", display:"block", width:DS*zoom, height:DS*zoom, transformOrigin:"top left" }}
            />
          </div>
        </div>

        {/* ── Footer bar: hints + pipeline breadcrumb + zoom ── */}
        <div style={{
          height:30, borderTop:`1px solid ${C.border}`, background:C.panel,
          display:"flex", alignItems:"center", padding:"0 12px", gap:16, flexShrink:0,
        }}>
          {/* Hints */}
          <div style={{ display:"flex", gap:10, fontSize:9, color:C.dim, fontFamily:"JetBrains Mono" }}>
            {["Drag=Move","Scroll=Resize","Arrows=Nudge","Ctrl+Z=Undo"].map(h => (
              <span key={h}>{h}</span>
            ))}
          </div>

          {/* Pipeline breadcrumb */}
          <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:4 }}>
            {[
              { lbl:"Upscale", done:true },
              { lbl:"RemBG",   done:true },
              { lbl:"Editor",  done:false, active:true },
            ].map(({ lbl, done, active }, i) => (
              <div key={lbl} style={{ display:"flex", alignItems:"center", gap:4 }}>
                {i > 0 && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity:0.3 }}>
                    <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                )}
                <div style={{
                  display:"flex", alignItems:"center", gap:3,
                  padding:"2px 7px", borderRadius:3,
                  background: active ? "color-mix(in srgb,var(--accent) 12%,transparent)"
                    : done ? "color-mix(in srgb,var(--green) 10%,transparent)" : "transparent",
                  border: `1px solid ${active ? "color-mix(in srgb,var(--accent) 35%,transparent)"
                    : done ? "color-mix(in srgb,var(--green) 25%,transparent)" : "transparent"}`,
                }}>
                  <div style={{
                    width:4, height:4, borderRadius:"50%", flexShrink:0,
                    background: done ? "var(--green)" : active ? "var(--accent)" : C.dim,
                  }}/>
                  <span style={{
                    fontSize:9, fontWeight: active ? 600 : 400,
                    color: active ? "var(--accent)" : done ? "var(--green)" : C.dim,
                  }}>{lbl}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Zoom */}
          <div style={{ display:"flex", alignItems:"center", gap:2, borderLeft:`1px solid ${C.border}`, paddingLeft:10 }}>
            {zoomPresets.map(({ label, value }) => (
              <button key={label} className="ed-btn" onClick={() => setZoom(value)} style={{
                padding:"2px 6px", fontSize:9, cursor:"pointer", fontFamily:"inherit", borderRadius:3,
                border:`1px solid ${zoom===value ? "var(--accent)" : "transparent"}`,
                background: zoom===value ? "color-mix(in srgb,var(--accent) 12%,transparent)" : "transparent",
                color: zoom===value ? "var(--accent)" : C.dim,
                fontWeight: zoom===value ? 700 : 400,
              }}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Sidebar ───────────────────────────────────────────────── */}
      <div style={{
        width:262, background:C.panel, borderLeft:`1px solid ${C.border}`,
        display:"flex", flexDirection:"column", flexShrink:0, minHeight:0,
      }}>
        {/* Sidebar header: queue + back */}
        <div style={{
          padding:"0 10px", height:36, borderBottom:`1px solid ${C.border}`,
          display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0,
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <button className="ed-btn" onClick={onGoPipeline} style={{
              background:"transparent", color:C.dim, border:`1px solid ${C.border}`,
              borderRadius:4, padding:"2px 8px", fontSize:10, cursor:"pointer", fontFamily:"inherit",
            }}>← Back</button>
            <span style={{ fontSize:11, fontWeight:600, color:C.text }}>
              {Math.min(queueIdx+1, queue.length||1)}
            </span>
            <span style={{ fontSize:10, color:C.dim }}>/ {queue.length||"—"}</span>
          </div>
          <div style={{
            fontSize:9, color:"var(--green)", fontFamily:"JetBrains Mono",
            maxWidth:120, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
            direction:"rtl", textAlign:"left",
          }}>
            {srcLabel || "…"}
          </div>
        </div>

        {/* Scrollable content */}
        <div style={{ flex:1, overflowY:"auto", padding:"8px 10px 12px" }}>

          {/* ── Source ── */}
          <Divider label="Source" color="var(--green)" />
          <Btn className="ed-btn" onClick={async () => {
            try {
              const { path } = await browseFolder(srcFolder);
              if (!path) return;
              await initFromFolder(path, 0);
            } catch {
              setStatus("folder picker unavailable\ncheck that api.py is running");
            }
          }} style={{ fontSize:10, color:C.dim, textAlign:"center", marginBottom:2 }}>
            📂 Change Source Folder
          </Btn>
          <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:10, color:C.dim, cursor:"pointer", marginBottom:2 }}>
            <input type="checkbox" checked={comboMode} onChange={e=>setComboMode(e.target.checked)} />
            Combo mode
          </label>

          {/* ── Actions ── */}
          <Divider label="Queue" color="var(--accent)" />
          <button className="ed-btn" onClick={doSave} style={{
            width:"100%", padding:"7px 10px", marginBottom:4,
            background: saved ? "var(--green)" : "var(--green-bg)",
            color: saved ? "#fff" : "var(--green)",
            border:`1px solid ${saved ? "var(--green)" : "var(--green-bdr)"}`,
            borderRadius:6, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit",
            transition:"all 0.15s",
            display:"flex", alignItems:"center", justifyContent:"space-between",
          }}>
            <span>{saved ? "✓ Saved!" : "Save & Next"}</span>
            <kbd style={{
              fontSize:9, fontFamily:"JetBrains Mono",
              background: saved ? "rgba(255,255,255,0.2)" : "color-mix(in srgb,var(--green) 20%,transparent)",
              border:`1px solid ${saved ? "rgba(255,255,255,0.3)" : "var(--green-bdr)"}`,
              borderRadius:3, padding:"1px 5px", color:"inherit",
            }}>↵</kbd>
          </button>
          <div style={{ display:"flex", gap:4, marginBottom:4 }}>
            <button className="ed-btn" onClick={doSkip} style={{
              flex:1, padding:"5px 0", background:"var(--yellow-bg)",
              color:"var(--yellow)", border:`1px solid var(--yellow-bdr)`,
              borderRadius:5, fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit",
              display:"flex", alignItems:"center", justifyContent:"center", gap:3,
            }}>
              Skip <kbd style={{ fontSize:8, fontFamily:"JetBrains Mono", background:"color-mix(in srgb,var(--yellow) 15%,transparent)", border:`1px solid var(--yellow-bdr)`, borderRadius:3, padding:"0 4px" }}>S</kbd>
            </button>
            <button className="ed-btn" onClick={removeSelected} style={{
              flex:1, padding:"5px 0", background:"var(--red-bg)",
              color:"var(--red)", border:`1px solid var(--red-bdr)`,
              borderRadius:5, fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit",
              display:"flex", alignItems:"center", justifyContent:"center", gap:3,
            }}>
              Remove <kbd style={{ fontSize:8, fontFamily:"JetBrains Mono", background:"color-mix(in srgb,var(--red) 15%,transparent)", border:`1px solid var(--red-bdr)`, borderRadius:3, padding:"0 4px" }}>Del</kbd>
            </button>
          </div>

          {/* ── Template ── */}
          <Divider label="Template" color="var(--accent)" />
          <select value={template} onChange={e => onTemplateChange(e.target.value)} style={{
            background:C.panel2, color:C.text, border:`1px solid ${C.border}`, borderRadius:5,
            padding:"5px 7px", fontSize:11, width:"100%", marginBottom:3,
            fontFamily:"inherit", colorScheme:"dark light",
          }}>
            {/* Filter out "— none —" from the map since we pin it first */}
            <option value="— none —" style={{ background:"var(--panel2)", color:"var(--text)" }}>— none —</option>
            {Object.keys(templates).filter(k => k !== "— none —").map(k => (
              <option key={k} value={k} style={{ background:"var(--panel2)", color:"var(--text)" }}>{k}</option>
            ))}
          </select>
          {templates[template]?.hint && (
            <div style={{ fontSize:10, color:C.dim, marginBottom:3, paddingLeft:2, lineHeight:1.4 }}>
              {templates[template].hint}
            </div>
          )}
          {templates[template]?.ref_image && (
            <RefImage
              key={template}
              src={(() => {
                const ri = templates[template].ref_image;
                if (!ri) return null;
                if (ri.startsWith("data:")) return ri;
                if (ri.includes("/") || ri.includes("\\")) return `/api/image?path=${encodeURIComponent(ri)}`;
                return `/api/templates/image?name=${encodeURIComponent(ri)}`;
              })()}
            />
          )}

          {/* ── Snap & Align (collapsible) ── */}
          <CollSection label="Snap & Align" accent="color-mix(in srgb,var(--accent) 70%,var(--green))" defaultOpen>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:3, marginBottom:5 }}>
              {snapBtns.map(({ lbl, zone, col }) => (
                <button key={zone} className="ed-btn" onClick={() => { snapTo(zone); }} style={{
                  background: activeSnapZone===zone ? `color-mix(in srgb, ${col} 25%, transparent)` : `color-mix(in srgb, ${col} 10%, transparent)`,
                  color:col, border:`1px solid color-mix(in srgb, ${col} ${activeSnapZone===zone ? 60 : 30}%, transparent)`,
                  borderRadius:5, padding:"6px 0", fontSize:12, fontWeight:800,
                  cursor:"pointer", fontFamily:"inherit", textAlign:"center",
                  boxShadow: activeSnapZone===zone ? `0 0 8px color-mix(in srgb, ${col} 30%, transparent)` : "none",
                  transition:"all 0.15s",
                }}>{lbl}</button>
              ))}
            </div>
            <div style={{ display:"flex", gap:3 }}>
              {/* Fit */}
              <button className="ed-btn" onClick={snapToFull} style={{
                flex:2, background:C.panel2, color:C.dim, border:`1px solid ${C.border}`,
                borderRadius:5, padding:"5px 0", fontSize:10, cursor:"pointer", fontFamily:"inherit",
                display:"flex", alignItems:"center", justifyContent:"center", gap:4,
              }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
                  <path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
                </svg>
                Fit
              </button>
              {/* H Center */}
              <button className="ed-btn" onClick={()=>doAlign("h")} style={{
                flex:1, background:C.panel2, color:C.dim, border:`1px solid ${C.border}`,
                borderRadius:5, padding:"5px 0", fontSize:10, cursor:"pointer", fontFamily:"inherit",
                display:"flex", alignItems:"center", justifyContent:"center", gap:3,
              }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 12h20"/><path d="M10 16v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4"/>
                  <path d="M10 8V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v4"/>
                  <path d="M20 16v1a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-1"/><path d="M14 8V7c0-1.1.9-2 2-2h2a2 2 0 0 1 2 2v1"/>
                </svg>
                H
              </button>
              {/* V Center */}
              <button className="ed-btn" onClick={()=>doAlign("v")} style={{
                flex:1, background:C.panel2, color:C.dim, border:`1px solid ${C.border}`,
                borderRadius:5, padding:"5px 0", fontSize:10, cursor:"pointer", fontFamily:"inherit",
                display:"flex", alignItems:"center", justifyContent:"center", gap:3,
              }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v20"/><path d="M8 10H4a2 2 0 0 1-2-2V6c0-1.1.9-2 2-2h4"/>
                  <path d="M16 10h4a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-4"/>
                  <path d="M8 20H7a2 2 0 0 1-2-2v-2c0-1.1.9-2 2-2h1"/><path d="M16 14h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1"/>
                </svg>
                V
              </button>
            </div>
          </CollSection>

          {/* ── Scale ── */}
          <Divider label="Scale" color="var(--yellow)" />
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:4 }}>
            <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:10, color:C.dim, cursor:"pointer" }}>
              <input type="checkbox" checked={scaleLocked} onChange={e=>setScaleLocked(e.target.checked)} style={{ accentColor:"var(--red)" }} />
              Lock
            </label>
            {sel && (
              <span style={{
                fontSize:10, fontFamily:"JetBrains Mono", color:C.text,
                background:C.panel2, border:`1px solid ${C.border}`, borderRadius:4, padding:"1px 6px",
              }}>{sel.scale.toFixed(3)}</span>
            )}
          </div>
          <input type="range" min={0.05} max={3.0} step={0.005}
            value={sel?.scale ?? 1.0}
            onChange={e => { if (scaleLocked||!selId) return; setItems(prev => prev.map(it => it.id===selId ? {...it,scale:parseFloat(e.target.value)} : it)); }}
            disabled={scaleLocked||!sel}
            style={{ width:"100%", marginBottom:4 }}
          />
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:3, marginBottom:2 }}>
            {[["−5%",-0.05],["−1%",-0.01],["+1%",0.01],["+5%",0.05]].map(([l,d]) => (
              <button key={l} className="ed-btn" onClick={()=>nudgeScale(d)} style={{
                background:C.panel2, color:C.dim, border:`1px solid ${C.border}`,
                borderRadius:4, padding:"4px 0", fontSize:10, cursor:"pointer", fontFamily:"inherit", textAlign:"center",
              }}>{l}</button>
            ))}
          </div>

          {/* ── Canvas Settings (collapsible) ── */}
          <CollSection label="Canvas" accent="var(--magenta)" defaultOpen={false}>
            <div style={{ marginBottom:6 }}>
              <div style={{ fontSize:9, color:C.dim, marginBottom:3 }}>Size (px) — square canvas</div>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <input type="number" value={canvasSizeState}
                  onChange={e => updateCanvasSize(e.target.value)}
                  min={256} max={8192}
                  style={{ flex:1, background:C.panel2, color:C.text, border:`1px solid ${C.border}`, borderRadius:4, padding:"4px 6px", fontSize:11, fontFamily:"JetBrains Mono", textAlign:"center" }}
                />
                <span style={{ fontSize:10, color:C.dim, flexShrink:0 }}>× {canvasSizeState}</span>
              </div>
              <div style={{ fontSize:9, color:C.dim, marginTop:3, opacity:0.7 }}>
                Changes apply to next image load. Use Settings tab to persist.
              </div>
            </div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <span style={{ fontSize:10, color:C.dim }}>Background</span>
              <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                <input type="color" value={canvasBgColor} onChange={e=>setCanvasBgColor(e.target.value)}
                  style={{ width:24, height:24, border:`1px solid ${C.border}`, borderRadius:4, cursor:"pointer", padding:1 }} />
                <input type="text" value={canvasBgColor}
                  onChange={e => { const v=e.target.value; if(/^#[0-9a-fA-F]{0,6}$/.test(v)) setCanvasBgColor(v); }}
                  maxLength={7}
                  style={{ width:64, background:C.panel2, color:C.text, border:`1px solid ${C.border}`, borderRadius:4, padding:"3px 5px", fontSize:10, fontFamily:"JetBrains Mono", textAlign:"center" }}
                />
              </div>
            </div>
          </CollSection>

          {/* ── Canvas Items ── */}
          {items.length > 0 && (
            <>
              <Divider label="Items" color="var(--accent)" />
              <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
                {items.map(item => (
                  <button key={item.id} className="ed-btn" onClick={() => setSelId(item.id)} style={{
                    background: item.id===selId ? "color-mix(in srgb,var(--accent) 12%,var(--panel2))" : C.panel2,
                    color: item.id===selId ? C.text : C.dim,
                    border:`1px solid ${item.id===selId ? "var(--accent)" : C.border}`,
                    borderLeft: `3px solid ${item.id===selId ? "var(--accent)" : "transparent"}`,
                    borderRadius:5, padding:"4px 8px", fontSize:10,
                    cursor:"pointer", textAlign:"left", fontFamily:"JetBrains Mono",
                  }}>
                    {item.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ── Output ── */}
          <Divider label="Output" color="var(--green)" />
          <Btn className="ed-btn" onClick={() => openFolder()} style={{ color:"var(--green)", borderColor:"var(--green-bdr)", textAlign:"center", fontSize:10 }}>
            📁 Open Output Folder
          </Btn>

          {/* Status */}
          {status && status !== "loading…" && (
            <div style={{ marginTop:8, padding:"6px 8px", borderRadius:5, background:C.panel2, border:`1px solid ${C.border}` }}>
              <div style={{ fontSize:9, color:C.dim, lineHeight:1.8, fontFamily:"JetBrains Mono", whiteSpace:"pre-wrap" }}>
                {status}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}