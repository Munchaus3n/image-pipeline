import { useState, useEffect, useCallback } from "react";

const BASE = "/api";

const C = {
  bg:"#0b0d14", panel:"#0f1219", panel2:"#161926",
  border:"#1d2235", text:"#d8e0f0", dim:"#454f6b", dim2:"#262d44",
  green:"#4ade80", blue:"#60a5fa", yellow:"#facc15",
  red:"#f87171", magenta:"#e879f9",
};

// ── Primitives ────────────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{
        fontSize: 10, letterSpacing: "0.12em", fontWeight: 700,
        textTransform: "uppercase", color: C.dim,
        borderBottom: `1px solid ${C.border}`,
        paddingBottom: 6, marginBottom: 14,
      }}>{title}</div>
      {children}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 12, gap: 16 }}>
      <div style={{ width: 200, flexShrink: 0, paddingTop: 6 }}>
        <div style={{ fontSize: 12, color: C.text }}>{label}</div>
        {hint && <div style={{ fontSize: 10, color: C.dim, marginTop: 2, lineHeight: 1.4 }}>{hint}</div>}
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

function Input({ value, onChange, placeholder, type = "text", min, max, step }) {
  return (
    <input
      type={type} value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} min={min} max={max} step={step}
      style={{
        width: "100%", background: C.panel2, color: C.text,
        border: `1px solid ${C.border}`, borderRadius: 4,
        padding: "6px 10px", fontSize: 11, fontFamily: "JetBrains Mono",
        outline: "none", boxSizing: "border-box",
        colorScheme: "dark",
      }}
    />
  );
}

function TextInput({ value, onChange, placeholder }) {
  return (
    <input
      type="text" value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: "100%", background: C.panel2, color: C.text,
        border: `1px solid ${C.border}`, borderRadius: 4,
        padding: "6px 10px", fontSize: 11, fontFamily: "inherit",
        outline: "none", boxSizing: "border-box",
      }}
    />
  );
}

function PasswordInput({ value, onChange, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <input
        type={show ? "text" : "password"} value={value}
        onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{
          flex: 1, background: C.panel2, color: C.text,
          border: `1px solid ${C.border}`, borderRadius: 4,
          padding: "6px 10px", fontSize: 11, fontFamily: "JetBrains Mono",
          outline: "none",
        }}
      />
      <button onClick={() => setShow(v => !v)} style={{
        background: C.panel2, color: C.dim, border: `1px solid ${C.border}`,
        borderRadius: 4, padding: "6px 10px", fontSize: 10,
        cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
      }}>{show ? "Hide" : "Show"}</button>
    </div>
  );
}

function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{
      width: "100%", background: C.panel2, color: C.text,
      border: `1px solid ${C.border}`, borderRadius: 4,
      padding: "6px 10px", fontSize: 11, fontFamily: "inherit",
      outline: "none",
    }}>
      {options.map(([val, label]) => (
        <option key={val} value={val}>{label}</option>
      ))}
    </select>
  );
}

function Toggle({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      <button onClick={() => onChange(true)} style={{
        background: value ? "#0d2818" : "transparent",
        color: value ? C.green : C.dim,
        border: `1px solid ${value ? "#1e4a2e" : "transparent"}`,
        borderRadius: 4, padding: "4px 14px", fontSize: 11,
        cursor: "pointer", fontFamily: "inherit", fontWeight: value ? 600 : 400,
      }}>On</button>
      <button onClick={() => onChange(false)} style={{
        background: !value ? "#2a0d0d" : "transparent",
        color: !value ? C.red : C.dim,
        border: `1px solid ${!value ? "#4a1a1a" : "transparent"}`,
        borderRadius: 4, padding: "4px 14px", fontSize: 11,
        cursor: "pointer", fontFamily: "inherit", fontWeight: !value ? 600 : 400,
      }}>Off</button>
    </div>
  );
}

