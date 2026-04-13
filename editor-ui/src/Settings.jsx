import { useState, useEffect, useCallback } from "react";

const BASE = "/api";

const C = {
  bg: "#0b0d14", panel: "#0f1219", panel2: "#161926",
  border: "#0033ff", text: "#d8e0f0", dim: "#454f6b", dim2: "#262d44",
  green: "#00ff5e", blue: "#0073ff", yellow: "#facc15",
  red: "#ff0000", magenta: "#dd00ff",
};

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{
        fontSize: 10, letterSpacing: "0.12em", color: C.dim,
        textTransform: "uppercase", fontWeight: 700,
        borderBottom: `1px solid ${C.border}`, paddingBottom: 6, marginBottom: 14,
      }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
    </div>
  );
}

function Row({ label, hint, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontSize: 12, color: C.text }}>{label}</div>
        {hint && <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>{children}</div>
    </div>
  );
}

function Toggle({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {[true, false].map(v => (
        <button key={String(v)} onClick={() => onChange(v)} style={{
          padding: "3px 12px", fontSize: 11, borderRadius: 4, cursor: "pointer",
          fontFamily: "inherit", fontWeight: value === v ? 600 : 400,
          background: value === v ? (v ? "#0d2818" : "#1a0808") : "transparent",
          color: value === v ? (v ? C.green : C.red) : C.dim,
          border: `1px solid ${value === v ? (v ? "#1e4a2e" : "#3a1515") : "transparent"}`,
        }}>{v ? "On" : "Off"}</button>
      ))}
    </div>
  );
}

function Slider({ value, onChange, min = 0, max = 1, step = 0.05, format = v => v.toFixed(2) }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: 120, accentColor: C.blue }} />
      <span style={{ fontSize: 11, color: C.text, fontFamily: "JetBrains Mono", minWidth: 32 }}>
        {format(value)}
      </span>
    </div>
  );
}

function NumInput({ value, onChange, min, max, width = 72 }) {
  return (
    <input type="number" value={value} min={min} max={max}
      onChange={e => onChange(Number(e.target.value))}
      style={{
        width, background: C.panel2, color: C.text,
        border: `1px solid ${C.border}`, borderRadius: 4,
        padding: "4px 8px", fontSize: 11, fontFamily: "JetBrains Mono",
        outline: "none", textAlign: "center", colorScheme: "dark",
      }} />
  );
}

function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{
      background: C.panel2, color: C.text, border: `1px solid ${C.border}`,
      borderRadius: 4, padding: "4px 8px", fontSize: 11, fontFamily: "inherit",
      outline: "none", colorScheme: "dark",
    }}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

const DEFAULT = {
  processing:   {
    crop_padding: 0.04,
    edge_blur: 1.2,
    contrast_gain: 1.4,
    hole_fill_threshold: 30,
    rembg_model: "birefnet-general",
    history_keep: 30,
  },
  upscaler_api: { provider: "local", url: "", key: "", model: "" },
  rembg_api:    { provider: "local", url: "", key: "" },
  output:       { canvas_size: 1440, thumbnail: true, thumbnail_size: 400, folder_mode: "bulk", output_dir: "" },
  appearance:   { guide_opacity: 1.0, ref_img_opacity: 0.05 },
};

