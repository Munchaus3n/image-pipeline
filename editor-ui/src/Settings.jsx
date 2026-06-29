import { useState, useEffect, useCallback } from "react";
import { browseFolder } from "./api";

const BASE = "/api";

function Section({ title, description, children, defaultOpen = false, tone = "default" }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`settings-section settings-section-${tone}`}>
      <button
        type="button"
        className="settings-section-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="settings-section-copy">
          <span className="settings-section-title">{title}</span>
          {description && <span className="settings-section-description">{description}</span>}
        </span>
        <span className="settings-section-arrow" aria-hidden="true" />
      </button>
      <div className={open ? "settings-section-body is-open" : "settings-section-body"} aria-hidden={!open}>
        <div className="settings-section-body-inner">{children}</div>
      </div>
    </section>
  );
}

function Row({ label, hint, children, tone = "default" }) {
  return (
    <div className={`settings-row settings-row-${tone}`}>
      <div className="settings-row-copy">
        <div className="settings-row-label">{label}</div>
        {hint && <div className="settings-row-hint">{hint}</div>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function Toggle({ value, onChange, tone = "default" }) {
  return (
    <button
      type="button"
      className={`settings-toggle settings-toggle-${tone}${value ? " is-on" : " is-off"}`}
      onClick={() => onChange(!value)}
      aria-pressed={value}
    >
      <span className="settings-toggle-thumb" />
    </button>
  );
}

function Slider({ value, onChange, min = 0, max = 100, step = 1, format = value => `${value}%` }) {
  return (
    <div className="settings-slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={event => onChange(parseFloat(event.target.value))}
      />
      <span>{format(value)}</span>
    </div>
  );
}

function opacityPercent(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;

  const percentValue = numericValue <= 1 ? numericValue * 100 : numericValue;
  return Math.max(0, Math.min(100, percentValue));
}

function OpacitySlider({ value, onChange }) {
  const displayValue = opacityPercent(value);
  const usesPercentStorage = Number(value) > 1;

  return (
    <Slider
      value={displayValue}
      min={0}
      max={100}
      step={1}
      onChange={nextPercent => onChange(usesPercentStorage ? nextPercent : nextPercent / 100)}
      format={nextValue => `${Math.round(opacityPercent(nextValue))}%`}
    />
  );
}

function NumInput({ value, onChange, min, max, width = 80 }) {
  return (
    <input
      className="settings-number-input"
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={event => onChange(Number(event.target.value))}
      style={{ width }}
    />
  );
}

function OptionalNumInput({ value, onChange, min, max, width = 80, placeholder = "" }) {
  const shown = Number(value) > 0 ? String(value) : "";

  return (
    <input
      className="settings-number-input"
      type="number"
      value={shown}
      min={min}
      max={max}
      placeholder={placeholder}
      onChange={event => {
        const raw = event.target.value.trim();
        onChange(raw === "" ? 0 : Number(raw));
      }}
      style={{ width }}
    />
  );
}

function TextInput({ value, onChange, placeholder, width = 240, mono = true, maxLength }) {
  return (
    <input
      className={mono ? "settings-text-input settings-mono-input" : "settings-text-input"}
      type="text"
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={event => onChange(event.target.value)}
      style={{ width }}
    />
  );
}

function FolderPathInput({ value, onChange, placeholder, browseLabel }) {
  const [browsing, setBrowsing] = useState(false);

  const browse = useCallback(async () => {
    setBrowsing(true);
    try {
      const result = await browseFolder(value || "");
      if (result?.path) onChange(result.path);
    } catch {
      void 0;
    } finally {
      setBrowsing(false);
    }
  }, [onChange, value]);

  return (
    <div className="settings-path-control">
      <TextInput
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        width="100%"
      />
      <button
        type="button"
        className="settings-path-browse"
        onClick={browse}
        disabled={browsing}
        title={browseLabel}
        aria-label={browseLabel}
      >
        ...
      </button>
    </div>
  );
}

function Select({ value, onChange, options, wide }) {
  return (
    <select
      className="settings-select"
      value={value}
      onChange={event => onChange(event.target.value)}
      style={{ minWidth: wide ? 260 : 140 }}
    >
      {options.map(([optionValue, label]) => (
        <option key={optionValue} value={optionValue}>
          {label}
        </option>
      ))}
    </select>
  );
}

const DEFAULT = {
  processing: { crop_padding: 0.04, edge_blur: 1.2, rembg_model: "birefnet-general", history_keep: 30, force_cpu: false, wipe_input_after_run: false, upscale_max_px: 0 },
  rembg_api: { provider: "local", url: "", key: "" },
  upscaler_api: { provider: "local", url: "", key: "", model: "" },
  output: { canvas_size: 1440, thumbnail: true, thumbnail_size: 400, folder_mode: "bulk", input_dir: "", output_dir: "", do_upscale: true, do_rembg: true, upscale_scale: "2" },
  appearance: { guide_opacity: 1.0, ref_img_opacity: 0.05, canvas_bg_color: "#ffffff", theme: "dark" },
  guides: { use_custom: false, custom: {} },
};

export default function Settings({ onThemeChange }) {
  const [settings, setSettings] = useState(DEFAULT);
  const [status, setStatus] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/settings`)
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (data?.settings) setSettings(data.settings); })
      .catch(() => {});
  }, []);

  const setSetting = useCallback((section, key, value) => {
    setSettings(previous => ({ ...previous, [section]: { ...previous[section], [key]: value } }));
    setDirty(true);
    if (section === "appearance" && key === "theme" && onThemeChange) onThemeChange(value);
  }, [onThemeChange]);

  const save = useCallback(async () => {
    try {
      const response = await fetch(`${BASE}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });

      if (response.ok) {
        setStatus("Saved");
        setDirty(false);
        setTimeout(() => setStatus(""), 2000);
      } else {
        setStatus("Save failed");
      }
    } catch {
      setStatus("Save failed");
    }
  }, [settings]);

  const reset = useCallback(() => {
    setSettings(DEFAULT);
    setDirty(true);
  }, []);

  return (
    <div className="settings-screen">
      <style>{`
        [data-theme="dark"] select option { background: hsl(222,20%,16%); color: hsl(210,40%,95%); }
        [data-theme="light"] select option { background: hsl(220,14%,94%); color: hsl(224,20%,15%); }
        select option { background: var(--panel2); color: var(--text); }
      `}</style>

      <header className="settings-header">
        <div className="settings-title-group">
          <h1 className="settings-title">Settings &middot; Workspace</h1>
          <p className="settings-subtitle">Configure defaults, appearance, and safety options.</p>
        </div>
        <div className="settings-actions">
          {status && (
            <span className={status === "Saved" ? "settings-status is-ok" : "settings-status is-error"}>
              {status}
            </span>
          )}
          <button
            type="button"
            className={dirty ? "settings-button settings-button-warning" : "settings-button settings-button-secondary"}
            onClick={reset}
          >
            Reset Draft
          </button>
          <button
            type="button"
            className={dirty ? "settings-button settings-button-primary" : "settings-button settings-button-secondary"}
            onClick={save}
          >
            Save Settings
          </button>
        </div>
      </header>

      <main className="settings-body">
        <div className="settings-grid">
          <div className="settings-column">
            <Section
              title="Workspace Paths"
              description="Default folders used when the app starts."
              defaultOpen
            >
              <Row label="Default input folder" hint="Leave blank to use ./input.">
                <FolderPathInput
                  value={settings.output.input_dir || ""}
                  placeholder="blank = ./input"
                  browseLabel="Browse input folder"
                  onChange={value => setSetting("output", "input_dir", value)}
                />
              </Row>
              <Row label="Default output folder" hint="Leave blank to use ./output.">
                <FolderPathInput
                  value={settings.output.output_dir || ""}
                  placeholder="blank = ./output"
                  browseLabel="Browse output folder"
                  onChange={value => setSetting("output", "output_dir", value)}
                />
              </Row>
              <Row label="Folder mode" hint="Default processing folder layout.">
                <Select
                  value={settings.output.folder_mode}
                  onChange={value => setSetting("output", "folder_mode", value)}
                  options={[["bulk", "Bulk - flat folder"], ["clean", "Clean - subfolders"]]}
                />
              </Row>
            </Section>

            <Section
              title="Appearance"
              description="Theme and editor display defaults."
              defaultOpen
            >
              <Row label="Theme" hint="Theme selection is still persisted through settings.">
                <Select
                  value={settings.appearance.theme || "dark"}
                  onChange={value => setSetting("appearance", "theme", value)}
                  options={[["dark", "Dark"], ["light", "Light"]]}
                />
              </Row>
              <Row label="Canvas background">
                <div className="settings-color-group">
                  <input
                    className="settings-color-input"
                    type="color"
                    value={settings.appearance.canvas_bg_color || "#ffffff"}
                    onChange={event => setSetting("appearance", "canvas_bg_color", event.target.value)}
                  />
                  <TextInput
                    value={settings.appearance.canvas_bg_color || "#ffffff"}
                    maxLength={7}
                    width={88}
                    onChange={value => {
                      if (/^#[0-9a-fA-F]{0,6}$/.test(value)) setSetting("appearance", "canvas_bg_color", value);
                    }}
                  />
                </div>
              </Row>
              <Row label="Guide opacity">
                <OpacitySlider
                  value={settings.appearance.guide_opacity}
                  onChange={value => setSetting("appearance", "guide_opacity", value)}
                />
              </Row>
              <Row label="Reference image opacity">
                <OpacitySlider
                  value={settings.appearance.ref_img_opacity}
                  onChange={value => setSetting("appearance", "ref_img_opacity", value)}
                />
              </Row>
            </Section>

            <Section
              title="Safety"
              description="Options that can remove or reset work."
              defaultOpen
              tone="warning"
            >
              <Row
                label="Wipe input after run"
                hint="When enabled, source files can be deleted after processing completes. Leave off unless the input folder is disposable."
                tone="warning"
              >
                <Toggle
                  value={!!settings.processing.wipe_input_after_run}
                  onChange={value => setSetting("processing", "wipe_input_after_run", value)}
                  tone="warning"
                />
              </Row>
            </Section>
          </div>

          <div className="settings-column">
            <Section
              title="Processing Defaults"
              description="Defaults used by Process and Editor."
              defaultOpen
            >
              <Row label="Canvas size (px)">
                <NumInput
                  value={settings.output.canvas_size}
                  min={256}
                  max={8192}
                  onChange={value => setSetting("output", "canvas_size", value)}
                />
              </Row>
              <Row label="Thumbnail" hint="Generate resized preview on save.">
                <Toggle
                  value={settings.output.thumbnail}
                  onChange={value => setSetting("output", "thumbnail", value)}
                />
              </Row>
              {settings.output.thumbnail && (
                <Row label="Thumbnail size (px)" hint="Width and height of generated preview.">
                  <NumInput
                    value={settings.output.thumbnail_size || 400}
                    min={64}
                    max={2048}
                    onChange={value => setSetting("output", "thumbnail_size", value)}
                  />
                </Row>
              )}
              <Row label="Default upscale">
                <Toggle
                  value={settings.output.do_upscale ?? true}
                  onChange={value => setSetting("output", "do_upscale", value)}
                />
              </Row>
              <Row label="Default remove BG">
                <Toggle
                  value={settings.output.do_rembg ?? true}
                  onChange={value => setSetting("output", "do_rembg", value)}
                />
              </Row>
              {(settings.output.do_upscale ?? true) && (
                <Row label="Default upscale factor">
                  <Select
                    value={settings.output.upscale_scale || "2"}
                    onChange={value => setSetting("output", "upscale_scale", value)}
                    options={[["2", "2x"], ["4", "4x"]]}
                  />
                </Row>
              )}
              <Row label="Skip upscale if any side >=" hint="Empty means no quality skip rule.">
                <OptionalNumInput
                  value={settings.processing.upscale_max_px}
                  min={512}
                  max={8192}
                  placeholder="no skip"
                  onChange={value => setSetting("processing", "upscale_max_px", value)}
                />
                <span className="settings-unit">px</span>
              </Row>
            </Section>

            <Section
              title="Background Removal"
              description="Model and mask cleanup preferences."
            >
              <Row label="Model">
                <Select
                  value={settings.processing.rembg_model}
                  onChange={value => setSetting("processing", "rembg_model", value)}
                  wide
                  options={[
                    ["birefnet-general", "birefnet-general (recommended)"],
                    ["birefnet-general-lite", "birefnet-general-lite (faster)"],
                    ["birefnet-massive", "birefnet-massive (high quality)"],
                    ["birefnet-dis", "birefnet-dis (illustration)"],
                    ["birefnet-hrsod", "birefnet-hrsod (salient object)"],
                    ["bria-rmbg", "BRIA RMBG-2.0 (non-commercial)"],
                  ]}
                />
              </Row>
              <Row label="Force CPU" hint="Skip DirectML/CUDA. GPU OOM fallback to CPU is automatic.">
                <Toggle
                  value={settings.processing.force_cpu ?? false}
                  onChange={value => setSetting("processing", "force_cpu", value)}
                />
              </Row>
              <Row label="Crop padding" hint="Fraction added after crop.">
                <Slider
                  value={settings.processing.crop_padding}
                  min={0}
                  max={0.2}
                  step={0.005}
                  onChange={value => setSetting("processing", "crop_padding", value)}
                  format={value => `${(value * 100).toFixed(1)}%`}
                />
              </Row>
              <Row label="Edge blur radius" hint="0 = off.">
                <Slider
                  value={settings.processing.edge_blur}
                  min={0}
                  max={5}
                  step={0.1}
                  onChange={value => setSetting("processing", "edge_blur", value)}
                  format={value => value.toFixed(1)}
                />
              </Row>
              <Row label="History folders to keep">
                <NumInput
                  value={settings.processing.history_keep}
                  min={1}
                  max={200}
                  width={64}
                  onChange={value => setSetting("processing", "history_keep", value)}
                />
              </Row>
            </Section>

            <Section
              title="Guides"
              description="Optional manual guide overrides."
            >
              <Row label="Use custom guides" hint="Override config.ini.">
                <Toggle
                  value={!!settings.guides?.use_custom}
                  onChange={value => setSetting("guides", "use_custom", value)}
                />
              </Row>
              {["green", "blue", "magenta", "red"].map(zone => (
                <div key={zone} className="settings-guide-block">
                  <div className="settings-guide-title">{zone} guide</div>
                  <div className="settings-guide-grid">
                    {["top", "bottom", "left", "right"].map(position => (
                      <label key={position} className="settings-guide-field">
                        <span>{position}</span>
                        <NumInput
                          width={60}
                          value={Number(settings.guides?.custom?.[zone]?.[position] ?? 0)}
                          onChange={value => setSetting("guides", "custom", {
                            ...(settings.guides?.custom || {}),
                            [zone]: { ...(settings.guides?.custom?.[zone] || {}), [position]: value },
                          })}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </Section>
          </div>
        </div>
      </main>
    </div>
  );
}