function SliderField({ label, hint, value, onChange, min, max, step, display }) {
  return (
    <Field label={label} hint={hint}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input
          type="range" min={min} max={max} step={step}
          value={value} onChange={e => onChange(parseFloat(e.target.value))}
          style={{ flex: 1, accentColor: C.green }}
        />
        <span style={{
          fontSize: 11, color: C.text, fontFamily: "JetBrains Mono",
          minWidth: 40, textAlign: "right",
        }}>{display ?? value}</span>
      </div>
    </Field>
  );
}

function TestBtn({ onTest, result }) {
  const [loading, setLoading] = useState(false);
  const run = async () => {
    setLoading(true);
    await onTest();
    setLoading(false);
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
      <button onClick={run} disabled={loading} style={{
        background: C.panel2, color: C.dim,
        border: `1px solid ${C.border}`, borderRadius: 4,
        padding: "5px 14px", fontSize: 11, cursor: loading ? "wait" : "pointer",
        fontFamily: "inherit",
      }}>{loading ? "Testing…" : "Test connection"}</button>
      {result && (
        <span style={{
          fontSize: 11, fontFamily: "JetBrains Mono",
          color: result.ok ? C.green : C.red,
        }}>
          {result.ok ? `✓ Connected (${result.status})` : `✗ Failed (${result.status ?? result.error})`}
        </span>
      )}
    </div>
  );
}

