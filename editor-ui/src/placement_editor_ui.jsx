import { useState, useRef, useEffect, useCallback } from "react";

const CS = 1440;
const DS = 720;
const S  = DS / CS;

const GUIDES = {
  red:     { top:140,  bottom:1300, left:140,  right:1300, color:"#f87171" },
  green:   { top:224,  bottom:1216, left:224,  right:1216, color:"#4ade80" },
  blue:    { top:284,  bottom:1156, left:284,  right:1156, color:"#60a5fa" },
  magenta: { top:434,  bottom:1006, left:434,  right:1006, color:"#e879f9" },
};

const TEMPLATES = {
  "— none —":           { zone: null,      hint: "" },
  "Machine":            { zone: "green",   hint: "Top + bottom touch green lines" },
  "Bottle 1–1.5L":      { zone: "green",   hint: "Top + bottom touch green lines" },
  "Bottle 0.5L":        { zone: "blue",    hint: "Top + bottom touch blue lines"  },
  "Coffee bag large":   { zone: "blue",    hint: "Fill blue zone"                 },
  "Coffee bag small":   { zone: "blue",    hint: "Fill blue zone"                 },
  "Box large":          { zone: "green",   hint: "Fill green zone"                },
  "Box small":          { zone: "magenta", hint: "Fill magenta zone"              },
  "Capsules / small":   { zone: "magenta", hint: "Fill magenta zone"              },
  "Combo / multipack":  { zone: "green",   hint: "Group fills green zone"         },
};

const C = {
  bg:      "#0b0d14",
  panel:   "#0f1219",
  panel2:  "#161926",
  border:  "#1d2235",
  text:    "#d8e0f0",
  dim:     "#454f6b",
  dim2:    "#262d44",
  green:   "#4ade80",
  blue:    "#60a5fa",
  yellow:  "#facc15",
  red:     "#f87171",
  magenta: "#e879f9",
  save_bg: "#0f2818",
  save_border: "#1a4a2a",
};

let _uid = 1;
const INIT_ITEMS = [
  { id: _uid++, label:"product_001.png", canvasX:720, canvasY:700, scale:0.45, origW:500, origH:720, color:"#3b82f6" },
];

function itemBounds(item) {
  const w = item.origW * item.scale * S;
  const h = item.origH * item.scale * S;
  return { x: item.canvasX*S - w/2, y: item.canvasY*S - h/2, w, h };
}

function Divider({ label }) {
  return (
    <div style={{ margin:"14px 0 6px", borderTop:`1px solid ${C.border}`, paddingTop:8 }}>
      <span style={{ fontSize:9, fontWeight:600, letterSpacing:"0.12em", color:C.dim, textTransform:"uppercase" }}>{label}</span>
    </div>
  );
}

function Btn({ children, onClick, style={} }) {
  return (
    <button onClick={onClick} style={{
      background: C.panel2, color: C.text,
      border: `1px solid ${C.border}`, borderRadius:4,
      padding:"5px 8px", fontSize:11, cursor:"pointer",
      width:"100%", textAlign:"left", fontFamily:"inherit",
      ...style
    }}>{children}</button>
  );
}

