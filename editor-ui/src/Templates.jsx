import { useState, useEffect, useCallback, useRef } from "react";
import ConfirmModal from "./ConfirmModal.jsx";
import { browseFile } from "./api.js";
import { apiBase } from "./runtime.js";

const BASE = apiBase();

const C = {
  bg:      "var(--bg)",      panel:   "var(--panel)",   panel2:  "var(--panel2)",
  border:  "var(--border)",  text:    "var(--text)",    dim:     "var(--dim)",
  dim2:    "var(--dim2)",    accent:  "var(--accent)",
  green:   "var(--green)",   blue:    "var(--accent)",
  yellow:  "var(--yellow)",  red:     "var(--red)",     magenta: "var(--magenta)",
};

const ZONES = ["none", "green", "blue", "magenta", "red"];
const ZONE_COLOR = { none: C.dim, green: C.green, blue: C.blue, magenta: C.magenta, red: C.red };

const EMPTY_TEMPLATE = { name: "", zone: "green", hint: "", ref_image: "" };

async function apiGet(path) {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json();
}

async function apiPost(path, body) {
  const r = await fetch(BASE + path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}`);
  return r.json();
}

// Pick a file via native dialog, fetch it from the API, return as base64 data URL.
// This means the image is self-contained in the JSON — no path dependency.
async function browseFileAsBase64() {
  const { path } = await browseFile("", "image");
  if (!path) return "";
  return await fetchPathAsBase64(path);
}

async function fetchPathAsBase64(path) {
  const r = await fetch(`${BASE}/image?path=${encodeURIComponent(path)}`);
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
    try { await onSave(form); }
    catch (e) { setError(e.message); setSaving(false); }
  };

  // Browse native file dialog → convert to base64
  const browseRef = useCallback(async () => {
    const b64 = await browseFileAsBase64();
    if (b64) set("ref_image", b64);
  }, []);

  // Drag & drop handlers
  const onDragOver = e => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);
  const onDrop = async e => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith("image/")) return;
    const b64 = await fileToBase64(file);
    if (b64) set("ref_image", b64);
  };
  // Click-to-upload via hidden input
  const fileInputRef = useRef(null);
  const onFileInput = async e => {
    const file = e.target.files[0];
    if (!file) return;
    const b64 = await fileToBase64(file);
    if (b64) set("ref_image", b64);
    e.target.value = "";
  };

  const hasImage = form.ref_image && form.ref_image.length > 0;
  // data URL or legacy path — display accordingly
  const imgSrc = hasImage
    ? (form.ref_image.startsWith("data:") ? form.ref_image : `${BASE}/image?path=${encodeURIComponent(form.ref_image)}`)
    : null;

  return (
    <div className="template-form-panel">
      <div className="template-form-title">
        {isNew ? "New template" : `Edit - ${tpl.name}`}
      </div>

      <Field label="Name">
        <input value={form.name} onChange={e => set("name", e.target.value)}
          placeholder="e.g. Bottle 0.5L" style={inputStyle} />
      </Field>

      <Field label="Zone">
        <div className="template-zone-row">
          {ZONES.map(z => (
            <button
              key={z}
              className={form.zone === z ? "template-zone-button template-zone-active" : "template-zone-button"}
              onClick={() => set("zone", z)}
              style={{ "--zone-color": ZONE_COLOR[z] }}
            >
              {z}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Hint">
        <input value={form.hint} onChange={e => set("hint", e.target.value)}
          placeholder="e.g. Top + bottom touch green lines" style={inputStyle} />
      </Field>

      <Field label="Reference image">
        <input ref={fileInputRef} type="file" accept="image/*"
          onChange={onFileInput} style={{ display: "none" }} />

        {/* Drop zone */}
        <div
          onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
          className={dragging ? "template-dropzone template-dropzone-active" : "template-dropzone"}
          style={{ marginBottom: hasImage ? 8 : 0 }}
        >
          {hasImage ? (
            <div className="template-reference-preview">
              <img src={imgSrc} alt="reference"
                className="template-reference-image"
                onError={e => { e.target.style.display = "none"; }} />
              <button
                onClick={() => set("ref_image", "")}
                className="template-reference-remove"
              >
                ×
              </button>
            </div>
          ) : (
            <div className="template-empty-upload">
              <div>Drop image here</div>
              <div className="template-upload-actions">
                <button className="template-btn template-btn-secondary" onClick={() => fileInputRef.current?.click()}>
                  Upload file
                </button>
                <button className="template-btn template-btn-secondary" onClick={browseRef}>
                  Browse...
                </button>
              </div>
            </div>
          )}
        </div>
        {hasImage && (
          <div className="template-inline-actions">
            <button className="template-btn template-btn-secondary" onClick={() => fileInputRef.current?.click()}>
              Replace
            </button>
            <button className="template-btn template-btn-secondary" onClick={browseRef}>Browse...</button>
          </div>
        )}
      </Field>

      {error && <div className="template-error">{error}</div>}

      <div className="template-form-actions">
        <button className="template-btn template-btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save template"}
        </button>
        <button
          className="template-btn template-btn-secondary"
          onClick={onCancel}
        >
          Cancel
        </button>
        {!isNew && onDelete && (
          <button
            className="template-btn template-btn-danger"
            onClick={onDelete}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Templates({ onBack, hideHeader }) {
  const [templates, setTemplates] = useState({});
  const [editing, setEditing] = useState(null);   // null | "new" | templateName
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet("/templates/list");
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

  const handleSave = async (form) => {
    const key = form.name.trim();
    const updated = { ...templates, [key]: { zone: form.zone, hint: form.hint, ref_image: form.ref_image } };
    await apiPost("/templates/save", { templates: updated });
    setTemplates(updated);
    setEditing(null);
    setStatus(`Saved "${key}"`);
    setTimeout(() => setStatus(""), 2000);
  };

  const handleDelete = async (name) => {
    setConfirmDelete(name);
  };

  const confirmDeleteTemplate = async () => {
    if (!confirmDelete) return;
    const updated = { ...templates };
    delete updated[confirmDelete];
    await apiPost("/templates/save", { templates: updated });
    setTemplates(updated);
    setEditing(null);
    setStatus(`Deleted "${confirmDelete}"`);
    setConfirmDelete(null);
    setTimeout(() => setStatus(""), 2000);
  };

  const editingTemplate = editing === "new"
    ? { ...EMPTY_TEMPLATE }
    : editing
      ? { name: editing, ...(templates[editing] || {}) }
      : null;
  const templateEntries = Object.entries(templates);
  const templateCount = templateEntries.length;

  return (
    <div className="templates-screen">
      <style>{`
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:var(--scrollbar);border-radius:2px}
        ::placeholder{color:var(--dim2);opacity:0.7}
        [data-theme="dark"] select option{background:hsl(222,20%,16%);color:hsl(210,40%,95%)}
        [data-theme="light"] select option{background:hsl(220,14%,94%);color:hsl(224,20%,15%)}
      `}</style>

      {/* Header — hidden when nav strip is provided by Root */}
      {!hideHeader && (
      <div className="templates-header">
        <div className="templates-heading">
          {onBack && (
            <button className="template-back-button" onClick={onBack}>
              ← Pipeline
            </button>
          )}
          <div>
            <h1>Templates · Layouts</h1>
            <p>Manage placement presets and reusable output layouts.</p>
          </div>
        </div>
        <div className="templates-header-actions">
          {status && (
            <div className="template-status-pill">{status}</div>
          )}
          <button className="template-btn template-btn-primary" onClick={() => setEditing("new")}>
            New Template
          </button>
        </div>
      </div>
      )}
      {/* Status feedback when header hidden */}
      {hideHeader && status && (
        <div className="template-status-bar">
          {status}
        </div>
      )}

      <div className="templates-body">

        {/* Template list */}
        <div className="templates-list-pane">
          <div className="templates-list-header">
            <div>
              <span>Templates</span>
              <strong>{templateCount}</strong>
            </div>
            <button className="template-btn template-btn-secondary template-btn-compact" onClick={() => setEditing("new")}>
              + New
            </button>
          </div>

          {loading ? (
            <div className="template-list-message">Loading...</div>
          ) : templateCount === 0 ? (
            <div className="template-empty-state">
              <strong>No templates yet</strong>
              <span>Create a placement preset when you need repeatable layouts.</span>
              <button className="template-btn template-btn-primary" onClick={() => setEditing("new")}>
                Create Template
              </button>
            </div>
          ) : (
            <div className="template-card-list">
              {templateEntries.map(([name, tpl]) => (
                <div
                  key={name}
                  className={editing === name ? "template-card template-card-active" : "template-card"}
                  onClick={() => setEditing(name)}
                >
                  <div className="template-card-main">
                    <div className="template-card-title-row">
                      <div
                        className="template-zone-dot"
                        style={{ background: ZONE_COLOR[tpl.zone] || C.dim }}
                      />
                      <span>{name}</span>
                    </div>
                    <div className="template-card-meta">
                      <span>{tpl.zone || "none"} zone</span>
                      <span>{tpl.ref_image ? "reference image" : "no reference"}</span>
                    </div>
                    {tpl.hint && (
                      <div className="template-card-hint">{tpl.hint}</div>
                    )}
                  </div>
                  <div className="template-card-side">
                    {tpl.ref_image && (
                      <div className="template-card-thumb">
                        <img
                          src={
                            !tpl.ref_image ? null
                            : tpl.ref_image.startsWith("data:") ? tpl.ref_image
                            : tpl.ref_image.includes("/") || tpl.ref_image.includes("\\")
                              ? `${BASE}/image?path=${encodeURIComponent(tpl.ref_image)}`
                              : `${BASE}/templates/image?name=${encodeURIComponent(tpl.ref_image)}`
                          }
                          alt=""
                          onError={e => { e.target.style.display = "none"; }}
                        />
                      </div>
                    )}
                    <button
                      className="template-delete-icon"
                      onClick={e => { e.stopPropagation(); handleDelete(name); }}
                      aria-label={`Delete ${name}`}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Edit pane */}
        <div className="templates-edit-pane">
          {editingTemplate ? (
            <TemplateForm
              key={editing}
              tpl={editingTemplate}
              isNew={editing === "new"}
              onSave={handleSave}
              onCancel={() => setEditing(null)}
              onDelete={editing && editing !== "new" ? () => handleDelete(editing) : null}
            />
          ) : (
            <div className="template-editor-empty">
              <strong>Select a template</strong>
              <span>Pick a saved layout from the list, or create a new reusable placement preset.</span>
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
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <div className="template-field">
      <div className="template-field-label">{label}</div>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%", background: "var(--field-bg)", color: C.text,
  border: `1px solid ${C.border}`, borderRadius: 8,
  padding: "7px 9px", fontSize: 11, fontFamily: "inherit",
  outline: "none", boxSizing: "border-box",
};
