import { useState, useEffect, useCallback, useRef } from "react";

const BASE = "/api";

const C = {
  bg: "#0b0d14", panel: "#0f1219", panel2: "#161926",
  border: "#1d2235", text: "#d8e0f0", dim: "#454f6b", dim2: "#262d44",
  green: "#4ade80", blue: "#60a5fa", yellow: "#facc15",
  red: "#f87171", magenta: "#e879f9",
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
  const r = await fetch(`${BASE}/browse-file?initial=&filter=image`);
  if (!r.ok) return "";
  const { path } = await r.json();
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
    <div style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 6, padding: "16px" }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.text, marginBottom: 14 }}>
        {isNew ? "New template" : `Edit — ${tpl.name}`}
      </div>

      <Field label="Name">
        <input value={form.name} onChange={e => set("name", e.target.value)}
          placeholder="e.g. Bottle 0.5L" style={inputStyle} />
      </Field>

      <Field label="Zone">
        <div style={{ display: "flex", gap: 6 }}>
          {ZONES.map(z => (
            <button key={z} onClick={() => set("zone", z)} style={{
              background: form.zone === z ? C.panel : "transparent",
              color: form.zone === z ? ZONE_COLOR[z] : C.dim,
              border: `1px solid ${form.zone === z ? C.border : "transparent"}`,
              borderRadius: 4, padding: "3px 10px", fontSize: 11,
              cursor: "pointer", fontFamily: "inherit",
              fontWeight: form.zone === z ? 600 : 400,
            }}>{z}</button>
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
          style={{
            border: `1px dashed ${dragging ? C.blue : C.border}`,
            borderRadius: 4, padding: "12px",
            background: dragging ? "#0d1a2a" : C.panel,
            transition: "border-color 0.15s, background 0.15s",
            marginBottom: hasImage ? 8 : 0,
          }}
        >
          {hasImage ? (
            <div style={{ position: "relative", display: "inline-block" }}>
              <img src={imgSrc} alt="reference"
                style={{
                  maxWidth: "100%", maxHeight: 160, display: "block",
                  borderRadius: 3, objectFit: "contain"
                }}
                onError={e => { e.target.style.display = "none"; }} />
              <button
                onClick={() => set("ref_image", "")}
                style={{
                  position: "absolute", top: 4, right: 4,
                  background: "rgba(0,0,0,0.7)", color: "#fff",
                  border: "none", borderRadius: 3,
                  padding: "2px 6px", fontSize: 11, cursor: "pointer",
                }}>✕</button>
            </div>
          ) : (
            <div style={{ textAlign: "center", color: C.dim, fontSize: 11, lineHeight: 2 }}>
              <div>Drop image here</div>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 6 }}>
                <button onClick={() => fileInputRef.current?.click()} style={smallBtnStyle}>
                  Upload file
                </button>
                <button onClick={browseRef} style={smallBtnStyle}>
                  Browse…
                </button>
              </div>
            </div>
          )}
        </div>
        {hasImage && (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => fileInputRef.current?.click()} style={smallBtnStyle}>
              Replace
            </button>
            <button onClick={browseRef} style={smallBtnStyle}>Browse…</button>
          </div>
        )}
      </Field>

      {error && <div style={{ fontSize: 11, color: C.red, marginBottom: 8 }}>{error}</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
        <button onClick={handleSave} disabled={saving} style={{
          background: "#0d2818", color: C.green, border: `1px solid #1e4a2e`,
          borderRadius: 4, padding: "7px 18px", fontSize: 11, fontWeight: 600,
          cursor: "pointer", fontFamily: "inherit",
        }}>{saving ? "Saving…" : "Save template"}</button>
        <button
          onClick={onCancel}
          onMouseEnter={e => { e.currentTarget.style.color = C.red; e.currentTarget.style.borderColor = "#4a1a1a"; }}
          onMouseLeave={e => { e.currentTarget.style.color = C.dim; e.currentTarget.style.borderColor = C.border; }}
          style={{
            background: "transparent", color: C.dim, border: `1px solid ${C.border}`,
            borderRadius: 4, padding: "7px 14px", fontSize: 11,
            cursor: "pointer", fontFamily: "inherit",
          }}>Cancel</button>
        {!isNew && onDelete && (
          <button
            onClick={onDelete}
            onMouseEnter={e => { e.currentTarget.style.background = "#2a0d0d"; e.currentTarget.style.color = C.red; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.dim; }}
            style={{
              marginLeft: "auto", background: "transparent", color: C.dim,
              border: `1px solid ${C.border}`, borderRadius: 4,
              padding: "7px 14px", fontSize: 11, cursor: "pointer", fontFamily: "inherit",
            }}>Delete</button>
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

  useEffect(() => { load(); }, [load]);

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
    if (!window.confirm(`Delete "${name}"?`)) return;
    const updated = { ...templates };
    delete updated[name];
    await apiPost("/templates/save", { templates: updated });
    setTemplates(updated);
    setEditing(null);
    setStatus(`Deleted "${name}"`);
    setTimeout(() => setStatus(""), 2000);
  };

  const editingTemplate = editing === "new"
    ? { ...EMPTY_TEMPLATE }
    : editing
      ? { name: editing, ...(templates[editing] || {}) }
      : null;

  return (
    <div style={{
      display: "flex", flexDirection: "column", background: C.bg, minHeight: "100vh",
      fontFamily: "'Outfit','DM Sans',system-ui,sans-serif", color: C.text, fontSize: 13
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        button:hover{filter:brightness(1.18)} button:active{filter:brightness(0.88)}
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#1d2235;border-radius:2px}
        ::placeholder{color:#2e3850}
      `}</style>

      {/* Header — hidden when nav strip is provided by Root */}
      {!hideHeader && (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 20px", height: 42, borderBottom: `1px solid ${C.border}`, background: C.panel
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={onBack} style={{
            background: "transparent", color: C.dim, border: "none",
            fontSize: 11, cursor: "pointer", fontFamily: "inherit", padding: 0
          }}>
            ← Pipeline
          </button>
          <span style={{ color: C.dim2 }}>|</span>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.04em" }}>Templates</span>
        </div>
        {status && (
          <div style={{ fontSize: 11, color: C.green, fontFamily: "JetBrains Mono" }}>{status}</div>
        )}
      </div>
      )}
      {/* Status feedback when header hidden */}
      {hideHeader && status && (
        <div style={{ padding: "4px 20px", fontSize: 11, color: C.green,
          fontFamily: "JetBrains Mono", background: C.panel, borderBottom: `1px solid ${C.border}` }}>
          {status}
        </div>
      )}

      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>

        {/* Template list */}
        <div style={{
          width: 320, borderRight: `1px solid ${C.border}`, padding: "14px",
          display: "flex", flexDirection: "column", overflowY: "auto"
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{
              fontSize: 9, letterSpacing: "0.12em", color: C.dim,
              textTransform: "uppercase", fontWeight: 600
            }}>Templates</div>
            <button onClick={() => setEditing("new")} style={{
              background: "#0d2818", color: C.green, border: `1px solid #1e4a2e`,
              borderRadius: 4, padding: "4px 12px", fontSize: 11, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
            }}>+ New</button>
          </div>

          {loading ? (
            <div style={{ color: C.dim, fontSize: 11 }}>Loading…</div>
          ) : Object.keys(templates).length === 0 ? (
            <div style={{ color: C.dim, fontSize: 11 }}>No templates yet. Create one →</div>
          ) : (
            Object.entries(templates).map(([name, tpl]) => (
              <div key={name} style={{
                background: editing === name ? C.panel2 : "transparent",
                border: `1px solid ${editing === name ? C.border : "transparent"}`,
                borderRadius: 4, padding: "8px 10px", marginBottom: 4,
                display: "flex", alignItems: "center", justifyContent: "space-between",
                cursor: "pointer",
              }} onClick={() => setEditing(name)}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <div style={{
                      width: 6, height: 6, borderRadius: "50%",
                      background: ZONE_COLOR[tpl.zone] || C.dim
                    }} />
                    <span style={{ fontSize: 12, color: C.text }}>{name}</span>
                  </div>
                  {tpl.hint && (
                    <div style={{ fontSize: 10, color: C.dim, marginLeft: 13, marginTop: 2 }}>{tpl.hint}</div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {tpl.ref_image && (
                    <div style={{
                      width: 28, height: 28, borderRadius: 3, overflow: "hidden",
                      border: `1px solid ${C.border}`, flexShrink: 0
                    }}>
                      <img
                        src={tpl.ref_image && tpl.ref_image.startsWith("data:") ? tpl.ref_image : `${BASE}/image?path=${encodeURIComponent(tpl.ref_image || "")}`}
                        alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        onError={e => { e.target.style.display = "none"; }} />
                    </div>
                  )}
                  <button onClick={e => { e.stopPropagation(); handleDelete(name); }} style={{
                    background: "transparent", color: C.dim, border: "none",
                    fontSize: 14, cursor: "pointer", padding: "0 4px", lineHeight: 1,
                  }}>×</button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Edit pane */}
        <div style={{ flex: 1, padding: "20px 24px", overflowY: "auto" }}>
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
            <div style={{ color: C.dim, fontSize: 11, marginTop: 8 }}>
              Select a template to edit, or click + New.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, color: C.dim, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%", background: C.panel, color: C.text,
  border: `1px solid ${C.border}`, borderRadius: 4,
  padding: "5px 8px", fontSize: 11, fontFamily: "inherit",
  outline: "none", boxSizing: "border-box",
};

const smallBtnStyle = {
  background: C.panel, color: C.dim, border: `1px solid ${C.border}`,
  borderRadius: 4, padding: "5px 8px", fontSize: 11,
  cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
};