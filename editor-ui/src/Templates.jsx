import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { ArrowDownUp, ImagePlus, Plus, Trash2, Upload, X } from "lucide-react";
import ConfirmModal from "./ConfirmModal.jsx";
import PageHeader from "./components/PageHeader.jsx";
import TemplateThumb from "./components/TemplateThumb.jsx";
import {
  Button, IconButton, MenuList, Popover, ResizablePanel, SearchField, SegmentedControl, TextField,
} from "./components/ui/index.jsx";
import { browseFile, imageUrl, templateRefUrl, getTemplates, saveTemplates } from "./api.js";
import { TEMPLATE_SORTS, useTemplateList } from "./hooks/useTemplateList.js";
import { useUiPref } from "./hooks/useUiPref.js";
import { ZONES, zoneColor } from "./utils/zones.js";

const EMPTY_TEMPLATE = { name: "", zone: "green", hint: "", ref_image: "", match: "" };

// Pick a file via native dialog, fetch it from the API, return as base64 data URL.
// This means the image is self-contained in the JSON — no path dependency.
async function browseFileAsBase64() {
  const { path } = await browseFile("", "image");
  if (!path) return "";
  return await fetchPathAsBase64(path);
}

async function fetchPathAsBase64(path) {
  const r = await fetch(imageUrl(path));
  if (!r.ok) return "";
  const blob = await r.blob();
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve("");
    reader.readAsDataURL(blob);
  });
}

// Convert a File object (from drop or input) to base64 data URL
function fileToBase64(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

function shortDate(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const ZONE_OPTIONS = ZONES.map(z => ({ value: z, label: z === "none" ? "None" : z[0].toUpperCase() + z.slice(1), dot: zoneColor(z) }));

// ── Template editor form ──────────────────────────────────────────────────────

function TemplateForm({ tpl, onSave, onCancel, onDelete, isNew }) {
  const [form, setForm] = useState({ ...tpl });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleSave = async () => {
    if (!form.name.trim()) { setError("Name is required."); return; }
    setSaving(true);
    setError("");
    try {
      // onSave resolves false when the user backs out (e.g. declines an overwrite).
      if (await onSave(form) === false) setSaving(false);
    }
    catch (e) { setError(e.message); setSaving(false); }
  };

  // Browse native file dialog → convert to base64
  const browseRef = useCallback(async () => {
    try {
      const b64 = await browseFileAsBase64();
      if (b64) set("ref_image", b64);
    } catch (e) {
      setError(`Browse failed: ${e.message}`);
    }
  }, []);

  const onDragOver = e => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);
  const onDrop = async e => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith("image/")) return;
    const b64 = await fileToBase64(file);
    if (b64) set("ref_image", b64);
  };
  const fileInputRef = useRef(null);
  const onFileInput = async e => {
    const file = e.target.files[0];
    if (!file) return;
    const b64 = await fileToBase64(file);
    if (b64) set("ref_image", b64);
    e.target.value = "";
  };

  const hasImage = form.ref_image && form.ref_image.length > 0;
  // data URL, legacy absolute path, or bare file name in templates/
  const imgSrc = hasImage ? templateRefUrl(form.ref_image) : null;

  return (
    <div className="template-form-panel">
      <div className="template-form-scroll">
        <div className="template-form">
          <h2 className="template-form-title">{isNew ? "New template" : tpl.name}</h2>

          <Field label="Name" htmlFor="tpl-name">
            <TextField id="tpl-name" value={form.name} onChange={e => set("name", e.target.value)}
              placeholder="e.g. Bottle 0.5L" />
          </Field>

          <Field label="Zone">
            <SegmentedControl label="Zone" options={ZONE_OPTIONS} value={form.zone || "none"} onChange={z => set("zone", z)} />
          </Field>

          <Field label="Hint" htmlFor="tpl-hint">
            <TextField id="tpl-hint" value={form.hint} onChange={e => set("hint", e.target.value)}
              placeholder="e.g. Top + bottom touch green lines" />
          </Field>

          <Field
            label="File name match"
            htmlFor="tpl-match"
            help="Comma-separated words. When auto-match is on (Settings), the Editor picks this template for any photo whose file name contains one of them. Spaces, dashes, underscores and letter case are ignored."
          >
            <TextField id="tpl-match" value={form.match || ""} onChange={e => set("match", e.target.value)}
              placeholder="e.g. 26 cm, 26cm plate" />
          </Field>

          <Field label="Reference image">
            <input ref={fileInputRef} type="file" accept="image/*" onChange={onFileInput} hidden />
            <div
              onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
              className={dragging ? "template-dropzone is-dragging" : "template-dropzone"}
            >
              {hasImage ? (
                <div className="template-reference-preview">
                  <img src={imgSrc} alt="Reference" className="template-reference-image"
                    onError={e => { e.target.style.display = "none"; }} />
                  <IconButton
                    icon={X} label="Remove reference image" size="s" variant="secondary"
                    className="template-reference-remove"
                    onClick={() => set("ref_image", "")}
                  />
                </div>
              ) : (
                <div className="template-empty-upload">
                  <ImagePlus size={20} aria-hidden="true" />
                  <span>Drop an image here</span>
                </div>
              )}
            </div>
            <div className="template-inline-actions">
              <Button size="s" icon={Upload} onClick={() => fileInputRef.current?.click()}>
                {hasImage ? "Replace" : "Upload file"}
              </Button>
              <Button size="s" onClick={browseRef}>Browse…</Button>
            </div>
          </Field>

          {error && <div className="template-error" role="alert">{error}</div>}
        </div>
      </div>

      <div className="template-form-actions">
        {!isNew && onDelete && (
          <Button variant="danger" icon={Trash2} onClick={onDelete}>Delete</Button>
        )}
        <span className="template-form-spacer" />
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save template"}
        </Button>
      </div>
    </div>
  );
}