function ColorSwatch({ value, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input
        type="color" value={value} onChange={e => onChange(e.target.value)}
        style={{
          width: 36, height: 30, border: `1px solid ${C.border}`,
          borderRadius: 4, cursor: "pointer", background: "none",
          padding: 2,
        }}
      />
      <input
        type="text" value={value} onChange={e => onChange(e.target.value)}
        style={{
          width: 90, background: C.panel2, color: C.text,
          border: `1px solid ${C.border}`, borderRadius: 4,
          padding: "5px 8px", fontSize: 11, fontFamily: "JetBrains Mono",
          outline: "none",
        }}
      />
      <div style={{
        width: 20, height: 20, borderRadius: "50%",
        background: value, border: `1px solid ${C.border}`,
        flexShrink: 0,
      }} />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const REMBG_MODELS = [
  ["birefnet-general",  "BiRefNet General (best quality)"],
  ["birefnet-portrait", "BiRefNet Portrait (people)"],
  ["u2net",             "U2Net (fast, lighter)"],
  ["u2net_human_seg",   "U2Net Human Seg"],
  ["isnet-general-use", "ISNet General"],
];

const REMBG_PROVIDERS = [
  ["local",    "Local (BiRefNet / rembg)"],
  ["removebg", "Remove.bg"],
  ["clipdrop", "Clipdrop"],
  ["photoroom","PhotoRoom"],
  ["custom",   "Custom API endpoint"],
];

const UPSCALER_PROVIDERS = [
  ["local",     "Local (NCNN Vulkan)"],
  ["replicate", "Replicate"],
  ["custom",    "Custom API endpoint"],
];

export default function Settings() {
  const [s,       setS]       = useState(null);  // full settings object
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [error,   setError]   = useState("");
  const [rembgTest, setRembgTest] = useState(null);
  const [upTest,    setUpTest]    = useState(null);

  // Load on mount
  useEffect(() => {
    fetch(`${BASE}/settings`)
      .then(r => r.json())
      .then(d => setS(d.settings))
      .catch(e => setError(`Failed to load settings: ${e.message}`));
  }, []);

  const set = useCallback((section, key, val) => {
    setS(prev => ({
      ...prev,
      [section]: { ...prev[section], [key]: val },
    }));
  }, []);

  const setGuide = useCallback((zone, key, val) => {
    setS(prev => ({
      ...prev,
      guides: {
        ...(prev.guides || {}),
        [zone]: { ...(prev.guides?.[zone] || {}), [key]: val },
      },
    }));
  }, []);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const r = await fetch(`${BASE}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: s }),
      });
      if (!r.ok) throw new Error((await r.json()).detail);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  };

  const testRembg = async () => {
    try {
      const r = await fetch(`${BASE}/settings/test-rembg`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: s.rembg_api.url, key: s.rembg_api.key }),
      });
      const d = await r.json();
      setRembgTest(d);
    } catch (e) {
      setRembgTest({ ok: false, error: e.message });
    }
  };

  const testUpscaler = async () => {
    try {
      const r = await fetch(`${BASE}/settings/test-upscaler`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: s.upscaler_api.url, key: s.upscaler_api.key }),
      });
      const d = await r.json();
      setUpTest(d);
    } catch (e) {
      setUpTest({ ok: false, error: e.message });
    }
  };

  if (!s) return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      flex: 1, color: C.dim, fontSize: 12, fontFamily: "JetBrains Mono",
    }}>
      {error || "Loading…"}
    </div>
  );

  // Guide zones with their current colors from settings
  const BASE_ZONES = {
    red:     { defaultColor: "#FF0000", top:140,  bottom:1300, left:140,  right:1300 },
    green:   { defaultColor: "#00A300", top:224,  bottom:1216, left:224,  right:1216 },
    blue:    { defaultColor: "#2E2EFF", top:284,  bottom:1156, left:284,  right:1156 },
    magenta: { defaultColor: "#FF2EFF", top:434,  bottom:1006, left:434,  right:1006 },
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column", flex: 1, minHeight: 0,
      fontFamily: "'Outfit','DM Sans',system-ui,sans-serif", color: C.text, fontSize: 13,
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        button:hover{filter:brightness(1.15)} button:active{filter:brightness(0.9)}
        input[type=range]{accent-color:#4ade80}
        ::-webkit-scrollbar{width:5px} ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#1d2235;border-radius:3px}
        ::placeholder{color:#2e3850}
      `}</style>

      {/* Save bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "flex-end",
        gap: 12, padding: "8px 24px",
        borderBottom: `1px solid ${C.border}`,
        background: C.panel, flexShrink: 0,
      }}>
        {error && <span style={{ fontSize: 11, color: C.red, fontFamily: "JetBrains Mono" }}>{error}</span>}
        {saved && <span style={{ fontSize: 11, color: C.green, fontFamily: "JetBrains Mono" }}>✓ Saved</span>}
        <button onClick={save} disabled={saving} style={{
          background: saved ? "#0d2818" : "#0d2818",
          color: C.green, border: `1px solid #1e4a2e`,
          borderRadius: 4, padding: "6px 20px", fontSize: 12, fontWeight: 600,
          cursor: saving ? "wait" : "pointer", fontFamily: "inherit",
        }}>{saving ? "Saving…" : "Save settings"}</button>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px", maxWidth: 860 }}>

        {/* ── Processing ── */}
        <Section title="Processing — Local">
          <Field
            label="Crop padding"
            hint="Padding added around the product after BG removal. 0 = tight crop, 0.1 = 10% padding."
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input type="range" min={0} max={0.2} step={0.005}
                value={s.processing.crop_padding}
                onChange={e => set("processing","crop_padding", parseFloat(e.target.value))}
                style={{ flex:1, accentColor: C.green }}
              />
              <span style={{ fontSize:11, color:C.text, fontFamily:"JetBrains Mono", minWidth:36, textAlign:"right" }}>
                {(s.processing.crop_padding * 100).toFixed(1)}%
              </span>
            </div>
          </Field>

          <Field
            label="Edge blur radius"
            hint="Gaussian blur applied to alpha edge to smooth jagged cutouts. 0 = none, 2 = heavy."
          >
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <input type="range" min={0} max={3} step={0.1}
                value={s.processing.edge_blur}
                onChange={e => set("processing","edge_blur", parseFloat(e.target.value))}
                style={{ flex:1, accentColor: C.green }}
              />
              <span style={{ fontSize:11, color:C.text, fontFamily:"JetBrains Mono", minWidth:36, textAlign:"right" }}>
                {s.processing.edge_blur.toFixed(1)}
              </span>
            </div>
          </Field>

          <Field label="BG removal model" hint="Which local model to use when running BiRefNet.">
            <Select
              value={s.processing.rembg_model}
              onChange={v => set("processing","rembg_model", v)}
              options={REMBG_MODELS}
            />
          </Field>

          <Field label="Keep history runs" hint="Automatically delete oldest history entries beyond this count. 0 = keep all.">
            <Input
              type="number" min={0} max={999} step={1}
              value={s.processing.history_keep}
              onChange={v => set("processing","history_keep", parseInt(v)||0)}
            />
          </Field>
        </Section>

        {/* ── BG Removal API ── */}
        <Section title="Background Removal — External API">
          <Field label="Provider">
            <Select
              value={s.rembg_api.provider}
              onChange={v => set("rembg_api","provider", v)}
              options={REMBG_PROVIDERS}
            />
          </Field>

          {s.rembg_api.provider !== "local" && (<>
            <Field
              label="API endpoint URL"
              hint={
                s.rembg_api.provider === "removebg"  ? "https://api.remove.bg/v1.0/removebg" :
                s.rembg_api.provider === "clipdrop"   ? "https://clipdrop-api.co/remove-background/v1" :
                s.rembg_api.provider === "photoroom"  ? "https://image-api.photoroom.com/v2/segment" :
                s.rembg_api.provider === "replicate"  ? "https://api.replicate.com/v1/predictions" :
                "Full URL of your endpoint. Expects multipart/form-data with 'file' field."
              }
            >
              <TextInput
                value={s.rembg_api.url}
                onChange={v => set("rembg_api","url",v)}
                placeholder="https://api.example.com/remove-bg"
              />
            </Field>

            <Field label="API key">
              <PasswordInput
                value={s.rembg_api.key}
                onChange={v => set("rembg_api","key",v)}
                placeholder="sk-…"
              />
            </Field>

            <Field label="">
              <TestBtn onTest={testRembg} result={rembgTest} />
            </Field>
          </>)}
        </Section>

        {/* ── Upscaler API ── */}
        <Section title="Upscaler — External API">
          <Field label="Provider">
            <Select
              value={s.upscaler_api.provider}
              onChange={v => set("upscaler_api","provider",v)}
              options={UPSCALER_PROVIDERS}
            />
          </Field>

          {s.upscaler_api.provider !== "local" && (<>
            <Field
              label="API endpoint URL"
              hint={
                s.upscaler_api.provider === "replicate"
                  ? "https://api.replicate.com/v1/predictions — model set below"
                  : "Full URL. Expects multipart/form-data with 'file' field, returns upscaled image."
              }
            >
              <TextInput
                value={s.upscaler_api.url}
                onChange={v => set("upscaler_api","url",v)}
                placeholder="https://api.replicate.com/v1/predictions"
              />
            </Field>

            <Field label="API key">
              <PasswordInput
                value={s.upscaler_api.key}
                onChange={v => set("upscaler_api","key",v)}
                placeholder="r8_…"
              />
            </Field>

            <Field label="Model / version" hint="For Replicate: paste the model version hash.">
              <TextInput
                value={s.upscaler_api.model}
                onChange={v => set("upscaler_api","model",v)}
                placeholder="nightmareai/real-esrgan:…"
              />
            </Field>

            <Field label="">
              <TestBtn onTest={testUpscaler} result={upTest} />
            </Field>
          </>)}
        </Section>

        {/* ── Output defaults ── */}
        <Section title="Output defaults">
          <Field label="Default canvas size (px)" hint="Applied to new editor sessions.">
            <div style={{ display:"flex", gap:6 }}>
              {[1080,1440,2048].map(sz => (
                <button key={sz} onClick={() => set("output","canvas_size",sz)} style={{
                  background: s.output.canvas_size===sz ? C.panel2 : "transparent",
                  color:      s.output.canvas_size===sz ? C.text   : C.dim,
                  border: `1px solid ${s.output.canvas_size===sz ? C.border : "transparent"}`,
                  borderRadius:4, padding:"4px 14px", fontSize:11,
                  cursor:"pointer", fontFamily:"inherit",
                  fontWeight: s.output.canvas_size===sz ? 600 : 400,
                }}>{sz}</button>
              ))}
              <Input
                type="number" min={256} max={8192}
                value={s.output.canvas_size}
                onChange={v => set("output","canvas_size", parseInt(v)||1440)}
              />
            </div>
          </Field>

          <Field label="Thumbnail" hint="Generate 400px white-bg JPEG alongside every export.">
            <Toggle value={s.output.thumbnail} onChange={v => set("output","thumbnail",v)} />
          </Field>

          <Field label="Thumbnail size (px)" hint="Pixel size of the generated thumbnail.">
            <Input
              type="number" min={100} max={1200}
              value={s.output.thumbnail_size}
              onChange={v => set("output","thumbnail_size", parseInt(v)||400)}
            />
          </Field>

          <Field label="Default folder mode">
            <div style={{ display:"flex", gap:6 }}>
              {[["bulk","Bulk"],["clean","Clean"]].map(([val,lbl]) => (
                <button key={val} onClick={() => set("output","folder_mode",val)} style={{
                  background: s.output.folder_mode===val ? C.panel2 : "transparent",
                  color:      s.output.folder_mode===val ? C.text   : C.dim,
                  border: `1px solid ${s.output.folder_mode===val ? C.border : "transparent"}`,
                  borderRadius:4, padding:"4px 14px", fontSize:11,
                  cursor:"pointer", fontFamily:"inherit",
                  fontWeight: s.output.folder_mode===val ? 600 : 400,
                }}>{lbl}</button>
              ))}
            </div>
          </Field>
        </Section>

        {/* ── Guide zones ── */}
        <Section title="Guide zones — colors">
          {Object.entries(BASE_ZONES).map(([zone, base]) => {
            const currentColor = s.guides?.[zone]?.color ?? base.defaultColor;
            return (
              <Field key={zone} label={zone.charAt(0).toUpperCase() + zone.slice(1) + " zone"}>
                <ColorSwatch
                  value={currentColor}
                  onChange={v => setGuide(zone,"color",v)}
                />
              </Field>
            );
          })}
          <div style={{ fontSize:10, color:C.dim, marginTop:-6 }}>
            Changes apply after Save + API restart.
          </div>
        </Section>

        {/* ── Appearance ── */}
        <Section title="Appearance">
          <Field
            label="Guide line opacity"
            hint="How visible the dashed guide lines are on the editor canvas."
          >
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <input type="range" min={0.1} max={1.0} step={0.05}
                value={s.appearance.guide_opacity}
                onChange={e => set("appearance","guide_opacity", parseFloat(e.target.value))}
                style={{ flex:1, accentColor: C.green }}
              />
              <span style={{ fontSize:11, color:C.text, fontFamily:"JetBrains Mono", minWidth:36, textAlign:"right" }}>
                {Math.round(s.appearance.guide_opacity * 100)}%
              </span>
            </div>
          </Field>

          <Field
            label="Reference image opacity"
            hint="Opacity of the template reference photo overlaid on the editor canvas."
          >
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <input type="range" min={0.05} max={0.6} step={0.05}
                value={s.appearance.ref_img_opacity}
                onChange={e => set("appearance","ref_img_opacity", parseFloat(e.target.value))}
                style={{ flex:1, accentColor: C.green }}
              />
              <span style={{ fontSize:11, color:C.text, fontFamily:"JetBrains Mono", minWidth:36, textAlign:"right" }}>
                {Math.round(s.appearance.ref_img_opacity * 100)}%
              </span>
            </div>
          </Field>
        </Section>

      </div>
    </div>
  );
}
