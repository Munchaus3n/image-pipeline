import { useState, useEffect, useCallback, useRef, useMemo } from "react";

const BASE = "/api";

const C = {
  bg:     "var(--bg)",     panel:   "var(--panel)",  panel2:  "var(--panel2)",
  border: "var(--border)", text:    "var(--text)",   dim:     "var(--dim)",
  dim2:   "var(--dim2)",   accent:  "var(--accent)",
  green:  "var(--green)",  blue:    "var(--accent)",
  yellow: "var(--yellow)", red:     "var(--red)",
};

function toForwardSlashes(path = "") {
  return String(path || "").replace(/\\/g, "/");
}

function trimTrailingSlashes(path = "") {
  return path.replace(/\/+$/, "");
}

function normalizeImageId(path = "") {
  return trimTrailingSlashes(toForwardSlashes(path).trim());
}

function relativePathFromInput(absPath, inputDir) {
  const absNorm = normalizeImageId(absPath);
  const rootNorm = normalizeImageId(inputDir);
  if (!absNorm || !rootNorm) return "";
  const absLower = absNorm.toLowerCase();
  const rootLower = rootNorm.toLowerCase();
  if (absLower === rootLower) return "";
  if (absLower.startsWith(`${rootLower}/`)) return absNorm.slice(rootNorm.length + 1);
  return "";
}

