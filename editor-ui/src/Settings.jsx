import { useState, useEffect, useCallback, useRef } from "react";
import { FolderOpen } from "lucide-react";
import { browseFolder, getRembgModels, getSettings, patchSettings } from "./api.js";
import { useDefaultOutputLabel } from "./defaultOutput.js";
import {
  BG_MODEL_OPTIONS, BG_DEVICE_OPTIONS, bgDeviceOption, bgModelInfo, bgModelLabel,
  normalizeBgDeviceMode, upscaleModelInfo,
} from "./modelLabels.js";
import PageHeader from "./components/PageHeader.jsx";
import HowItWorks from "./components/HowItWorks.jsx";
import {
  Button, IconButton, Select as UiSelect, Slider as UiSlider, Switch, TextField,
} from "./components/ui/index.jsx";
import { zoneColor } from "./utils/zones.js";

// A titled card of rows. The section list on the left scrolls to these by id.
function Group({ id, title, description, children, tone = "default" }) {
  return (
    <section id={id} className={`settings-group settings-group-${tone}`}>
      <header className="settings-group-head">
        <h2 className="settings-group-title">{title}</h2>
        {description && <p className="settings-group-description">{description}</p>}
      </header>
      <div className="settings-group-body">{children}</div>
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

function Toggle({ value, onChange, label }) {
  return <Switch checked={!!value} onChange={onChange} aria-label={label} />;
}

function Slider({ value, onChange, min = 0, max = 100, step = 1, decimals = 0, display, parse, suffix, label }) {
  return (
    <UiSlider
      className="settings-slider"
      value={value}
      onChange={onChange}
      min={min}
      max={max}
      step={step}
      decimals={decimals}
      display={display}
      parse={parse}
      suffix={suffix}
      label={label}
    />
  );
}

function opacityPercent(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;

  const percentValue = numericValue <= 1 ? numericValue * 100 : numericValue;
  return Math.max(0, Math.min(100, percentValue));
}

// Opacity may be stored as a fraction (0 to 1) or, in older files, as a percent.
function OpacitySlider({ value, onChange, label }) {
  const usesPercentStorage = Number(value) > 1;
  const fraction = opacityPercent(value) / 100;
  const emit = next => onChange(usesPercentStorage ? Math.round(next * 100) : next);

  return (
    <Slider
      label={label}
      value={fraction}
      min={0}
      max={1}
      step={0.01}
      display={v => Math.round(v * 100)}
      parse={v => v / 100}
      suffix="%"
      onChange={emit}
    />
  );
}

function NumInput({ value, onChange, min, max, width = 88, label }) {
  // While typing, keep the raw text so the field can be cleared and retyped.
  // Only a real number is committed; an empty field never becomes 0.
  const [draft, setDraft] = useState(null);
  return (
    <TextField
      mono
      className="settings-number"
      type="number"
      aria-label={label}
      value={draft ?? value}
      min={min}
      max={max}
      onChange={event => {
        const text = event.target.value;
        setDraft(text);
        const number = Number(text);
        if (text.trim() !== "" && Number.isFinite(number)) onChange(number);
      }}
      onBlur={() => setDraft(null)}
      style={{ width }}
    />
  );
}

function OptionalNumInput({ value, onChange, min, max, width = 88, placeholder = "", label }) {
  const shown = Number(value) > 0 ? String(value) : "";

  return (
    <TextField
      mono
      className="settings-number"
      type="number"
      aria-label={label}
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
      <TextField
        mono
        aria-label={browseLabel}
        value={value}
        placeholder={placeholder}
        title={value}
        onChange={event => onChange(event.target.value)}
      />
      <IconButton
        icon={FolderOpen}
        variant="secondary"
        label={browseLabel}
        onClick={browse}
        disabled={browsing}
      />
    </div>
  );
}

function Select({ value, onChange, options, wide, label }) {
  return (
    <UiSelect
      className={wide ? "settings-select is-wide" : "settings-select"}
      value={value}
      aria-label={label}
      onChange={event => onChange(event.target.value)}
    >
      {options.map(([optionValue, optionLabel]) => (
        <option key={optionValue} value={optionValue}>
          {optionLabel}
        </option>
      ))}
    </UiSelect>
  );
}

const BG_DEVICE_SELECT_OPTIONS = BG_DEVICE_OPTIONS.map(option => [option.value, option.label]);

const SECTIONS = [
  ["settings-info", "How it works"],
  ["settings-paths", "Workspace paths"],
  ["settings-appearance", "Appearance"],
  ["settings-safety", "Safety"],
  ["settings-processing", "Processing defaults"],
  ["settings-bg", "Background removal"],
  ["settings-guides", "Guides"],
];

function normalizeSettings(rawSettings) {
  const next = rawSettings || DEFAULT;
  const processing = next.processing || {};
  const bgDeviceMode = normalizeBgDeviceMode(processing.bg_device_mode, processing);
  return {
    ...next,
    processing: {
      ...processing,
      bg_device_mode: bgDeviceMode,
      force_cpu: bgDeviceMode === "cpu",
    },
  };
}

// Only the keys that differ from what was loaded/saved, per section. The server
// deep-merges this patch, so values changed elsewhere since load (recent folders,
// theme toggle, Editor thumbnail switch) are not overwritten by this page's stale copy.
function changedSettings(current, baseline) {
  const patch = {};
  for (const [section, values] of Object.entries(current)) {
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      if (JSON.stringify(values) !== JSON.stringify(baseline?.[section])) patch[section] = values;
      continue;
    }
    const baseSection = baseline?.[section] ?? {};
    for (const [key, value] of Object.entries(values)) {
      if (JSON.stringify(value) === JSON.stringify(baseSection[key])) continue;
      patch[section] = { ...(patch[section] || {}), [key]: value };
    }
  }
  return patch;
}

const DEFAULT = {
  processing: { crop_padding: 0.04, edge_blur: 1.2, edge_mode: "soft", decontaminate: true, upscale_model: "fast", rembg_model: "birefnet-general", bg_device_mode: "cpu", force_cpu: true, wipe_input_after_run: false, upscale_max_px: 0 },
  output: { canvas_size: 1440, thumbnail: true, thumbnail_size: 400, folder_mode: "bulk", input_dir: "", output_dir: "", do_upscale: true, do_rembg: true, upscale_scale: "2" },
  appearance: { guide_opacity: 1.0, ref_img_opacity: 0.05, canvas_bg_color: "#ffffff", theme: "dark" },
  guides: { use_custom: false, custom: {} },
  editor: { auto_template_match: true },
};

export default function Settings({ onThemeChange }) {
  const defaultOutputLabel = useDefaultOutputLabel();
  const [settings, setSettings] = useState(DEFAULT);
  const [status, setStatus] = useState("");
  const [dirty, setDirty] = useState(false);
  // Last settings loaded from / saved to the server; save() sends only the difference.
  const baselineRef = useRef(DEFAULT);
  const statusTimerRef = useRef(null);
  useEffect(() => () => window.clearTimeout(statusTimerRef.current), []);
  // The backend decides which models exist; the built-in list is shown until it answers.
  const [bgModelOptions, setBgModelOptions] = useState(BG_MODEL_OPTIONS);

  useEffect(() => {
    getRembgModels()
      .then(data => {
        if (Array.isArray(data?.models) && data.models.length) {
          setBgModelOptions(data.models.map(id => [id, bgModelLabel(id)]));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    getSettings()
      .then(saved => {
        if (!saved) return;
        const normalized = normalizeSettings(saved);
        baselineRef.current = normalized;
        setSettings(normalized);
      })
      .catch(() => {});
  }, []);

  const setSetting = useCallback((section, key, value) => {
    setSettings(previous => {
      const nextSection = { ...previous[section], [key]: value };
      if (section === "processing" && key === "bg_device_mode") {
        const bgDeviceMode = normalizeBgDeviceMode(value, nextSection);
        nextSection.bg_device_mode = bgDeviceMode;
        nextSection.force_cpu = bgDeviceMode === "cpu";
      }
      return { ...previous, [section]: nextSection };
    });
    setDirty(true);
    if (section === "appearance" && key === "theme" && onThemeChange) onThemeChange(value);
  }, [onThemeChange]);

  const save = useCallback(async () => {
    try {
      const patch = changedSettings(settings, baselineRef.current);
      if (Object.keys(patch).length) await patchSettings(patch);
      baselineRef.current = settings;
      window.dispatchEvent(new CustomEvent("cutout-settings-saved", { detail: { settings } }));
      setStatus("Saved");
      setDirty(false);
      // One timer, so an older "clear" cannot wipe a newer message.
      window.clearTimeout(statusTimerRef.current);
      statusTimerRef.current = window.setTimeout(() => setStatus(""), 2000);
    } catch {
      setStatus("Save failed");
    }
  }, [settings]);

  const reset = useCallback(() => {
    setSettings(normalizeSettings(DEFAULT));
    setDirty(true);
    // The theme is applied live elsewhere, so the screen has to follow the reset too.
    if (onThemeChange) onThemeChange(DEFAULT.appearance.theme);
  }, [onThemeChange]);

  const goToSection = (id) => {
    document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <div className="settings-screen">
      <PageHeader
        title="Settings"
        subtitle="Defaults, appearance and safety options"
        className="settings-app-header"
        actions={(
          <>
            {status && (
              <span className={status === "Saved" ? "settings-status is-ok" : "settings-status is-error"} role="status">
                {status}
              </span>
            )}
            {dirty && <span className="settings-unsaved">Unsaved changes</span>}
            <Button variant="ghost" onClick={reset} title="Fill the form with the built-in defaults. Nothing is saved until you press Save.">
              Reset to defaults
            </Button>
            <Button variant="primary" onClick={save} disabled={!dirty}>
              Save settings
            </Button>
          </>
        )}
      />

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map(([id, label]) => (
            <button key={id} type="button" className="settings-nav-item" onClick={() => goToSection(id)}>
              {label}
            </button>
          ))}
        </nav>

        <main className="settings-body">
          <div className="settings-content">
            <Group
              id="settings-info"
              title="How it works"
              description="A short guide to the screens and models, for anyone new to the app."
            >
              <HowItWorks />
            </Group>

            <Group
              id="settings-paths"
              title="Workspace paths"
              description="Default folders used when the app starts."
            >
              <Row label="Default input folder" hint="Leave blank to use ./input.">
                <FolderPathInput
                  value={settings.output.input_dir || ""}
                  placeholder="blank = ./input"
                  browseLabel="Browse input folder"
                  onChange={value => setSetting("output", "input_dir", value)}
                />
              </Row>
              <Row label="Default output folder" hint={`Leave blank to use ${defaultOutputLabel}.`}>
                <FolderPathInput
                  value={settings.output.output_dir || ""}
                  placeholder={`blank = ${defaultOutputLabel}`}
                  browseLabel="Browse output folder"
                  onChange={value => setSetting("output", "output_dir", value)}
                />
              </Row>
              <Row label="Folder mode" hint="Default processing folder layout.">
                <Select
                  label="Folder mode"
                  value={settings.output.folder_mode}
                  onChange={value => setSetting("output", "folder_mode", value)}
                  options={[["bulk", "Bulk - flat folder"], ["clean", "Clean - subfolders"]]}
                />
              </Row>
            </Group>

            <Group
              id="settings-appearance"
              title="Appearance"
              description="Theme and editor display defaults."
            >
              <Row label="Theme">
                <Select
                  label="Theme"
                  value={settings.appearance.theme || "dark"}
                  onChange={value => setSetting("appearance", "theme", value)}
                  options={[["dark", "Dark"], ["light", "Light"]]}
                />
              </Row>
              <Row label="Canvas background" hint="Preview only. Saved images always keep a transparent background.">
                <div className="settings-color-group">
                  <input
                    className="settings-color-input"
                    type="color"
                    aria-label="Canvas background color"
                    value={settings.appearance.canvas_bg_color || "#ffffff"}
                    onChange={event => setSetting("appearance", "canvas_bg_color", event.target.value)}
                  />
                  <TextField
                    mono
                    className="settings-hex"
                    aria-label="Canvas background hex"
                    value={settings.appearance.canvas_bg_color || "#ffffff"}
                    maxLength={7}
                    onChange={event => {
                      const value = event.target.value;
                      if (/^#[0-9a-fA-F]{0,6}$/.test(value)) setSetting("appearance", "canvas_bg_color", value);
                    }}
                  />
                </div>
              </Row>
              <Row label="Guide opacity">
                <OpacitySlider
                  label="Guide opacity"
                  value={settings.appearance.guide_opacity}
                  onChange={value => setSetting("appearance", "guide_opacity", value)}
                />
              </Row>
              <Row label="Reference image opacity">
                <OpacitySlider
                  label="Reference image opacity"
                  value={settings.appearance.ref_img_opacity}
                  onChange={value => setSetting("appearance", "ref_img_opacity", value)}
                />
              </Row>
            </Group>

            <Group
              id="settings-safety"
              title="Safety"
              description="Options that can remove or reset work."
              tone="warning"
            >
              <Row
                label="Wipe input after run"
                hint="When enabled, source files can be deleted after processing completes. Leave off unless the input folder is disposable."
                tone="warning"
              >
                <Toggle
                  label="Wipe input after run"
                  value={!!settings.processing.wipe_input_after_run}
                  onChange={value => setSetting("processing", "wipe_input_after_run", value)}
                />
              </Row>
            </Group>

            <Group
              id="settings-processing"
              title="Processing defaults"
              description="Defaults used by Process and Editor."
            >
              <Row label="Canvas size (px)">
                <NumInput
                  label="Canvas size"
                  value={settings.output.canvas_size}
                  min={256}
                  max={8192}
                  onChange={value => setSetting("output", "canvas_size", value)}
                />
              </Row>
              <Row label="Thumbnail" hint="Generate resized preview on save.">
                <Toggle
                  label="Thumbnail"
                  value={settings.output.thumbnail}
                  onChange={value => setSetting("output", "thumbnail", value)}
                />
              </Row>
              {settings.output.thumbnail && (
                <Row label="Thumbnail size (px)" hint="Width and height of generated preview.">
                  <NumInput
                    label="Thumbnail size"
                    value={settings.output.thumbnail_size || 400}
                    min={64}
                    max={2048}
                    onChange={value => setSetting("output", "thumbnail_size", value)}
                  />
                </Row>
              )}
              <Row
                label="Auto-match template"
                hint="In the Editor, pick the template whose file-name words (set on the Templates screen) appear in the photo's name."
              >
                <Toggle
                  label="Auto-match template"
                  value={settings.editor?.auto_template_match ?? true}
                  onChange={value => setSetting("editor", "auto_template_match", value)}
                />
              </Row>
              <Row label="Default upscale">
                <Toggle
                  label="Default upscale"
                  value={settings.output.do_upscale ?? true}
                  onChange={value => setSetting("output", "do_upscale", value)}
                />
              </Row>
              <Row label="Default remove BG">
                <Toggle
                  label="Default remove BG"
                  value={settings.output.do_rembg ?? true}
                  onChange={value => setSetting("output", "do_rembg", value)}
                />
              </Row>
              {(settings.output.do_upscale ?? true) && (
                <Row label="Default upscale factor">
                  <Select
                    label="Default upscale factor"
                    value={settings.output.upscale_scale || "2"}
                    onChange={value => setSetting("output", "upscale_scale", value)}
                    options={[["2", "2x"], ["4", "4x"]]}
                  />
                </Row>
              )}
              {(settings.output.do_upscale ?? true) && (settings.output.upscale_scale || "2") === "2" && (
                <Row
                  label="2x upscale quality"
                  hint={(() => {
                    const info = upscaleModelInfo(settings.processing.upscale_model || "fast");
                    return `${info.bestFor} Avoid when: ${info.avoidWhen}`;
                  })()}
                >
                  <Select
                    label="2x upscale quality"
                    value={settings.processing.upscale_model || "fast"}
                    onChange={value => setSetting("processing", "upscale_model", value)}
                    options={[["fast", "Fast"], ["quality", "Quality (slow)"]]}
                  />
                </Row>
              )}
              <Row label="Skip upscale if any side is at least" hint="Photos already this large are not upscaled. Empty uses the default (3600 px).">
                <div className="settings-inline">
                  <OptionalNumInput
                    label="Skip upscale threshold"
                    value={settings.processing.upscale_max_px}
                    min={256}
                    max={8192}
                    placeholder="3600"
                    onChange={value => setSetting("processing", "upscale_max_px", value)}
                  />
                  <span className="settings-unit">px</span>
                </div>
              </Row>
            </Group>

            <Group
              id="settings-bg"
              title="Background removal"
              description="Model and mask cleanup preferences."
            >
              <Row
                label="Model"
                hint={`${bgModelInfo(settings.processing.rembg_model).bestFor} Avoid when: ${bgModelInfo(settings.processing.rembg_model).avoidWhen}`}
              >
                <Select
                  label="Background removal model"
                  value={settings.processing.rembg_model}
                  onChange={value => setSetting("processing", "rembg_model", value)}
                  wide
                  options={bgModelOptions}
                />
              </Row>
              <Row
                label="Background removal device"
                hint={bgDeviceOption(normalizeBgDeviceMode(settings.processing.bg_device_mode, settings.processing)).help}
              >
                <Select
                  label="Background removal device"
                  value={normalizeBgDeviceMode(settings.processing.bg_device_mode, settings.processing)}
                  onChange={value => setSetting("processing", "bg_device_mode", value)}
                  options={BG_DEVICE_SELECT_OPTIONS}
                  wide
                />
              </Row>
              <Row label="Crop padding" hint="Fraction added after crop.">
                <Slider
                  label="Crop padding"
                  value={settings.processing.crop_padding}
                  min={0}
                  max={0.2}
                  step={0.005}
                  decimals={1}
                  display={v => v * 100}
                  parse={v => v / 100}
                  suffix="%"
                  onChange={value => setSetting("processing", "crop_padding", value)}
                />
              </Row>
              <Row
                label="Edge style"
                hint={(settings.processing.edge_mode || "soft") === "hard"
                  ? "Crisp edge with 1 px anti-aliasing. Best for packaging; can drop semi-transparent areas such as glass."
                  : "Soft feathered edge that never grows past the detected outline."}
              >
                <Select
                  label="Edge style"
                  value={settings.processing.edge_mode || "soft"}
                  onChange={value => setSetting("processing", "edge_mode", value)}
                  options={[["soft", "Soft"], ["hard", "Hard"]]}
                />
              </Row>
              {(settings.processing.edge_mode || "soft") === "soft" && (
                <Row label="Edge blur radius" hint="Feather width for the soft style. 0 = off.">
                  <Slider
                    label="Edge blur radius"
                    value={settings.processing.edge_blur}
                    min={0}
                    max={5}
                    step={0.1}
                    decimals={1}
                    onChange={value => setSetting("processing", "edge_blur", value)}
                  />
                </Row>
              )}
              <Row label="Remove edge colour fringe" hint="Replaces the old background colour left on edge pixels. About 1 s per image.">
                <Toggle
                  label="Remove edge colour fringe"
                  value={settings.processing.decontaminate ?? true}
                  onChange={value => setSetting("processing", "decontaminate", value)}
                />
              </Row>
            </Group>

            <Group
              id="settings-guides"
              title="Guides"
              description="Optional manual guide overrides."
            >
              <Row label="Use custom guides" hint="Override config.ini.">
                <Toggle
                  label="Use custom guides"
                  value={!!settings.guides?.use_custom}
                  onChange={value => setSetting("guides", "use_custom", value)}
                />
              </Row>
              <div className="settings-guides">
                {["green", "blue", "magenta", "red"].map(zone => (
                  <div key={zone} className="settings-guide-block">
                    <div className="settings-guide-title">
                      <span className="ui-dot" style={{ background: zoneColor(zone) }} aria-hidden="true" />
                      {zone[0].toUpperCase() + zone.slice(1)} guide
                    </div>
                    <div className="settings-guide-grid">
                      {["top", "bottom", "left", "right"].map(position => (
                        <label key={position} className="settings-guide-field">
                          <span>{position}</span>
                          <NumInput
                            width={72}
                            label={`${zone} guide ${position}`}
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
              </div>
            </Group>
          </div>
        </main>
      </div>
    </div>
  );
}