export default function PlacementEditor() {
  const canvasRef    = useRef(null);
  const containerRef = useRef(null);
  const dragRef      = useRef(null);
  const undoRef      = useRef(null);

  const [items,      setItems]      = useState(INIT_ITEMS);
  const [selId,      setSelId]      = useState(INIT_ITEMS[0].id);
  const [template,   setTemplate]   = useState("— none —");
  const [scaleLocked,setScaleLocked]= useState(false);
  const [comboMode,  setComboMode]  = useState(false);
  const [status,     setStatus]     = useState("drag=move  scroll=resize  arrows=nudge  ctrl+z=undo");
  const [saved,      setSaved]      = useState(false);
  const [queueIdx]                  = useState(0);
  const [queueTotal]                = useState(12);

  const sel = items.find(it => it.id === selId) ?? null;

  // ── Draw ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, DS, DS);

    // White canvas bg
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, DS, DS);

    // All guides (dashed)
    for (const g of Object.values(GUIDES)) {
      const t=g.top*S, b=g.bottom*S, l=g.left*S, r=g.right*S;
      ctx.strokeStyle = g.color + "55";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(0,t); ctx.lineTo(DS,t);
      ctx.moveTo(0,b); ctx.lineTo(DS,b);
      ctx.moveTo(l,0); ctx.lineTo(l,DS);
      ctx.moveTo(r,0); ctx.lineTo(r,DS);
      ctx.stroke();
    }

    // Active zone fill + solid border
    const tmpl = TEMPLATES[template];
    if (tmpl?.zone) {
      const g = GUIDES[tmpl.zone];
      const t=g.top*S, b=g.bottom*S, l=g.left*S, r=g.right*S;
      ctx.setLineDash([]);
      ctx.strokeStyle = g.color + "cc";
      ctx.lineWidth = 2;
      ctx.strokeRect(l, t, r-l, b-t);
      ctx.fillStyle = g.color + "14";
      ctx.fillRect(l, t, r-l, b-t);
    }

    ctx.setLineDash([]);

    // Items (placeholder rects)
    for (const item of items) {
      const { x, y, w, h } = itemBounds(item);
      ctx.fillStyle = item.color + "cc";
      ctx.fillRect(x, y, w, h);
      // inner grid to look like a product photo
      ctx.strokeStyle = item.color + "55";
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x+4, y+4, w-8, h-8);
      // label
      const fs = Math.max(9, Math.min(12, w / 12));
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = `500 ${fs}px 'JetBrains Mono', monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lbl = item.label.length > 18 ? item.label.slice(0,15)+"…" : item.label;
      ctx.fillText(lbl, x+w/2, y+h/2);
      ctx.textBaseline = "alphabetic";
    }

    // Selection outline + handles
    if (sel) {
      const { x, y, w, h } = itemBounds(sel);
      ctx.strokeStyle = C.yellow;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(x-2, y-2, w+4, h+4);
      ctx.setLineDash([]);
      ctx.fillStyle = C.yellow;
      [[x-2,y-2],[x+w+2,y-2],[x-2,y+h+2],[x+w+2,y+h+2]].forEach(([hx,hy]) => {
        ctx.fillRect(hx-3, hy-3, 6, 6);
      });

      // Coordinate overlay
      const locked = scaleLocked ? " [lock]" : "";
      const info = `x:${sel.canvasX}  y:${sel.canvasY}  scale:${sel.scale.toFixed(3)}${locked}`;
      ctx.fillStyle = "rgba(0,0,0,0.72)";
      ctx.fillRect(4, DS-20, info.length*5.6+8, 16);
      ctx.fillStyle = C.yellow;
      ctx.font = "8px 'JetBrains Mono', monospace";
      ctx.textAlign = "left";
      ctx.fillText(info, 8, DS-8);
    }
  }, [items, selId, template, scaleLocked]);

  // ── Mouse ─────────────────────────────────────────────────────────────
  const onMouseDown = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    for (let i = items.length-1; i >= 0; i--) {
      const it = items[i];
      const { x,y,w,h } = itemBounds(it);
      if (mx>=x && mx<=x+w && my>=y && my<=y+h) {
        undoRef.current = { id:it.id, canvasX:it.canvasX, canvasY:it.canvasY, scale:it.scale };
        setSelId(it.id);
        dragRef.current = { itemId:it.id, ox:mx-it.canvasX*S, oy:my-it.canvasY*S };
        containerRef.current?.focus({ preventScroll: true });
        return;
      }
    }
    setSelId(null);
    dragRef.current = null;
  }, [items]);

  const onMouseMove = useCallback((e) => {
    if (!dragRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { itemId, ox, oy } = dragRef.current;
    setItems(prev => prev.map(it =>
      it.id===itemId ? {...it, canvasX:Math.round((mx-ox)/S), canvasY:Math.round((my-oy)/S)} : it
    ));
  }, []);

  const onMouseUp = useCallback(() => { dragRef.current = null; }, []);

  // Non-passive wheel on canvas
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

  // ── Keyboard ──────────────────────────────────────────────────────────
  const onKeyDown = useCallback((e) => {
    if (!selId) return;
    const n = e.shiftKey ? 10 : 1;
    const map = { ArrowLeft:[-n,0], ArrowRight:[n,0], ArrowUp:[0,-n], ArrowDown:[0,n] };
    if (map[e.key]) {
      e.preventDefault();
      const [dx,dy] = map[e.key];
      setItems(prev => prev.map(it => it.id===selId ? {...it,canvasX:it.canvasX+dx,canvasY:it.canvasY+dy} : it));
      return;
    }
    if (e.key==="Enter") doSave();
    if (e.key==="s"||e.key==="S") doSkip();
    if ((e.ctrlKey||e.metaKey) && e.key==="z") doUndo();
  }, [selId]);

  // ── Actions ───────────────────────────────────────────────────────────
  function doUndo() {
    if (!undoRef.current) return;
    const { id,canvasX,canvasY,scale } = undoRef.current;
    setItems(prev => prev.map(it => it.id===id ? {...it,canvasX,canvasY,scale} : it));
    undoRef.current = null;
    setStatus("undone.");
  }

  function doSave() {
    setSaved(true);
    setStatus("saved: product_001_final.png  →  output/final/");
    setTimeout(() => setSaved(false), 1600);
  }

  function doSkip() {
    setStatus("skipped  →  output/skipped/");
  }

  function removeSelected() {
    if (!selId) return;
    setItems(prev => prev.filter(it => it.id!==selId));
    setSelId(null);
  }

  function snapTo(zone) {
    if (!sel) { setStatus("select an item first."); return; }
    const g = GUIDES[zone];
    const newScale = (g.bottom-g.top)/sel.origH;
    undoRef.current = { id:sel.id, canvasX:sel.canvasX, canvasY:sel.canvasY, scale:sel.scale };
    setItems(prev => prev.map(it =>
      it.id===selId ? {...it, scale:newScale, canvasX:CS/2, canvasY:(g.top+g.bottom)/2} : it
    ));
  }

  function doAlign(axis) {
    if (!selId) return;
    undoRef.current = sel ? { id:sel.id, canvasX:sel.canvasX, canvasY:sel.canvasY, scale:sel.scale } : null;
    setItems(prev => prev.map(it =>
      it.id===selId
        ? axis==="h" ? {...it,canvasX:CS/2} : {...it,canvasY:CS/2}
        : it
    ));
  }

  function onTemplateChange(name) {
    setTemplate(name);
    const tmpl = TEMPLATES[name];
    if (tmpl?.zone && sel) snapTo(tmpl.zone);
  }

  function nudgeScale(d) {
    if (scaleLocked||!sel) return;
    undoRef.current = { id:sel.id, canvasX:sel.canvasX, canvasY:sel.canvasY, scale:sel.scale };
    setItems(prev => prev.map(it =>
      it.id===selId ? {...it, scale:Math.max(0.02,Math.min(4.0,it.scale+d))} : it
    ));
  }

  function setScaleDirect(v) {
    if (scaleLocked||!selId) return;
    setItems(prev => prev.map(it => it.id===selId ? {...it,scale:v} : it));
  }

  const snapBtns = [
    { lbl:"G", zone:"green",   col:C.green   },
    { lbl:"B", zone:"blue",    col:C.blue    },
    { lbl:"M", zone:"magenta", col:C.magenta },
    { lbl:"R", zone:"red",     col:C.red     },
  ];

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      style={{
        display:"flex", background:C.bg, height:"100%",
        overflow:"hidden",
        fontFamily:"'Outfit', 'DM Sans', system-ui, sans-serif",
        color:C.text, outline:"none", userSelect:"none",
        fontSize:13,
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        ::-webkit-scrollbar{width:5px} ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#1d2235;border-radius:3px}
        button:hover{filter:brightness(1.12)} button:active{filter:brightness(0.9)}
        select{outline:none}
        input[type=range]{accent-color:#4ade80}
        input[type=checkbox]{accent-color:#4ade80}
      `}</style>

      {/* ── Canvas column ─────────────────────────────────────────── */}
      <div style={{ padding:"12px 8px 12px 12px", display:"flex", flexDirection:"column", gap:8 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", height:22 }}>
          <span style={{ fontSize:9, letterSpacing:"0.12em", color:C.dim, textTransform:"uppercase", fontWeight:600 }}>
            Placement Editor
          </span>
          <span style={{ fontSize:9, color:C.dim2, fontFamily:"JetBrains Mono" }}>
            1440 × 1440
          </span>
        </div>

        <canvas
          ref={canvasRef}
          width={DS}
          height={DS}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          style={{
            border:`1px solid ${C.border}`,
            cursor:"crosshair",
            display:"block",
            borderRadius:2,
          }}
        />

        {/* Mini pipeline status bar */}
        <div style={{
          display:"flex", alignItems:"center", gap:12,
          background:C.panel, border:`1px solid ${C.border}`,
          borderRadius:4, padding:"5px 10px",
        }}>
          {[
            { lbl:"Upscale",  done:true  },
            { lbl:"Rembg",    done:true  },
            { lbl:"Place",    done:false, active:true },
            { lbl:"Export",   done:false },
          ].map(({lbl,done,active}) => (
            <div key={lbl} style={{ display:"flex", alignItems:"center", gap:5 }}>
              <div style={{
                width:6, height:6, borderRadius:"50%",
                background: done ? C.green : active ? C.yellow : C.dim2,
                boxShadow: active ? `0 0 6px ${C.yellow}88` : "none",
              }}/>
              <span style={{ fontSize:10, color: active ? C.yellow : done ? C.green+"cc" : C.dim }}>{lbl}</span>
            </div>
          ))}
          <div style={{ marginLeft:"auto", fontSize:9, color:C.dim, fontFamily:"JetBrains Mono" }}>
            {queueIdx+1} / {queueTotal}
          </div>
        </div>
      </div>

      {/* ── Sidebar ───────────────────────────────────────────────── */}
      <div style={{
        width:230, background:C.panel, borderLeft:`1px solid ${C.border}`,
        padding:"10px 10px 16px", overflowY:"auto",
        display:"flex", flexDirection:"column", flexShrink:0,
      }}>

        {/* SOURCE */}
        <Divider label="Source" />
        <div style={{ fontFamily:"JetBrains Mono", fontSize:10, color:C.green, marginBottom:6 }}>
          output/bg_removed
        </div>
        <Btn>Change Folder</Btn>

        {/* QUEUE */}
        <Divider label="Queue" />
        <div style={{ display:"flex", alignItems:"baseline", gap:6, marginBottom:8 }}>
          <span style={{ fontSize:22, fontWeight:600, lineHeight:1 }}>{queueIdx+1}</span>
          <span style={{ fontSize:12, color:C.dim }}>/ {queueTotal}</span>
          <span style={{ fontSize:10, color:C.dim, marginLeft:4 }}>images</span>
        </div>

        <label style={{ display:"flex", alignItems:"center", gap:7, fontSize:11, color:C.dim, marginBottom:8, cursor:"pointer" }}>
          <input type="checkbox" checked={comboMode} onChange={e=>setComboMode(e.target.checked)} />
          Combo mode
        </label>

        <button
          onClick={doSave}
          style={{
            background: saved ? "#1a5c30" : C.save_bg,
            color: saved ? "#6ee79a" : C.green,
            border:`1px solid ${C.save_border}`,
            borderRadius:4, padding:"7px 8px",
            fontSize:11, fontWeight:600, cursor:"pointer",
            width:"100%", marginBottom:4, textAlign:"left",
            fontFamily:"inherit",
            transition:"background 0.15s",
          }}
        >
          {saved ? "Saved!" : "Save + Next  [Enter]"}
        </button>

        <div style={{ display:"flex", gap:4, marginBottom:4 }}>
          <Btn onClick={doSkip} style={{ flex:1, color:C.dim }}>Skip  [S]</Btn>
          <Btn onClick={removeSelected} style={{ flex:1, color:C.red, borderColor:"#2a1515" }}>Remove</Btn>
        </div>

        {/* TEMPLATE */}
        <Divider label="Template" />
        <select
          value={template}
          onChange={e => onTemplateChange(e.target.value)}
          style={{
            background:C.panel2, color:C.text,
            border:`1px solid ${C.border}`, borderRadius:4,
            padding:"5px 6px", fontSize:11, width:"100%",
            marginBottom:4, fontFamily:"inherit",
          }}
        >
          {Object.keys(TEMPLATES).map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        {TEMPLATES[template]?.hint && (
          <div style={{ fontSize:10, color:C.dim, marginBottom:2, paddingLeft:2 }}>
            {TEMPLATES[template].hint}
          </div>
        )}

        {/* SNAP / ALIGN */}
        <Divider label="Snap / Align" />
        <div style={{ display:"flex", gap:3, marginBottom:5 }}>
          {snapBtns.map(({ lbl,zone,col }) => (
            <button
              key={zone}
              onClick={() => snapTo(zone)}
              style={{
                flex:1, background:C.panel2, color:col,
                border:`1px solid ${C.border}`, borderRadius:4,
                padding:"5px 0", fontSize:12, fontWeight:700,
                cursor:"pointer", fontFamily:"inherit",
              }}
            >{lbl}</button>
          ))}
        </div>
        <div style={{ display:"flex", gap:4 }}>
          <Btn onClick={()=>doAlign("h")} style={{ flex:1, textAlign:"center", fontSize:10 }}>H-Center</Btn>
          <Btn onClick={()=>doAlign("v")} style={{ flex:1, textAlign:"center", fontSize:10 }}>V-Center</Btn>
        </div>

        {/* SCALE */}
        <Divider label="Scale (selected)" />
        <input
          type="range" min={0.05} max={3.0} step={0.005}
          value={sel?.scale ?? 1.0}
          onChange={e => setScaleDirect(parseFloat(e.target.value))}
          disabled={scaleLocked || !sel}
          style={{ width:"100%", marginBottom:5 }}
        />
        <div style={{ display:"flex", gap:3, marginBottom:6 }}>
          {[["−5%",-0.05],["−1%",-0.01],["+1%",0.01],["+5%",0.05]].map(([l,d])=>(
            <Btn key={l} onClick={()=>nudgeScale(d)} style={{ flex:1, textAlign:"center", fontSize:9, padding:"3px 0" }}>{l}</Btn>
          ))}
        </div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <label style={{ display:"flex", alignItems:"center", gap:7, fontSize:11, color:C.dim, cursor:"pointer" }}>
            <input type="checkbox" checked={scaleLocked} onChange={e=>setScaleLocked(e.target.checked)} style={{ accentColor:C.red }} />
            Lock scale
          </label>
          {sel && (
            <span style={{ fontSize:10, color:C.dim, fontFamily:"JetBrains Mono" }}>
              {sel.scale.toFixed(3)}
            </span>
          )}
        </div>

        {/* CANVAS ITEMS */}
        <Divider label="Canvas Items" />
        <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
          {items.map(item => (
            <button
              key={item.id}
              onClick={() => setSelId(item.id)}
              style={{
                background: item.id===selId ? "#161e38" : C.panel2,
                color:       item.id===selId ? C.yellow  : "#7a8aad",
                border:      `1px solid ${item.id===selId ? "#22306a" : C.border}`,
                borderRadius:4, padding:"5px 8px",
                fontSize:10, cursor:"pointer", textAlign:"left",
                fontFamily:"JetBrains Mono",
              }}
            >
              {item.id===selId ? "▸ " : "  "}{item.label}
            </button>
          ))}
          {items.length===0 && (
            <div style={{ fontSize:10, color:C.dim, paddingLeft:2 }}>No items on canvas</div>
          )}
        </div>

        {/* STATUS */}
        <div style={{ marginTop:"auto", paddingTop:20, borderTop:`1px solid ${C.border}`, marginTop:16 }}>
          <div style={{ fontSize:9, color:C.dim, lineHeight:1.7, fontFamily:"JetBrains Mono" }}>
            {status}
          </div>
        </div>

      </div>
    </div>
  );
}