export default function Settings() {
  const [s, setS] = useState(DEFAULT);
  const [status, setStatus] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/settings`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.settings) setS(data.settings); })
      .catch(() => {});
  }, []);

  const set = useCallback((section, key, val) => {
    setS(prev => ({ ...prev, [section]: { ...prev[section], [key]: val } }));
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: s }),
      });
      if (r.ok) {
        setStatus("Saved ✓");
        setDirty(false);
        setTimeout(() => setStatus(""), 2000);
      } else {
        setStatus("Save failed");
      }
    } catch { setStatus("Save failed"); }
  }, [s]);

  const reset = useCallback(() => { setS(DEFAULT); setDirty(true); }, []);

  return (
    <div style={{
      display: "flex", flexDirection: "column", background: C.bg,
      height: "100%", overflow: "hidden",
      fontFamily: "'Outfit','DM Sans',system-ui,sans-serif", color: C.text, fontSize: 13,
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        button:hover{filter:brightness(1.15)} button:active{filter:brightness(0.9)}
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#1d2235;border-radius:2px}
        input[type=range]{accent-color:#60a5fa}
      `}</style>

      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 24px", height: 48, borderBottom: `1px solid ${C.border}`,
        background: C.panel, flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.02em" }}>Settings</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {status && <span style={{ fontSize: 11, color: status.includes("✓") ? C.green : C.red, fontFamily: "JetBrains Mono" }}>{status}</span>}
          <button onClick={reset} style={{
            background: "transparent", color: C.dim, border: `1px solid ${C.border}`,
            borderRadius: 4, padding: "5px 14px", fontSize: 11, cursor: "pointer", fontFamily: "inherit",
          }}>Reset to defaults</button>
          <button onClick={save} style={{
            background: dirty ? "#0d2818" : C.panel2,
            color: dirty ? C.green : C.dim,
            border: `1px solid ${dirty ? "#1e4a2e" : C.border}`,
            borderRadius: 4, padding: "5px 18px", fontSize: 11, fontWeight: 600,
            cursor: "pointer", fontFamily: "inherit",
          }}>Save</button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px", maxWidth: 720 }}>

        {/* ── Appearance ─────────────────────────────────────────────────── */}
        <Section title="Appearance">
          <Row label="Guide opacity" hint="Affects the placement editor canvas guidelines">
            <Slider
              value={s.appearance.guide_opacity}
              onChange={v => set("appearance", "guide_opacity", v)}
              format={v => `${Math.round(v * 100)}%`}
            />
          </Row>
          <Row label="Reference image opacity" hint="Template reference image overlay in editor">
            <Slider
              value={s.appearance.ref_img_opacity}
              onChange={v => set("appearance", "ref_img_opacity", v)}
              format={v => `${Math.round(v * 100)}%`}
            />
          </Row>
        </Section>

        {/* ── Output defaults ─────────────────────────────────────────────── */}
        <Section title="Output Defaults">
          <Row label="Default output folder" hint="Used when output field is left blank in Pipeline">
            <input
              value={s.output.output_dir} placeholder="blank = ./output"
              onChange={e => set("output", "output_dir", e.target.value)}
              style={{
                width: 260, background: C.panel2, color: C.text,
                border: `1px solid ${C.border}`, borderRadius: 4,
                padding: "5px 8px", fontSize: 11, fontFamily: "JetBrains Mono", outline: "none",
              }}
            />
          </Row>
          <Row label="Canvas size (px)" hint="Default composition canvas">
            <NumInput value={s.output.canvas_size} min={256} max={8192}
              onChange={v => set("output", "canvas_size", v)} />
          </Row>
          <Row label="Thumbnail" hint="Generate 400px thumbnail alongside full-res output">
            <Toggle value={s.output.thumbnail} onChange={v => set("output", "thumbnail", v)} />
          </Row>
          <Row label="Default folder mode">
            <Select
              value={s.output.folder_mode}
              onChange={v => set("output", "folder_mode", v)}
              options={[["bulk", "Bulk — flat input/ folder"], ["clean", "Clean — subfolders"]]}
            />
          </Row>
        </Section>

        {/* ── Processing ─────────────────────────────────────────────────── */}
        <Section title="Processing">
          <Row label="BiRefNet model">
            <Select
              value={s.processing.rembg_model}
              onChange={v => set("processing", "rembg_model", v)}
              options={[
                ["birefnet-general",      "birefnet-general (recommended)"],
                ["birefnet-general-lite", "birefnet-general-lite (faster, smaller)"],
                ["birefnet-massive",      "birefnet-massive (slower, higher quality)"],
                ["birefnet-dis",          "birefnet-dis (detail/illustration)"],
                ["birefnet-hrsod",        "birefnet-hrsod (salient object)"],
              ]}
            />
          </Row>
          <Row label="Crop padding" hint="Fraction of bounding box added as padding after crop">
            <Slider value={s.processing.crop_padding} min={0} max={0.2} step={0.005}
              onChange={v => set("processing", "crop_padding", v)}
              format={v => `${(v * 100).toFixed(1)}%`} />
          </Row>
          <Row label="Edge blur radius" hint="Gaussian blur on alpha mask edges (0 = off)">
            <Slider value={s.processing.edge_blur} min={0} max={5} step={0.1}
              onChange={v => set("processing", "edge_blur", v)}
              format={v => v.toFixed(1)} />
          </Row>
          <Row label="Contrast gain" hint="Inference prepass for low-contrast product/background separation">
            <Slider value={s.processing.contrast_gain ?? 1.4} min={1.0} max={2.0} step={0.05}
              onChange={v => set("processing", "contrast_gain", v)}
              format={v => `${v.toFixed(2)}×`} />
          </Row>
          <Row label="Hole fill threshold" hint="Lower = preserve openings, higher = fill more enclosed holes">
            <NumInput value={s.processing.hole_fill_threshold ?? 30} min={0} max={255} width={60}
              onChange={v => set("processing", "hole_fill_threshold", v)} />
          </Row>
          <Row label="History folders to keep" hint="Older runs in history/ auto-deleted">
            <NumInput value={s.processing.history_keep} min={1} max={200} width={60}
              onChange={v => set("processing", "history_keep", v)} />
          </Row>
        </Section>

        {/* ── GPU note ───────────────────────────────────────────────────── */}
        <Section title="GPU Setup (BiRefNet)">
          <div style={{
            background: C.panel2, border: `1px solid ${C.border}`,
            borderRadius: 5, padding: "12px 14px", fontSize: 11, lineHeight: 1.9, color: C.dim,
          }}>
            <div style={{ color: C.text, fontWeight: 600, marginBottom: 6 }}>Enable GPU for background removal</div>
            BiRefNet runs on CPU by default. To use your RTX 3070 via DirectML:
            <br />
            <code style={{ color: C.yellow, fontFamily: "JetBrains Mono", fontSize: 10 }}>
              pip uninstall onnxruntime
            </code>
            <br />
            <code style={{ color: C.yellow, fontFamily: "JetBrains Mono", fontSize: 10 }}>
              pip install onnxruntime-directml
            </code>
            <br />
            <span style={{ color: C.dim }}>No code changes needed — auto-detected at runtime.</span>
            <br />
            <span style={{ color: C.dim }}>NCNN upscaling already uses the GPU automatically.</span>
          </div>
        </Section>

      </div>
    </div>
  );
}