export default function Input({
  inputDir, setInputDir,
  thumbs, setThumbs,
  excludeTags, setExcludeTags,
  removedImages, setRemovedImages,
  onGoToProcess,
}) {
  const [loading,          setLoading]          = useState(false);
  const [loadError,        setLoadError]        = useState(null);
  const [search,           setSearch]           = useState("");
  const [selected,         setSelected]         = useState(new Set());
  const [previewPath,      setPreviewPath]      = useState(null);
  const [previewLoadError, setPreviewLoadError] = useState(false);
  const [browseLoading,    setBrowseLoading]    = useState(false);
  const [thumbLoadErrors,  setThumbLoadErrors]  = useState(new Set());
  const lastSelectedRef = useRef(null);  // for shift-click range
  const loadedDirRef = useRef("");

  // Auto-load images whenever inputDir changes — also resets all session state
  useEffect(() => {
    if (!inputDir.trim()) {
      setThumbs([]); setSelected(new Set());
      setExcludeTags([]); setRemovedImages(new Set());
      setLoadError(null);
      setThumbLoadErrors(new Set());
      loadedDirRef.current = "";
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`${BASE}/images?folder=${encodeURIComponent(inputDir.trim())}`);
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          setLoadError(err.detail || `Server error ${r.status}`);
          setThumbs([]);
        } else {
          const data = await r.json();
          const loadedDir = inputDir.trim();
          if (loadedDirRef.current !== loadedDir) {
            setSelected(new Set());
            setExcludeTags([]);
            setRemovedImages(new Set());
            setPreviewPath(null);
            setPreviewLoadError(false);
            setThumbLoadErrors(new Set());
            setLoadError(null);
            lastSelectedRef.current = null;
            loadedDirRef.current = loadedDir;
          }
          if (Array.isArray(data?.images)) setThumbs(data.images.slice(0, 500));
          else setThumbs([]);
        }
      } catch {
        setLoadError("Could not reach the API server.");
        setThumbs([]);
      }
      finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [inputDir, setExcludeTags, setRemovedImages, setThumbs]);

  const browse = useCallback(async () => {
    setBrowseLoading(true);
    try {
      const r = await fetch(`${BASE}/browse?initial=${encodeURIComponent(inputDir)}`);
      if (!r.ok) throw new Error("Browse failed");
      const { path } = await r.json();
      if (path) { setInputDir(path); setSelected(new Set()); setPreviewPath(null); setPreviewLoadError(false); }
    } catch {
      void 0;
    }
    setBrowseLoading(false);
  }, [inputDir, setInputDir]);

  const imageEntries = useMemo(() => thumbs.map(absPath => {
    const name = absPath.replace(/.*[/\\]/, "");
    const relativePath = relativePathFromInput(absPath, inputDir);
    const imageId = normalizeImageId(relativePath || absPath);
    const relFolder = relativePath.includes("/") ? relativePath.slice(0, relativePath.lastIndexOf("/")) : "";
    return { absPath, name, relativePath, imageId, relFolder };
  }), [thumbs, inputDir]);

  const entriesByAbsPath = useMemo(() => {
    const map = new Map();
    imageEntries.forEach(entry => map.set(entry.absPath, entry));
    return map;
  }, [imageEntries]);

  // Visible images: exclude removed + apply search filter
  const visible = imageEntries.filter(entry => {
    if (removedImages.has(entry.imageId)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return entry.name.toLowerCase().includes(q) || entry.relativePath.toLowerCase().includes(q);
  });

  const toggleSelect = useCallback((imageId, e, visibleIds) => {
    if (e.shiftKey && lastSelectedRef.current && visibleIds) {
      // Range select from last clicked to current
      const a = visibleIds.indexOf(lastSelectedRef.current);
      const b = visibleIds.indexOf(imageId);
      if (a !== -1 && b !== -1) {
        const [from, to] = a < b ? [a, b] : [b, a];
        const range = visibleIds.slice(from, to + 1);
        setSelected(prev => {
          const next = new Set(prev);
          range.forEach(n => next.add(n));
          return next;
        });
        return;
      }
    }
    lastSelectedRef.current = imageId;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(imageId)) next.delete(imageId); else next.add(imageId);
      return next;
    });
  }, []);

  const selectAll  = () => setSelected(new Set(visible.map(entry => entry.imageId)));
  const selectNone = () => setSelected(new Set());

  const excludeSelected = () => {
    setExcludeTags(prev => {
      const next = [...prev];
      selected.forEach(n => { if (!next.includes(n)) next.push(n); });
      return next;
    });
  };

  const unexcludeSelected = () => {
    setExcludeTags(prev => prev.filter(n => !selected.has(n)));
  };

  const removeSelected = () => {
    // Remove from session — also strip from excludeTags so they don't get sent to pipeline
    setExcludeTags(prev => prev.filter(n => !selected.has(n)));
    setRemovedImages(prev => { const next = new Set(prev); selected.forEach(n => next.add(n)); return next; });
    const previewImageId = previewPath ? entriesByAbsPath.get(previewPath)?.imageId : null;
    if (previewImageId && selected.has(previewImageId)) setPreviewPath(null);
    setSelected(new Set());
    lastSelectedRef.current = null;
  };

  const selArr      = [...selected];
  const allExcl     = selArr.length > 0 && selArr.every(n => excludeTags.includes(n));
  // visible IDs list used for shift-click range
  const visibleIds = visible.map(entry => entry.imageId);
  // excludeTags that are still in the visible set (not removed)
  const activeExcludeCount = excludeTags.filter(n => !removedImages.has(n)).length;

  return (
    <div className="input-screen" style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: C.bg, color: C.text,
      fontFamily: "'Outfit','DM Sans',system-ui,sans-serif",
    }}>
      <style>{`
        ::-webkit-scrollbar{width:4px;height:4px} ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:var(--scrollbar);border-radius:2px}
        .inp-thumb:hover .inp-eye{opacity:1!important}
        .inp-cb:hover{background:rgba(59,130,246,0.25)!important}
        .inp-btn:hover{filter:brightness(1.15)}
        .inp-card{content-visibility:auto;contain-intrinsic-size:0 150px}
      `}</style>

      {/* ── Top bar ── */}
      <div className="input-toolbar" style={{
        display: "flex", alignItems: "center", gap: 8, padding: "8px 14px",
        borderBottom: `1px solid ${C.border}`, background: C.panel, flexShrink: 0,
      }}>
        {/* Folder input + browse */}
        <div className="input-folder-group" style={{ display: "flex", gap: 4, flex: "0 0 360px" }}>
          <input
            className="input-path-field"
            value={inputDir}
            onChange={e => setInputDir(e.target.value)}
            placeholder="Select input folder…"
            style={{
              flex: 1, background: C.panel2, color: C.text,
              border: `1px solid ${C.border}`, borderRadius: 4,
              padding: "5px 8px", fontSize: 11, fontFamily: "JetBrains Mono",
              outline: "none", minWidth: 0,
            }}
          />
          <button className="inp-btn input-browse-button" onClick={browse} disabled={browseLoading} style={{
            background: C.panel2, color: C.dim, border: `1px solid ${C.border}`,
            borderRadius: 4, padding: "5px 10px", fontSize: 13,
            cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
          }}>{browseLoading ? "…" : "…"}</button>
        </div>

        {/* Search */}
        <input
          className="input-search-field"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by filename…"
          style={{
            flex: 1, background: C.panel2, color: C.text,
            border: `1px solid ${C.border}`, borderRadius: 4,
            padding: "5px 10px", fontSize: 11, fontFamily: "inherit",
            outline: "none",
          }}
        />

        {/* Image count */}
        <span className="input-count" style={{ fontSize: 11, color: C.dim, fontFamily: "JetBrains Mono", flexShrink: 0 }}>
          {visible.length} image{visible.length !== 1 ? "s" : ""}
          {activeExcludeCount > 0 && (
            <span style={{ color: C.yellow }}> · {activeExcludeCount} excluded</span>
          )}
        </span>

        {/* All / None */}
        <button className="inp-btn input-select-button" onClick={selectAll} style={{
          background: "transparent", color: C.dim, border: `1px solid ${C.border}`,
          borderRadius: 4, padding: "4px 10px", fontSize: 11,
          cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
        }}>All</button>
        <button className="inp-btn input-select-button" onClick={selectNone} style={{
          background: "transparent", color: C.dim, border: `1px solid ${C.border}`,
          borderRadius: 4, padding: "4px 10px", fontSize: 11,
          cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
        }}>None</button>

        {/* Go to Process */}
        <button className="inp-btn input-next-button" onClick={onGoToProcess} disabled={!inputDir.trim()} style={{
          background: inputDir.trim() ? "var(--accent)" : C.panel2,
          color: inputDir.trim() ? "var(--accent-fg)" : C.dim2,
          border: `1px solid ${inputDir.trim() ? "color-mix(in srgb, var(--accent) 72%, white 8%)" : C.border}`,
          borderRadius: 4, padding: "6px 18px", fontSize: 12, fontWeight: 600,
          cursor: inputDir.trim() ? "pointer" : "not-allowed",
          fontFamily: "inherit", flexShrink: 0,
        }}>Go to Process →</button>
      </div>

      {/* ── Selection action bar ── */}
      {selected.size > 0 && (
        <div className="input-selection-bar" style={{
          display: "flex", alignItems: "center", gap: 10, padding: "6px 14px",
          background: C.panel2, borderBottom: `1px solid ${C.border}`, flexShrink: 0,
        }}>
          <span className="input-selection-count" style={{ fontSize: 12, color: C.blue, fontWeight: 600 }}>
            {selected.size} selected
          </span>
          <button className="inp-btn input-selection-action" onClick={allExcl ? unexcludeSelected : excludeSelected} style={{
            background: allExcl ? C.panel2 : "var(--yellow-bg)",
            color: allExcl ? C.dim : C.yellow,
            border: `1px solid ${allExcl ? C.border : "var(--yellow-bdr)"}`,
            borderRadius: 4, padding: "4px 12px", fontSize: 11,
            cursor: "pointer", fontFamily: "inherit",
          }}>
            {allExcl ? "Remove exclusion" : "Exclude from BG"}
          </button>
          <button className="inp-btn input-selection-action" onClick={removeSelected} style={{
            background: "var(--red-bg)", color: C.red, border: `1px solid var(--red-bdr)`,
            borderRadius: 4, padding: "4px 12px", fontSize: 11,
            cursor: "pointer", fontFamily: "inherit",
          }}>Remove from session</button>
          <button className="inp-btn input-selection-clear" onClick={selectNone} style={{
            background: "transparent", color: C.dim, border: "none",
            fontSize: 11, cursor: "pointer", fontFamily: "inherit", marginLeft: "auto",
          }}>Clear</button>
        </div>
      )}

      {/* ── Main area: grid + optional preview sidebar ── */}
      <div className="input-main" style={{ flex: 1, display: "flex", minHeight: 0 }}>

        {/* Image grid */}
        <div className="input-grid-scroll" style={{ flex: 1, overflowY: "auto", padding: 12 }}>
          {!inputDir.trim() ? (
            /* Empty state */
            <div className="input-empty-state" style={{
              height: "100%", display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 14,
            }}>
              <div style={{ fontSize: 36, opacity: 0.50 }}>📁</div>
              <div style={{ fontSize: 13, color: C.dim }}>Select an input folder to browse images</div>
              <button className="inp-btn input-browse-button" onClick={browse} style={{
                background: C.panel2, color: C.text, border: `1px solid ${C.border}`,
                borderRadius: 4, padding: "8px 20px", fontSize: 12,
                cursor: "pointer", fontFamily: "inherit",
              }}>Browse folder</button>
            </div>
          ) : loading ? (
            <div className="input-loading-state" style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: C.dim, fontSize: 12, fontFamily: "JetBrains Mono" }}>Loading images…</span>
            </div>
          ) : loadError ? (
            <div className="input-error-state" style={{
              height: "100%", display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 10,
            }}>
              <div style={{ fontSize: 22, opacity: 0.4 }}>⚠</div>
              <div style={{ fontSize: 12, color: C.red, fontFamily: "JetBrains Mono", textAlign: "center", maxWidth: 420 }}>
                {loadError}
              </div>
              <div style={{ fontSize: 11, color: C.dim, textAlign: "center" }}>
                Check that the folder path is correct and try again.
              </div>
            </div>
          ) : visible.length === 0 ? (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: C.dim, fontSize: 12 }}>No images found{search ? " matching your search" : ""}</span>
            </div>
          ) : (
            <div className="input-grid" style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
              gap: 8, alignContent: "start",
            }}>
              {visible.map(entry => {
                const { absPath, name, imageId, relFolder } = entry;
                const ext       = name.includes(".") ? `.${name.split(".").pop().toLowerCase()}` : "";
                const isAvif    = ext === ".avif";
                const isSel     = selected.has(imageId);
                const isExcl    = excludeTags.includes(imageId);
                const isPreview = previewPath === absPath;
                const thumbFailed = thumbLoadErrors.has(absPath);
                return (
                  <div
                    key={absPath}
                    className="inp-thumb inp-card input-thumb input-card"
                    onClick={e => toggleSelect(imageId, e, visibleIds)}
                    style={{
                      position: "relative", borderRadius: 5, overflow: "hidden",
                      border: `2px solid ${isSel ? C.blue : isPreview ? "color-mix(in srgb,var(--accent) 40%,var(--border))" : C.border}`,
                      background: C.panel2, cursor: "pointer",
                      transition: "border-color 0.1s",
                    }}
                  >
                    {/* Checkbox overlay — top-left */}
                    <div
                      className="inp-cb input-checkbox"
                      style={{
                        position: "absolute", top: 5, left: 5, zIndex: 2,
                        width: 18, height: 18, borderRadius: 4,
                        background: isSel ? C.blue : "rgba(0,0,0,0.55)",
                        border: `1.5px solid ${isSel ? C.blue : "rgba(255,255,255,0.25)"}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 10, color: "var(--accent-fg)", fontWeight: 700,
                        pointerEvents: "none",
                      }}
                    >{isSel ? "✓" : ""}</div>

                    {/* Eye icon — top-right, visible on hover only */}
                    <div
                      className="inp-eye input-eye-button"
                      onClick={e => { e.stopPropagation(); setPreviewPath(isPreview ? null : absPath); setPreviewLoadError(false); }}
                      style={{
                        position: "absolute", top: 5, right: 5, zIndex: 2,
                        width: 22, height: 22, borderRadius: 4,
                        background: isPreview ? C.blue : "rgba(0,0,0,0.60)",
                        border: `1px solid ${isPreview ? C.blue : "rgba(255,255,255,0.15)"}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 11, cursor: "pointer",
                        opacity: isPreview ? 1 : 0,
                        transition: "opacity 0.12s",
                      }}
                    >👁</div>

                    {/* Thumbnail */}
                    {thumbFailed ? (
                      <div className="input-thumb-fallback" style={{
                        width: "100%", aspectRatio: "1",
                        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                        padding: "8px 6px", gap: 4,
                        background: "var(--img-bg)", color: C.dim, textAlign: "center",
                        border: `1px dashed ${C.border}`,
                      }}>
                        <div style={{ fontSize: 16, lineHeight: 1, color: C.dim2 }}>🖼</div>
                        <div style={{
                          fontSize: 9, color: C.text, fontFamily: "JetBrains Mono",
                          maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}>{name}</div>
                        <div style={{ fontSize: 9, color: C.dim2, fontFamily: "JetBrains Mono" }}>{ext || "unknown"}</div>
                        <div style={{ fontSize: 10, color: C.red }}>
                          {isAvif ? "AVIF preview unavailable" : "Preview unavailable"}
                        </div>
                      </div>
                    ) : (
                      <img
                        className="input-thumb-image"
                        src={`${BASE}/preview?path=${encodeURIComponent(absPath)}&size=200`}
                        alt={name}
                        loading="lazy"
                        onLoad={() => setThumbLoadErrors(prev => {
                          if (!prev.has(absPath)) return prev;
                          const next = new Set(prev);
                          next.delete(absPath);
                          return next;
                        })}
                        onError={() => setThumbLoadErrors(prev => {
                          if (prev.has(absPath)) return prev;
                          const next = new Set(prev);
                          next.add(absPath);
                          return next;
                        })}
                        style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }}
                      />
                    )}

                    {/* Excluded badge */}
                    {isExcl && (
                      <div className="input-excluded-badge" style={{
                        position: "absolute", bottom: 20, left: 4, right: 4,
                        background: "var(--yellow-bg)", color: "var(--yellow)",
                        border: "1px solid var(--yellow-bdr)",
                        fontSize: 8, fontWeight: 700, textAlign: "center",
                        borderRadius: 3, padding: "1px 0",
                        letterSpacing: "0.06em", textTransform: "uppercase",
                      }}>Excluded</div>
                    )}

                    {/* Filename bar */}
                    <div className="input-filename-bar" style={{
                      padding: "3px 5px",
                      color: isExcl ? C.yellow : C.dim,
                      fontFamily: "JetBrains Mono",
                      background: C.panel,
                    }}>
                      <div className="input-filename" style={{
                        fontSize: 9,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{name}</div>
                      {relFolder && (
                        <div className="input-folder-name" style={{
                          marginTop: 1, fontSize: 8, color: C.dim2,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>{relFolder}/</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Preview sidebar ── */}
        {previewPath && (() => {
          const previewEntry = entriesByAbsPath.get(previewPath);
          if (!previewEntry) return null;
          const { name, imageId, relFolder } = previewEntry;
          const previewExt = name.includes(".") ? `.${name.split(".").pop().toLowerCase()}` : "";
          const isExcl = excludeTags.includes(imageId);
          return (
            <div className="input-preview" style={{
              width: 220, flexShrink: 0, background: C.panel,
              borderLeft: `1px solid ${C.border}`,
              display: "flex", flexDirection: "column",
            }}>
              {/* Header */}
              <div className="input-preview-header" style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "9px 12px", borderBottom: `1px solid ${C.border}`, flexShrink: 0,
              }}>
                <span style={{ fontSize: 9, color: C.dim, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700 }}>Preview</span>
                <button onClick={() => { setPreviewPath(null); setPreviewLoadError(false); }} style={{
                  background: "transparent", border: "none", color: C.dim,
                  fontSize: 14, cursor: "pointer", lineHeight: 1, padding: 0,
                }}>✕</button>
              </div>

              {/* Image */}
              {previewLoadError ? (
                <div className="input-preview-image" style={{
                  width: "100%", aspectRatio: "1", flexShrink: 0,
                  background: "var(--img-bg)", color: C.dim,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, textAlign: "center", padding: 12,
                }}>
                  {previewExt === ".avif"
                    ? "AVIF preview unavailable. Check API AVIF decoder support."
                    : "Preview unavailable. Try another image."}
                </div>
              ) : (
                <img
                  className="input-preview-image"
                  src={`${BASE}/preview?path=${encodeURIComponent(previewPath)}&size=600`}
                  alt=""
                  onError={() => setPreviewLoadError(true)}
                  style={{ width: "100%", aspectRatio: "1", objectFit: "contain", background: "var(--img-bg)", flexShrink: 0 }}
                />
              )}

              {/* Info + controls */}
              <div className="input-preview-body" style={{ padding: "12px", flex: 1, overflowY: "auto" }}>
                <div style={{ fontSize: 9, color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Filename</div>
                <div style={{
                  fontSize: 10, color: C.text, fontFamily: "JetBrains Mono",
                  wordBreak: "break-all", marginBottom: 16, lineHeight: 1.6,
                }}>{name}</div>
                {!!relFolder && (
                  <>
                    <div style={{ fontSize: 9, color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Folder</div>
                    <div style={{
                      fontSize: 10, color: C.dim, fontFamily: "JetBrains Mono",
                      wordBreak: "break-all", marginBottom: 16, lineHeight: 1.6,
                    }}>{relFolder}</div>
                  </>
                )}

                {/* Exclude toggle */}
                <div className="input-preview-control" style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  marginBottom: 8,
                }}>
                  <span style={{ fontSize: 11, color: C.dim }}>Exclude from BG</span>
                  <button className="inp-btn input-preview-control" onClick={() => {
                    if (isExcl) setExcludeTags(prev => prev.filter(x => x !== imageId));
                    else setExcludeTags(prev => [...prev, imageId]);
                  }} style={{
                    background: isExcl ? "var(--yellow-bg)" : C.panel2,
                    color: isExcl ? C.yellow : C.dim,
                    border: `1px solid ${isExcl ? "var(--yellow-bdr)" : C.border}`,
                    borderRadius: 4, padding: "4px 10px", fontSize: 10,
                    cursor: "pointer", fontFamily: "inherit",
                  }}>{isExcl ? "Excluded ✓" : "Exclude"}</button>
                </div>

                {/* Remove from session */}
                <button className="inp-btn input-preview-remove" onClick={() => {
                  setExcludeTags(prev => prev.filter(x => x !== imageId));
                  setRemovedImages(prev => { const n = new Set(prev); n.add(imageId); return n; });
                  setPreviewPath(null);
                  setPreviewLoadError(false);
                }} style={{
                  width: "100%", background: "transparent", color: C.dim,
                  border: `1px solid ${C.border}`, borderRadius: 4,
                  padding: "5px 0", fontSize: 10, cursor: "pointer", fontFamily: "inherit",
                }}>Remove from session</button>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