// ── Template list ─────────────────────────────────────────────────────────────

function ZoneFilter({ zones, onChange, counts }) {
  const toggle = (z) => onChange(zones.includes(z) ? zones.filter(x => x !== z) : [...zones, z]);
  return (
    <div className="template-zone-filter" role="group" aria-label="Filter by zone">
      {ZONES.filter(z => z !== "none").map(z => (
        <button
          key={z}
          type="button"
          className={zones.includes(z) ? "template-zone-chip is-on" : "template-zone-chip"}
          aria-pressed={zones.includes(z)}
          title={`${z} zone`}
          onClick={() => toggle(z)}
        >
          <span className="ui-dot" style={{ background: zoneColor(z) }} aria-hidden="true" />
          <span className="template-zone-count">{counts[z] || 0}</span>
        </button>
      ))}
    </div>
  );
}

function TemplateList({
  templates, loading, editing, onSelect, onNew, onDelete,
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useUiPref("templates.sort", "name-asc");
  const [zones, setZones] = useState([]);
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef(null);
  const listRef = useRef(null);

  const total = Object.keys(templates).length;
  const rows = useTemplateList(templates, { query, sort, zones });
  const counts = useMemo(() => {
    const c = {};
    Object.values(templates).forEach(t => { const z = t?.zone || "none"; c[z] = (c[z] || 0) + 1; });
    return c;
  }, [templates]);
  const sortLabel = TEMPLATE_SORTS.find(s => s.value === sort)?.label || "Sort";
  const filtered = query.trim() !== "" || zones.length > 0;
  const showDate = sort === "modified";

  // Keep the selected row in view (e.g. after saving, or when sorting reorders).
  useEffect(() => {
    if (!editing || editing === "new") return;
    listRef.current?.querySelector(".template-row.is-active")?.scrollIntoView({ block: "nearest" });
  }, [editing, sort]);

  const onListKeyDown = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const buttons = [...listRef.current.querySelectorAll(".template-row-main")];
    if (!buttons.length) return;
    const at = buttons.indexOf(document.activeElement);
    let next = at;
    if (e.key === "ArrowDown") next = Math.min(buttons.length - 1, at + 1);
    else if (e.key === "ArrowUp") next = Math.max(0, at - 1);
    else if (e.key === "Home") next = 0;
    else next = buttons.length - 1;
    e.preventDefault();
    buttons[next]?.focus();
  };

  return (
    <>
      <div className="template-list-top">
        <div className="template-list-title">
          <span>Templates</span>
          <span className="ui-badge">{total}</span>
          <span className="template-list-spacer" />
          <IconButton icon={Plus} label="New template" size="s" onClick={onNew} />
        </div>
        <div className="template-list-tools">
          <SearchField value={query} onChange={setQuery} placeholder="Search templates" />
          <IconButton
            ref={sortRef}
            icon={ArrowDownUp}
            variant="secondary"
            label={`Sort: ${sortLabel}`}
            aria-haspopup="listbox"
            aria-expanded={sortOpen}
            onClick={() => setSortOpen(o => !o)}
          />
          <Popover open={sortOpen} onClose={() => setSortOpen(false)} anchorRef={sortRef} width={200} align="end" label="Sort templates">
            <MenuList
              items={TEMPLATE_SORTS}
              value={sort}
              onSelect={(v) => { setSort(v); setSortOpen(false); }}
            />
          </Popover>
        </div>
        <div className="template-list-meta">
          <ZoneFilter zones={zones} onChange={setZones} counts={counts} />
          <span className="template-list-count" aria-live="polite">
            {filtered ? `${rows.length} of ${total}` : sortLabel}
          </span>
        </div>
      </div>

      <div className="template-list-scroll" ref={listRef} onKeyDown={onListKeyDown}>
        {loading ? (
          <div className="template-list-message">Loading…</div>
        ) : total === 0 ? (
          <div className="template-empty-state">
            <strong>No templates yet</strong>
            <span>Create a placement preset for products you place the same way every time.</span>
            <Button variant="primary" icon={Plus} onClick={onNew}>New template</Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="template-empty-state">
            <strong>No templates match</strong>
            <span>Try a different word, or clear the filters.</span>
            <Button onClick={() => { setQuery(""); setZones([]); }}>Clear filters</Button>
          </div>
        ) : (
          <ul className="template-rows">
            {rows.map(({ name, tpl }) => (
              <li key={name} className={editing === name ? "template-row is-active" : "template-row"}>
                <button
                  type="button"
                  className="template-row-main"
                  aria-current={editing === name ? "true" : undefined}
                  onClick={() => onSelect(name)}
                >
                  <span className="ui-dot" style={{ background: zoneColor(tpl.zone) }} aria-hidden="true" />
                  <span className="template-row-text">
                    <span className="template-row-name">{name}</span>
                    <span className="template-row-sub">
                      {tpl.match || tpl.hint || `${tpl.zone || "no"} zone`}
                    </span>
                  </span>
                  {showDate && shortDate(tpl.updated_at || tpl.created_at) ? (
                    <span className="template-row-date">{shortDate(tpl.updated_at || tpl.created_at)}</span>
                  ) : null}
                  {tpl.ref_image ? <TemplateThumb refImage={tpl.ref_image} size={32} /> : <span className="template-thumb is-empty" aria-hidden="true" />}
                </button>
                <IconButton
                  icon={Trash2}
                  label={`Delete ${name}`}
                  size="s"
                  className="template-row-delete"
                  onClick={() => onDelete(name)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Templates() {
  const [templates, setTemplates] = useState({});
  const [editing, setEditing] = useState(null);   // null | "new" | templateName
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(null);
  const overwriteResolverRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getTemplates();
      setTemplates(data.templates || {});
    } catch (e) {
      setStatus(`Load failed: ${e.message}`);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      load();
    }, 0);
    return () => clearTimeout(timeout);
  }, [load]);

  const flash = (message) => {
    setStatus(message);
    setTimeout(() => setStatus(""), 2500);
  };

  const askOverwrite = (name) => new Promise((resolve) => {
    overwriteResolverRef.current = resolve;
    setConfirmOverwrite(name);
  });

  const closeOverwrite = (confirmed) => {
    overwriteResolverRef.current?.(confirmed);
    overwriteResolverRef.current = null;
    setConfirmOverwrite(null);
  };

  const handleSave = async (form) => {
    const key = form.name.trim();
    const previousKey = editing && editing !== "new" ? editing : null;
    // Creating or renaming onto an existing name replaces that template — ask first.
    if (key !== previousKey && Object.prototype.hasOwnProperty.call(templates, key)) {
      if (!await askOverwrite(key)) return false;
    }
    const updated = { ...templates };
    const previous = previousKey ? templates[previousKey] : null;
    if (previousKey && previousKey !== key) delete updated[previousKey];
    const now = new Date().toISOString();
    updated[key] = {
      zone: form.zone,
      hint: form.hint,
      ref_image: form.ref_image,
      match: (form.match || "").trim(),
      // Templates saved before timestamps existed keep an empty created_at.
      created_at: previous ? (previous.created_at || "") : now,
      updated_at: now,
    };
    await saveTemplates(updated);
    window.dispatchEvent(new CustomEvent("cutout-templates-saved"));
    setTemplates(updated);
    setEditing(null);
    flash(previousKey && previousKey !== key ? `Saved "${key}" (renamed from "${previousKey}")` : `Saved "${key}"`);
    return true;
  };

  const confirmDeleteTemplate = async () => {
    if (!confirmDelete) return;
    const updated = { ...templates };
    delete updated[confirmDelete];
    try {
      await saveTemplates(updated);
    } catch (e) {
      setStatus(`Delete failed: ${e.message}`);
      setConfirmDelete(null);
      return;
    }
    window.dispatchEvent(new CustomEvent("cutout-templates-saved"));
    setTemplates(updated);
    setEditing(null);
    flash(`Deleted "${confirmDelete}"`);
    setConfirmDelete(null);
  };

  const editingTemplate = editing === "new"
    ? { ...EMPTY_TEMPLATE }
    : editing
      ? { name: editing, ...(templates[editing] || {}) }
      : null;

  return (
    <div className="templates-screen">
      <PageHeader
        title="Templates"
        subtitle="Placement presets and file-name matching"
        actions={(
          <>
            {status && <span className="template-status" role="status">{status}</span>}
            <Button variant="primary" icon={Plus} onClick={() => setEditing("new")}>New template</Button>
          </>
        )}
      />

      <div className="templates-body">
        <ResizablePanel
          prefKey="templates.list"
          side="left"
          defaultWidth={340}
          min={260}
          max={520}
          className="templates-list-pane"
          aria-label="Template list"
        >
          <TemplateList
            templates={templates}
            loading={loading}
            editing={editing}
            onSelect={setEditing}
            onNew={() => setEditing("new")}
            onDelete={setConfirmDelete}
          />
        </ResizablePanel>

        <div className="templates-edit-pane">
          {editingTemplate ? (
            <TemplateForm
              key={editing}
              tpl={editingTemplate}
              isNew={editing === "new"}
              onSave={handleSave}
              onCancel={() => setEditing(null)}
              onDelete={editing && editing !== "new" ? () => setConfirmDelete(editing) : null}
            />
          ) : (
            <div className="template-editor-empty">
              <strong>Select a template</strong>
              <span>Pick one from the list to edit it, or create a new placement preset.</span>
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        open={Boolean(confirmDelete)}
        title="Delete template?"
        message={confirmDelete ? `Delete "${confirmDelete}"? This cannot be undone.` : ""}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={confirmDeleteTemplate}
        onCancel={() => setConfirmDelete(null)}
      />
      <ConfirmModal
        open={Boolean(confirmOverwrite)}
        title="Replace template?"
        message={confirmOverwrite ? `A template named "${confirmOverwrite}" already exists. Replace it?` : ""}
        confirmLabel="Replace"
        cancelLabel="Cancel"
        tone="default"
        onConfirm={() => closeOverwrite(true)}
        onCancel={() => closeOverwrite(false)}
      />
    </div>
  );
}

function Field({ label, htmlFor, help, children }) {
  return (
    <div className="template-field">
      <label className="template-field-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {help ? <p className="ui-hint">{help}</p> : null}
    </div>
  );
}
