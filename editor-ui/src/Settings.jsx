import { useState, useEffect, useCallback } from "react";

const BASE = "/api";

function Section({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border:"1px solid var(--border)", borderRadius:8, overflow:"hidden", marginBottom:6, background:"var(--panel)" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"9px 14px", background:"transparent", border:"none",
          cursor:"pointer", textAlign:"left", transition:"background 0.15s",
        }}
        onMouseEnter={e => e.currentTarget.style.background = "var(--panel2)"}
        onMouseLeave={e => e.currentTarget.style.background = "var(--panel)"}
      >
        <span style={{ fontSize:12, fontWeight:600, color:"var(--text)" }}>{title}</span>
        <span style={{ color:"var(--dim)", fontSize:13, transition:"transform 0.2s", transform: open ? "rotate(90deg)" : "rotate(0)" }}>
          ›
        </span>
      </button>
      {open && (
        <div className="animate-fade-in" style={{ padding:"0 14px 12px", borderTop:"1px solid var(--border)", background:"var(--panel)" }}>
          <div style={{ display:"flex", flexDirection:"column", gap:10, marginTop:10 }}>
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, hint, children }) {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:16 }}>
      <div style={{ minWidth:0, flex:1 }}>
        <div style={{ fontSize:11, color:"var(--text)", marginBottom: hint ? 1 : 0 }}>{label}</div>
        {hint && <div style={{ fontSize:10, color:"var(--dim)" }}>{hint}</div>}
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
        {children}
      </div>
    </div>
  );
}

function Toggle({ value, onChange }) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{
        width:40, height:22, borderRadius:11, cursor:"pointer", position:"relative",
        background: value ? "var(--green-bg)" : "var(--red-bg)",
        border: `1px solid ${value ? "var(--green-bdr)" : "var(--red-bdr)"}`,
        transition:"all 0.2s ease",
      }}
    >
      <div style={{
        width:16, height:16, borderRadius:"50%", position:"absolute", top:2,
        left: value ? 20 : 2, transition:"left 0.2s ease",
        background: value ? "var(--green)" : "var(--red)",
        boxShadow:"0 1px 3px rgba(0,0,0,0.3)",
      }} />
    </div>
  );
}

function Slider({ value, onChange, min = 0, max = 100, step = 1, format = v => `${v}%` }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, width:200 }}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{
          flex:1, accentColor:"var(--accent)", cursor:"pointer",
          height:4, borderRadius:2, appearance:"none",
          background:"var(--panel2)",
        }}
      />
      <span style={{
        fontSize:11, fontFamily:"JetBrains Mono", minWidth:42, textAlign:"right",
        color:"var(--dim)",
      }}>
        {format(value)}
      </span>
    </div>
  );
}

function NumInput({ value, onChange, min, max, width = 80 }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={e => onChange(Number(e.target.value))}
      style={{
        width, background:"var(--panel2)", color:"var(--text)",
        border:"1px solid var(--border)", borderRadius:6,
        padding:"6px 8px", fontSize:12, fontFamily:"JetBrains Mono",
        textAlign:"center",
      }}
    />
  );
}

function OptionalNumInput({ value, onChange, min, max, width = 80, placeholder = "" }) {
  const shown = Number(value) > 0 ? String(value) : "";
  return (
    <input
      type="number"
      value={shown}
      min={min}
      max={max}
      placeholder={placeholder}
      onChange={e => {
        const raw = e.target.value.trim();
        onChange(raw === "" ? 0 : Number(raw));
      }}
      style={{
        width, background:"var(--panel2)", color:"var(--text)",
        border:"1px solid var(--border)", borderRadius:6,
        padding:"6px 5px", fontSize:12, fontFamily:"JetBrains Mono",
        textAlign:"center",
      }}
    />
  );
}

function Select({ value, onChange, options, wide }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        background:"var(--panel2)", color:"var(--text)",
        border:"1px solid var(--border)", borderRadius:6,
        padding:"6px 10px", fontSize:12, cursor:"pointer",
        minWidth: wide ? 260 : 140,
        colorScheme:"dark light",
      }}
    >
      {options.map(([v, l]) => (
        <option key={v} value={v} style={{ background:"var(--panel2)", color:"var(--text)" }}>{l}</option>
      ))}
    </select>
  );
}

