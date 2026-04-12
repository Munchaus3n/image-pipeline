import { useState, useEffect, useCallback } from "react";

const BASE = "/api";

const C = {
  bg: "#0b0d14", panel: "#0f1219", panel2: "#161926", panel3: "#1a2030",
  border: "#1d2235", text: "#e2e8f8", dim: "#6b7a9e", dim2: "#2a3350",
  green: "#4ade80", greenBg: "#0d2818", greenBdr: "#1e4a2e",
  red: "#f87171", redBg: "#200d0d", redBdr: "#3a1515",
  blue: "#60a5fa", yellow: "#facc15",
};

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{
        fontSize: 10, letterSpacing: "0.12em", color: C.dim,
        textTransform: "uppercase", fontWeight: 700,
        borderBottom: `1px solid ${C.border}`, paddingBottom: 8, marginBottom: 16,
      }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>{children}</div>
    </div>
  );
}

function Row({ label, hint, children, last }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "10px 14px", gap: 24,
      background: C.panel2,
      borderRadius: last ? "0 0 5px 5px" : "0",
      border: `1px solid ${C.border}`,
      borderTop: "none",
      marginTop: 0,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function SectionCard({ children }) {
  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 6, overflow: "hidden",
    }}>
      {/* First child gets rounded top corners */}
      {children}
    </div>
  );
}

function CardRow({ label, hint, children, first, last }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "11px 16px", gap: 24,
      background: C.panel2,
      borderBottom: last ? "none" : `1px solid ${C.border}`,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function Toggle({ value, onChange }) {
  return (
    <div style={{
      display: "flex", gap: 2, background: C.panel, borderRadius: 5,
      padding: 3, border: `1px solid ${C.border}`,
    }}>
      {[true, false].map(v => (
        <button key={String(v)} onClick={() => onChange(v)} style={{
          padding: "3px 14px", fontSize: 11, borderRadius: 3, cursor: "pointer",
          fontFamily: "inherit", fontWeight: value === v ? 600 : 400,
          background: value === v ? (v ? C.greenBg : C.redBg) : "transparent",
          color: value === v ? (v ? C.green : C.red) : C.dim,
          border: `1px solid ${value === v ? (v ? C.greenBdr : C.redBdr) : "transparent"}`,
          transition: "all 0.12s",
        }}>{v ? "On" : "Off"}</button>
      ))}
    </div>
  );
}

function Slider({ value, onChange, min = 0, max = 1, step = 0.05, format = v => v.toFixed(2) }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: 130, accentColor: C.blue, cursor: "pointer" }} />
      <span style={{
        fontSize: 11, color: C.text, fontFamily: "JetBrains Mono",
        minWidth: 42, textAlign: "right", background: C.panel,
        border: `1px solid ${C.border}`, borderRadius: 3, padding: "2px 6px",
      }}>{format(value)}</span>
    </div>
  );
}

function NumInput({ value, onChange, min, max, width = 72 }) {
  return (
    <input type="number" value={value} min={min} max={max}
      onChange={e => onChange(Number(e.target.value))}
      style={{
        width, background: C.panel, color: C.text,
        border: `1px solid ${C.border}`, borderRadius: 4,
        padding: "5px 8px", fontSize: 11, fontFamily: "JetBrains Mono",
        outline: "none", textAlign: "center", colorScheme: "dark",
      }} />
  );
}

function Select({ value, onChange, options, wide }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{
      background: C.panel, color: C.text, border: `1px solid ${C.border}`,
      borderRadius: 4, padding: "5px 10px", fontSize: 11, fontFamily: "inherit",
      outline: "none", colorScheme: "dark", cursor: "pointer",
      minWidth: wide ? 270 : 160,
    }}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

const DEFAULT = {
  processing:   { crop_padding: 0.04, edge_blur: 1.2, rembg_model: "birefnet-general", history_keep: 30, force_cpu: false },
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
        setStatus("Saved ✓"); setDirty(false);
        setTimeout(() => setStatus(""), 2000);
      } else { setStatus("Save failed"); }
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
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#1d2235;border-radius:2px}
        input[type=range]{accent-color:#60a5fa}
        select option{background:#161926}
        button:active{filter:brightness(0.88)}
      `}</style>

      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 24px", height: 48, borderBottom: `1px solid ${C.border}`,
        background: C.panel, flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.04em" }}>Settings</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {status && (
            <span style={{ fontSize: 11, fontFamily: "JetBrains Mono", color: status.includes("✓") ? C.green : C.red }}>
              {status}
            </span>
          )}
          {/* Reset — red outline, lights up when dirty */}
          <button onClick={reset} style={{
            background: dirty ? C.redBg : "transparent",
            color: dirty ? C.red : C.dim,
            border: `1px solid ${dirty ? C.redBdr : C.border}`,
            borderRadius: 4, padding: "5px 14px", fontSize: 11,
            cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
          }}>Reset defaults</button>
          {/* Save — green outline, lights up when dirty */}
          <button onClick={save} style={{
            background: dirty ? C.greenBg : "transparent",
            color: dirty ? C.green : C.dim,
            border: `1px solid ${dirty ? C.greenBdr : C.border}`,
            borderRadius: 4, padding: "5px 20px", fontSize: 11, fontWeight: 600,
            cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
          }}>Save</button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
        <div style={{ maxWidth: 660 }}>

          {/* Appearance */}
          <Section title="Appearance">
            <SectionCard>
              <CardRow label="Guide opacity" hint="Canvas placement guide lines in the editor" first>
                <Slider
                  value={s.appearance.guide_opacity}
                  onChange={v => set("appearance", "guide_opacity", v)}
                  format={v => `${Math.round(v * 100)}%`}
                />
              </CardRow>
              <CardRow label="Reference image opacity" hint="Template reference overlay in editor" last>
                <Slider
                  value={s.appearance.ref_img_opacity}
                  onChange={v => set("appearance", "ref_img_opacity", v)}
                  format={v => `${Math.round(v * 100)}%`}
                />
              </CardRow>
            </SectionCard>
          </Section>

          {/* Output */}
          <Section title="Output Defaults">
            <SectionCard>
              <CardRow label="Default output folder" hint="Leave blank to use ./output next to pipeline.py" first>
                <input
                  value={s.output.output_dir} placeholder="blank = ./output"
                  onChange={e => set("output", "output_dir", e.target.value)}
                  style={{
                    width: 220, background: C.panel, color: C.text,
                    border: `1px solid ${C.border}`, borderRadius: 4,
                    padding: "5px 8px", fontSize: 11, fontFamily: "JetBrains Mono", outline: "none",
                  }}
                />
              </CardRow>
              <CardRow label="Canvas size (px)" hint="Default composition canvas">
                <NumInput value={s.output.canvas_size} min={256} max={8192}
                  onChange={v => set("output", "canvas_size", v)} />
              </CardRow>
              <CardRow label="Thumbnail" hint="Generate 400 px thumbnail alongside full-res output">
                <Toggle value={s.output.thumbnail} onChange={v => set("output", "thumbnail", v)} />
              </CardRow>
              <CardRow label="Default folder mode" last>
                <Select
                  value={s.output.folder_mode}
                  onChange={v => set("output", "folder_mode", v)}
                  options={[["bulk", "Bulk — flat input/ folder"], ["clean", "Clean — subfolders"]]}
                />
              </CardRow>
            </SectionCard>
          </Section>

          {/* Background Removal */}
          <Section title="Background Removal">
            <SectionCard>
              <CardRow label="Model" hint="Change takes effect on next pipeline run" first>
                <Select
                  value={s.processing.rembg_model}
                  onChange={v => set("processing", "rembg_model", v)}
                  wide
                  options={[
                    ["birefnet-general",      "birefnet-general  (recommended)"],
                    ["birefnet-general-lite", "birefnet-general-lite  (faster, smaller)"],
                    ["birefnet-massive",      "birefnet-massive  (slower, high quality)"],
                    ["birefnet-dis",          "birefnet-dis  (detail / illustration)"],
                    ["birefnet-hrsod",        "birefnet-hrsod  (salient object)"],
                    ["bria-rmbg",             "BRIA RMBG-2.0  (non-commercial only)"],
                  ]}
                />
              </CardRow>
              <CardRow label="Force CPU" hint="Skip DirectML/CUDA — fixes OOM errors on some GPUs">
                <Toggle value={s.processing.force_cpu ?? false} onChange={v => set("processing", "force_cpu", v)} />
              </CardRow>
              <CardRow label="Crop padding" hint="Fraction of bounding box added as padding after crop">
                <Slider value={s.processing.crop_padding} min={0} max={0.2} step={0.005}
                  onChange={v => set("processing", "crop_padding", v)}
                  format={v => `${(v * 100).toFixed(1)}%`} />
              </CardRow>
              <CardRow label="Edge blur radius" hint="Gaussian blur on alpha mask edges (0 = off)">
                <Slider value={s.processing.edge_blur} min={0} max={5} step={0.1}
                  onChange={v => set("processing", "edge_blur", v)}
                  format={v => v.toFixed(1)} />
              </CardRow>
              <CardRow label="History folders to keep" hint="Older runs in history/ are auto-deleted" last>
                <NumInput value={s.processing.history_keep} min={1} max={200} width={64}
                  onChange={v => set("processing", "history_keep", v)} />
              </CardRow>
            </SectionCard>
          </Section>

          {/* GPU */}
          <Section title="GPU Setup">
            <div style={{
              background: C.panel2, border: `1px solid ${C.border}`,
              borderRadius: 6, padding: "16px 18px",
              fontSize: 11, lineHeight: 1.8, color: C.dim,
            }}>
              <div style={{ color: C.text, fontWeight: 600, fontSize: 12, marginBottom: 10 }}>
                Enable GPU acceleration for background removal
              </div>
              <div style={{ marginBottom: 8 }}>
                All models run on CPU by default. To use your GPU via DirectML (NVIDIA / AMD):
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 10 }}>
                <code style={{ color: C.yellow, fontFamily: "JetBrains Mono", fontSize: 10, background: "#1a1500", border: "1px solid #2a2000", borderRadius: 3, padding: "3px 8px", display: "inline-block" }}>
                  pip uninstall onnxruntime
                </code>
                <code style={{ color: C.yellow, fontFamily: "JetBrains Mono", fontSize: 10, background: "#1a1500", border: "1px solid #2a2000", borderRadius: 3, padding: "3px 8px", display: "inline-block" }}>
                  pip install onnxruntime-directml
                </code>
              </div>
              <div style={{ marginBottom: 6 }}>NCNN upscaling already uses the GPU automatically via Vulkan.</div>
              <div style={{ paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                <span style={{ color: C.yellow }}>Getting "Not enough memory resources"?</span>
                {" "}Enable <b style={{ color: C.text }}>Force CPU</b> above — the pipeline also auto-retries on CPU if DirectML OOM is detected.
              </div>
            </div>
          </Section>

        </div>
      </div>
    </div>
  );
}