const DEFAULT = {
  processing:   { crop_padding: 0.04, edge_blur: 1.2, rembg_model: "birefnet-general", history_keep: 30, force_cpu: false, wipe_input_after_run: false, upscale_max_px: 0  },
  rembg_api:    { provider: "local", url: "", key: "" },
  upscaler_api: { provider: "local", url: "", key: "", model: "" },
  output:       { canvas_size: 1440, thumbnail: true, thumbnail_size: 400, folder_mode: "bulk", input_dir: "", output_dir: "", do_upscale: true, do_rembg: true, upscale_scale: "2" },
  appearance:   { guide_opacity: 1.0, ref_img_opacity: 0.05, canvas_bg_color: "#ffffff", theme: "dark" },
  guides:       { use_custom: false, custom: {} },
};

export default function Settings({ onThemeChange }) {
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
    if (section === "appearance" && key === "theme" && onThemeChange) onThemeChange(val);
  }, [onThemeChange]);

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
    <div style={{ display:"flex", flexDirection:"column", background:"var(--bg)", height:"100%", overflow:"hidden" }}>
      <style>{`
        [data-theme="dark"] select option { background: hsl(222,20%,16%); color: hsl(210,40%,95%); }
        [data-theme="light"] select option { background: hsl(220,14%,94%); color: hsl(224,20%,15%); }
        select option { background: var(--panel2); color: var(--text); }
      `}</style>
      {/* Header */}
      <div style={{
        display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"0 20px", height:48, borderBottom:"1px solid var(--border)",
        background:"var(--panel)", flexShrink:0,
      }}>
        <span style={{ fontSize:14, fontWeight:600 }}>Settings</span>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          {status && (
            <span style={{
              fontSize:11, fontFamily:"JetBrains Mono",
              color: status.includes("✓") ? "var(--green)" : "var(--red)"
            }}>
              {status}
            </span>
          )}
          <button
            onClick={reset}
            style={{
              background: dirty ? "var(--red-bg)" : "transparent",
              color: dirty ? "var(--red)" : "var(--dim)",
              border: `1px solid ${dirty ? "var(--red-bdr)" : "var(--border)"}`,
              borderRadius:8, padding:"6px 14px", fontSize:12,
            }}
          >
            Reset
          </button>
          <button
            onClick={save}
            style={{
              background: dirty ? "var(--accent)" : "transparent",
              color: dirty ? "var(--accent-fg)" : "var(--dim)",
              border: `1px solid ${dirty ? "var(--accent)" : "var(--border)"}`,
              borderRadius:8, padding:"6px 18px", fontSize:12, fontWeight:600,
            }}
          >
            Save
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex:1, overflowY:"auto", padding:"12px 16px" }}>
        <div style={{ maxWidth:800, margin:"0 auto" }}>

          <Section title="Appearance" defaultOpen>
            <Row label="Theme" hint="UI color scheme">
              <Select
                value={s.appearance.theme || "dark"}
                onChange={v => set("appearance", "theme", v)}
                options={[["dark", "Dark"], ["light", "Light"]]}
              />
            </Row>
            <Row label="Canvas background">
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <input
                  type="color"
                  value={s.appearance.canvas_bg_color || "#ffffff"}
                  onChange={e => set("appearance", "canvas_bg_color", e.target.value)}
                  style={{
                    width:32, height:24, border:"1px solid var(--border)",
                    borderRadius:6, cursor:"pointer", padding:0,
                  }}
                />
                <input
                  type="text"
                  value={s.appearance.canvas_bg_color || "#ffffff"}
                  onChange={e => {
                    const v = e.target.value;
                    if (/^#[0-9a-fA-F]{0,6}$/.test(v)) set("appearance", "canvas_bg_color", v);
                  }}
                  maxLength={7}
                  style={{
                    width:80, background:"var(--panel2)", color:"var(--text)",
                    border:"1px solid var(--border)", borderRadius:6,
                    padding:"5px 8px", fontSize:12, fontFamily:"JetBrains Mono",
                    textTransform:"uppercase",
                  }}
                />
              </div>
            </Row>
            <Row label="Guide opacity">
              <Slider
                value={s.appearance.guide_opacity}
                onChange={v => set("appearance", "guide_opacity", v)}
                format={v => `${Math.round(v)}%`}
              />
            </Row>
            <Row label="Reference image opacity">
              <Slider
                value={s.appearance.ref_img_opacity}
                onChange={v => set("appearance", "ref_img_opacity", v)}
                format={v => `${Math.round(v * 100)}%`}
              />
            </Row>
          </Section>

          <Section title="Input / Output Defaults">
            <Row label="Default input folder" hint="Leave blank for ./input">
              <input
                value={s.output.input_dir || ""}
                placeholder="blank = ./input"
                onChange={e => set("output", "input_dir", e.target.value)}
                style={{
                  width:240, background:"var(--panel2)", color:"var(--text)",
                  border:"1px solid var(--border)", borderRadius:6,
                  padding:"6px 10px", fontSize:12, fontFamily:"JetBrains Mono",
                }}
              />
            </Row>
            <Row label="Default output folder" hint="Leave blank for ./output">
              <input
                value={s.output.output_dir}
                placeholder="blank = ./output"
                onChange={e => set("output", "output_dir", e.target.value)}
                style={{
                  width:240, background:"var(--panel2)", color:"var(--text)",
                  border:"1px solid var(--border)", borderRadius:6,
                  padding:"6px 10px", fontSize:12, fontFamily:"JetBrains Mono",
                }}
              />
            </Row>
            <Row label="Canvas size (px)">
              <NumInput value={s.output.canvas_size} min={256} max={8192}
                onChange={v => set("output", "canvas_size", v)} />
            </Row>
            <Row label="Thumbnail" hint="Generate resized preview on save">
              <Toggle value={s.output.thumbnail} onChange={v => set("output", "thumbnail", v)} />
            </Row>
            {s.output.thumbnail && (
              <Row label="Thumbnail size (px)" hint="Width × height of generated preview">
                <NumInput value={s.output.thumbnail_size || 400} min={64} max={2048}
                  onChange={v => set("output", "thumbnail_size", v)} />
              </Row>
            )}
            <Row label="Folder mode">
              <Select
                value={s.output.folder_mode}
                onChange={v => set("output", "folder_mode", v)}
                options={[["bulk", "Bulk — flat folder"], ["clean", "Clean — subfolders"]]}
              />
            </Row>
            <Row label="Default upscale">
              <Toggle value={s.output.do_upscale ?? true} onChange={v => set("output", "do_upscale", v)} />
            </Row>
            <Row label="Default remove BG">
              <Toggle value={s.output.do_rembg ?? true} onChange={v => set("output", "do_rembg", v)} />
            </Row>
            {(s.output.do_upscale ?? true) && (
              <Row label="Default upscale factor">
                <Select
                  value={s.output.upscale_scale || "2"}
                  onChange={v => set("output", "upscale_scale", v)}
                  options={[["2", "2×"], ["4", "4×"]]}
                />
              </Row>
            )}
          </Section>

          <Section title="Background Removal">
            <Row label="Model">
              <Select
                value={s.processing.rembg_model}
                onChange={v => set("processing", "rembg_model", v)}
                wide
                options={[
                  ["birefnet-general",      "birefnet-general  (recommended)"],
                  ["birefnet-general-lite", "birefnet-general-lite  (faster)"],
                  ["birefnet-massive",      "birefnet-massive  (high quality)"],
                  ["birefnet-dis",          "birefnet-dis  (illustration)"],
                  ["birefnet-hrsod",        "birefnet-hrsod  (salient object)"],
                  ["bria-rmbg",             "BRIA RMBG-2.0  (non-commercial)"],
                ]}
              />
            </Row>
            <Row label="Force CPU" hint="Skip DirectML/CUDA">
              <Toggle value={s.processing.force_cpu ?? false} onChange={v => set("processing", "force_cpu", v)} />
            </Row>
            <Row label="Crop padding" hint="Fraction added after crop">
              <Slider value={s.processing.crop_padding} min={0} max={0.2} step={0.005}
                onChange={v => set("processing", "crop_padding", v)}
                format={v => `${(v * 100).toFixed(1)}%`} />
            </Row>
            <Row label="Edge blur radius" hint="0 = off">
              <Slider value={s.processing.edge_blur} min={0} max={5} step={0.1}
                onChange={v => set("processing", "edge_blur", v)}
                format={v => v.toFixed(1)} />
            </Row>
            <Row label="History folders to keep">
              <NumInput value={s.processing.history_keep} min={1} max={200} width={64}
                onChange={v => set("processing", "history_keep", v)} />
            </Row>
            <Row label="Wipe input after run" hint="ON: delete files • OFF: files remain in place">
              <Toggle value={!!s.processing.wipe_input_after_run} onChange={v => set("processing", "wipe_input_after_run", v)} />
            </Row>
          </Section>

          <Section title="Upscaling Rules">
            <Row label="Skip upscale if any side ≥" hint="Empty means no quality skip rule">
              <OptionalNumInput value={s.processing.upscale_max_px} min={512} max={8192} placeholder="no skip"
                onChange={v => set("processing", "upscale_max_px", v)} />
              <span style={{ fontSize:10, color:"var(--dim)" }}>px</span>
            </Row>
          </Section>
          
          <Section title="Guides">
            <Row label="Use custom guides" hint="Override config.ini">
              <Toggle value={!!s.guides?.use_custom} onChange={v => set("guides", "use_custom", v)} />
            </Row>
            {["green", "blue", "magenta", "red"].map(zone => (
              <div key={zone} style={{ marginTop:8 }}>
                <div style={{ fontSize:12, color:"var(--text)", marginBottom:6, textTransform:"capitalize" }}>
                  {zone} guide
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:8 }}>
                  {["top", "bottom", "left", "right"].map(k => (
                    <div key={k}>
                      <label style={{ fontSize:10, color:"var(--dim)", display:"block", marginBottom:4 }}>
                        {k}
                      </label>
                      <NumInput
                        width={60}
                        value={Number(s.guides?.custom?.[zone]?.[k] ?? 0)}
                        onChange={v => set("guides", "custom", {
                          ...(s.guides?.custom || {}),
                          [zone]: { ...(s.guides?.custom?.[zone] || {}), [k]: v }
                        })}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </Section>

          <Section title="GPU Setup">
            <div style={{
              background:"color-mix(in srgb, var(--accent) 8%, transparent)",
              border:"1px solid color-mix(in srgb, var(--accent) 20%, transparent)",
              borderRadius:8, padding:"14px 16px", fontSize:12, lineHeight:1.7,
              color:"var(--dim)",
            }}>
              <div style={{ color:"var(--text)", fontWeight:600, fontSize:13, marginBottom:8 }}>
                GPU Acceleration
              </div>
              <div style={{ marginBottom:6 }}>
                All models run on CPU by default. To use your GPU via DirectML (NVIDIA / AMD):
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:8 }}>
                <code style={{
                  color:"var(--yellow)", fontFamily:"JetBrains Mono", fontSize:11,
                  background:"color-mix(in srgb, var(--yellow) 8%, transparent)",
                  border:"1px solid color-mix(in srgb, var(--yellow) 20%, transparent)",
                  borderRadius:4, padding:"4px 10px", display:"inline-block",
                }}>
                  pip uninstall onnxruntime
                </code>
                <code style={{
                  color:"var(--yellow)", fontFamily:"JetBrains Mono", fontSize:11,
                  background:"color-mix(in srgb, var(--yellow) 8%, transparent)",
                  border:"1px solid color-mix(in srgb, var(--yellow) 20%, transparent)",
                  borderRadius:4, padding:"4px 10px", display:"inline-block",
                }}>
                  pip install onnxruntime-directml
                </code>
              </div>
              <div style={{ marginBottom:4 }}>
                NCNN upscaling already uses the GPU automatically via Vulkan.
              </div>
              <div style={{ paddingTop:10, borderTop:"1px solid var(--border)" }}>
                <span style={{ color:"var(--yellow)", fontWeight:500 }}>Out of memory errors?</span>
                {" "}Enable <b style={{ color:"var(--text)" }}>Force CPU</b> above.
              </div>
            </div>
          </Section>

        </div>
      </div>
    </div>
  );
}
