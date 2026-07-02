import { useState, useCallback, useRef, useMemo } from "react";
import { apiBase } from "./runtime.js";
import { browseFolder } from "./api.js";

const BASE = apiBase();

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

function imageIdForPath(absPath, inputDir) {
  return normalizeImageId(relativePathFromInput(absPath, inputDir) || absPath);
}

function pruneSetToIds(values, validIds) {
  const next = new Set();
  values.forEach((value) => {
    if (validIds.has(value)) next.add(value);
  });
  return next;
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

export default function Input({
  inputDir, setInputDir,
  thumbs, setThumbs,
  excludeTags, setExcludeTags,
  removedImages, setRemovedImages,
  onGoToProcess,
  recentInputDirs = [],
  rememberInputDir,
}) {
  const [loading,          setLoading]          = useState(false);
  const [loadError,        setLoadError]        = useState(null);
  const [search,           setSearch]           = useState("");
  const [selected,         setSelected]         = useState(new Set());
  const [previewPath,      setPreviewPath]      = useState(null);
  const [previewLoadError, setPreviewLoadError] = useState(false);
  const [browseLoading,    setBrowseLoading]    = useState(false);
  const [thumbLoadErrors,  setThumbLoadErrors]  = useState(new Set());
  const [includeSubfolders, setIncludeSubfolders] = useState(false);
  const [truncated,        setTruncated]        = useState(false);
  const [previewVersion,   setPreviewVersion]   = useState(0);
  const lastSelectedRef = useRef(null);  // for shift-click range
  const loadedDirRef = useRef("");

  const clearLoadedImages = useCallback(() => {
    setThumbs([]); setSelected(new Set());
    setExcludeTags([]); setRemovedImages(new Set());
    setLoadError(null);
    setPreviewPath(null);
    setPreviewLoadError(false);
    setThumbLoadErrors(new Set());
    setTruncated(false);
    setPreviewVersion(v => v + 1);
    lastSelectedRef.current = null;
    loadedDirRef.current = "";
  }, [setExcludeTags, setRemovedImages, setThumbs]);

  const loadImages = useCallback(async ({ resetSession = false } = {}) => {
    const folder = inputDir.trim();
    if (!folder) {
      clearLoadedImages();
      return;
    }
    setLoading(true);
    setLoadError(null);
    setPreviewLoadError(false);
    setThumbLoadErrors(new Set());
    setPreviewVersion(v => v + 1);
    try {
      const r = await fetch(
        `${BASE}/images?folder=${encodeURIComponent(folder)}&recursive=${includeSubfolders ? "true" : "false"}&limit=500`
      );
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        setLoadError(err.detail || `Server error ${r.status}`);
        setThumbs([]);
      } else {
        const data = await r.json();
        const nextImages = Array.isArray(data?.images) ? data.images : [];
        const nextIds = new Set(nextImages.map(absPath => imageIdForPath(absPath, folder)));
        const shouldResetSession = resetSession || loadedDirRef.current !== folder;
        if (shouldResetSession) {
          setSelected(new Set());
          setExcludeTags([]);
          setRemovedImages(new Set());
          setPreviewPath(null);
          setPreviewLoadError(false);
          setThumbLoadErrors(new Set());
          setLoadError(null);
          lastSelectedRef.current = null;
          loadedDirRef.current = folder;
        } else {
          setSelected(prev => {
            const next = pruneSetToIds(prev, nextIds);
            return sameSet(prev, next) ? prev : next;
          });
          setExcludeTags(prev => {
            const next = [...new Set(prev)].filter(id => nextIds.has(id));
            return next.length === prev.length && next.every((id, i) => id === prev[i]) ? prev : next;
          });
          setRemovedImages(prev => {
            const next = pruneSetToIds(prev, nextIds);
            return sameSet(prev, next) ? prev : next;
          });
          setPreviewPath(prev => {
            if (!prev) return prev;
            const previewId = imageIdForPath(prev, folder);
            return nextIds.has(previewId) ? prev : null;
          });
          lastSelectedRef.current = null;
        }
        setTruncated(!!data?.truncated);
        setThumbs(nextImages);
        rememberInputDir?.(folder);
      }
    } catch {
      setLoadError("Could not reach the API server.");
      setThumbs([]);
    }
    finally { setLoading(false); }
  }, [clearLoadedImages, includeSubfolders, inputDir, rememberInputDir, setExcludeTags, setRemovedImages, setThumbs]);

  const previewUrl = useCallback((path, size) => (
    `${BASE}/preview?path=${encodeURIComponent(path)}&size=${size}&v=${previewVersion}`
  ), [previewVersion]);

  const browse = useCallback(async () => {
    setBrowseLoading(true);
    try {
      const { path } = await browseFolder(inputDir);
      if (path) {
        setInputDir(path);
        rememberInputDir?.(path);
        clearLoadedImages();
        setPreviewPath(null);
        setPreviewLoadError(false);
      }
    } catch {
      void 0;
    }
    setBrowseLoading(false);
  }, [clearLoadedImages, inputDir, rememberInputDir, setInputDir]);

  const imageEntries = useMemo(() => thumbs.map(absPath => {
    const name = absPath.replace(/.*[/\\]/, "");
    const relativePath = relativePathFromInput(absPath, inputDir);
    const imageId = imageIdForPath(absPath, inputDir);
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

  const toggleSelect = useCallback((imageId, absPath, e, visibleIds) => {
    // Selection is now the primary preview driver.
    setPreviewPath(absPath);
    setPreviewLoadError(false);

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
      const visibleIdSet = new Set(visible.map(entry => entry.imageId));
      const next = [...prev];
      selected.forEach(n => {
        if (visibleIdSet.has(n) && !next.includes(n)) next.push(n);
      });
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
      fontFamily: "var(--font-sans)",
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
      <div className="input-page-header">
        <div className="input-page-title-group">
          <h1 className="input-page-title">Input · Review</h1>
          <p className="input-page-subtitle">Select source images, review exclusions, then continue to processing.</p>
        </div>
        <div className="input-page-actions">
          <span className="input-count input-header-count">
            {visible.length} image{visible.length !== 1 ? "s" : ""}
            {truncated && <span style={{ color: C.yellow }}> · first 500</span>}
            {activeExcludeCount > 0 && (
              <span style={{ color: C.yellow }}> · {activeExcludeCount} excluded</span>
            )}
          </span>
          <button className="inp-btn input-next-button" onClick={onGoToProcess} disabled={!inputDir.trim()} style={{
            background: inputDir.trim() ? "var(--accent)" : C.panel2,
            color: inputDir.trim() ? "var(--accent-fg)" : C.dim2,
            border: `1px solid ${inputDir.trim() ? "color-mix(in srgb, var(--accent) 72%, white 8%)" : C.border}`,
            borderRadius: 4, padding: "6px 18px", fontSize: 12, fontWeight: 600,
            cursor: inputDir.trim() ? "pointer" : "not-allowed",
            fontFamily: "inherit", flexShrink: 0,
          }}>Go to Process →</button>
        </div>
      </div>

      <div className="input-toolbar" style={{
        display: "flex", alignItems: "center", gap: 8, padding: "8px 14px",
        borderBottom: `1px solid ${C.border}`, background: C.panel, flexShrink: 0,
      }}>
        {/* Folder input + browse */}
        <div className="input-folder-group" style={{ display: "flex", gap: 4, flex: "0 0 560px" }}>
          <input
            className="input-path-field"
            value={inputDir}
            onChange={e => { setInputDir(e.target.value); clearLoadedImages(); }}
            onBlur={() => rememberInputDir?.(inputDir)}
            placeholder="Select input folder…"
            style={{
              flex: 1, background: C.panel2, color: C.text,
              border: `1px solid ${C.border}`, borderRadius: 4,
              padding: "5px 8px", fontSize: 11, fontFamily: "JetBrains Mono",
              outline: "none", minWidth: 0,
            }}
          />
          {recentInputDirs.length > 0 && (
            <select
              value=""
              onChange={e => {
                if (!e.target.value) return;
                setInputDir(e.target.value);
                rememberInputDir?.(e.target.value);
                clearLoadedImages();
              }}
              title="Recent input folders"
              style={{
                width: 34, background: C.panel2, color: C.dim,
                border: `1px solid ${C.border}`, borderRadius: 4,
                fontSize: 10, cursor: "pointer", flexShrink: 0,
              }}
            >
              <option value="">Recent folders</option>
              {recentInputDirs.map(path => <option key={path} value={path}>{path}</option>)}
            </select>
          )}
          <button
            className="inp-btn input-browse-button"
            onClick={browse}
            disabled={browseLoading}
            title="Browse input folder"
            aria-label="Browse input folder"
            style={{
              background: C.panel2, color: C.dim, border: `1px solid ${C.border}`,
              borderRadius: 4, padding: "5px 10px", fontSize: 13,
              cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2.5 5.5h11v6.25a1.25 1.25 0 0 1-1.25 1.25h-8.5A1.25 1.25 0 0 1 2.5 11.75V5.5Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
              <path d="M2.5 5.5V4.25A1.25 1.25 0 0 1 3.75 3h3.1l1.25 1.25h4.15A1.25 1.25 0 0 1 13.5 5.5" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            className="inp-btn input-load-button input-reload-button"
            onClick={() => loadImages({ resetSession: loadedDirRef.current !== inputDir.trim() })}
            disabled={loading || !inputDir.trim()}
            title="Scan the selected folder on demand. No images load while typing."
            style={{
            background: inputDir.trim() ? C.panel2 : "transparent", color: inputDir.trim() ? C.text : C.dim2,
            border: `1px solid ${C.border}`, borderRadius: 4, padding: "5px 10px", fontSize: 11,
            cursor: inputDir.trim() ? "pointer" : "not-allowed", fontFamily: "inherit", flexShrink: 0,
          }}>{loading ? "Loading" : "Load"}</button>
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

        <label className="input-subfolders-toggle" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.dim, flexShrink: 0 }}>
          <input
            type="checkbox"
            checked={includeSubfolders}
            onChange={e => { setIncludeSubfolders(e.target.checked); clearLoadedImages(); }}
          />
          Subfolders
        </label>

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
          <div className="input-selection-actions">
            <button className="inp-btn input-selection-action input-selection-warning" onClick={allExcl ? unexcludeSelected : excludeSelected} style={{
              background: allExcl ? C.panel2 : "var(--yellow-bg)",
              color: allExcl ? C.dim : C.yellow,
              border: `1px solid ${allExcl ? C.border : "var(--yellow-bdr)"}`,
              borderRadius: 4, padding: "4px 12px", fontSize: 11,
              cursor: "pointer", fontFamily: "inherit",
            }}>
              {allExcl ? "Remove exclusion" : "Exclude from BG"}
            </button>
            <button className="inp-btn input-selection-action input-selection-danger" onClick={removeSelected} style={{
              background: "var(--red-bg)", color: C.red, border: `1px solid var(--red-bdr)`,
              borderRadius: 4, padding: "4px 12px", fontSize: 11,
              cursor: "pointer", fontFamily: "inherit",
            }}>Remove from session</button>
            <button className="inp-btn input-selection-clear" onClick={selectNone} style={{
              background: "transparent", color: C.dim, border: "none",
              fontSize: 11, cursor: "pointer", fontFamily: "inherit", marginLeft: "auto",
            }}>Clear</button>
          </div>
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
          ) : !loadedDirRef.current ? (
            <div className="input-pending-state" style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
              <span style={{ color: C.dim, fontSize: 12 }}>Folder selected. Click Load to scan images.</span>
              <span style={{ color: C.dim2, fontSize: 11 }}>Images never auto-load while typing or changing folders.</span>
            </div>
          ) : visible.length === 0 ? (
            <div className="input-zero-state" style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: C.dim, fontSize: 12 }}>No images found{search ? " matching your search" : ""}</span>
            </div>
          ) : (
            <div className="input-grid" style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(156px, 1fr))",
              gap: 12, alignContent: "start",
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
                    className={`inp-thumb inp-card input-thumb input-card${isSel ? " is-selected" : ""}${isExcl ? " is-excluded" : ""}${isPreview ? " is-preview" : ""}`}
                    onClick={e => toggleSelect(imageId, absPath, e, visibleIds)}
                    style={{
                      position: "relative", borderRadius: 18, overflow: "hidden",
                      border: `${isSel ? 2 : 1}px solid ${isSel ? C.blue : isPreview ? "color-mix(in srgb,var(--accent) 40%,var(--border))" : "color-mix(in srgb,var(--border) 75%,transparent)"}`,
                      background: C.panel2, cursor: "pointer",
                      transition: "border-color 0.15s, box-shadow 0.2s, transform 0.2s",
                    }}
                  >
                    {/* Checkbox overlay — top-left */}
                    <div
                      className="inp-cb input-checkbox"
                      style={{
                        position: "absolute", top: 8, right: 8, zIndex: 2,
                        width: 30, height: 30, borderRadius: 999,
                        background: isSel ? C.blue : "rgba(8,11,19,0.58)",
                        border: `1.5px solid ${isSel ? C.blue : "rgba(255,255,255,0.15)"}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13, color: "var(--accent-fg)", fontWeight: 800,
                        pointerEvents: "none",
                      }}
                    >{isSel ? "✓" : ""}</div>

                    {/* Eye icon — top-right, visible on hover only */}
                    <div
                      className="inp-eye input-eye-button"
                      onClick={e => { e.stopPropagation(); setPreviewPath(isPreview ? null : absPath); setPreviewLoadError(false); }}
                      style={{
                        position: "absolute", right: 10, bottom: 10, zIndex: 3,
                        width: 20, height: 20, borderRadius: 999,
                        background: isPreview ? C.blue : "rgba(7,9,16,0.62)",
                        border: `1px solid ${isPreview ? C.blue : "rgba(255,255,255,0.12)"}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 10, cursor: "pointer",
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
                        src={previewUrl(absPath, 200)}
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
                        position: "absolute", top: 12, left: 12,
                        background: "var(--yellow-bg)", color: "var(--yellow)",
                        border: "1px solid var(--yellow-bdr)",
                        fontSize: 8, fontWeight: 700, textAlign: "center",
                        borderRadius: 7, padding: "3px 8px",
                        letterSpacing: "0.08em", textTransform: "uppercase",
                      }}>Excluded</div>
                    )}

                    {/* Filename bar */}
                    <div className="input-filename-bar" style={{
                      padding: "7px 10px",
                      color: isExcl ? C.yellow : C.dim,
                      fontFamily: "JetBrains Mono",
                      background: "color-mix(in srgb, var(--panel) 92%, #000)",
                    }}>
                      <div className="input-filename" style={{
                        fontSize: 9.5,
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
                  src={previewUrl(previewPath, 600)}
                  alt=""
                  onError={() => setPreviewLoadError(true)}
                  style={{ width: "100%", aspectRatio: "1", objectFit: "contain", background: "var(--img-bg)", flexShrink: 0 }}
                />
              )}

              {/* Info + controls */}
              <div className="input-preview-body" style={{ padding: "12px", flex: 1, overflowY: "auto" }}>
                <div className="input-preview-label" style={{ fontSize: 9, color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Filename</div>
                <div className="input-preview-value" style={{
                  fontSize: 10, color: C.text, fontFamily: "JetBrains Mono",
                  wordBreak: "break-all", marginBottom: 16, lineHeight: 1.6,
                }}>{name}</div>
                {!!relFolder && (
                  <>
                    <div className="input-preview-label" style={{ fontSize: 9, color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Folder</div>
                    <div className="input-preview-value" style={{
                      fontSize: 10, color: C.dim, fontFamily: "JetBrains Mono",
                      wordBreak: "break-all", marginBottom: 16, lineHeight: 1.6,
                    }}>{relFolder}</div>
                  </>
                )}
                <div className="input-preview-divider" />

                {/* Exclude toggle */}
                <div className="input-preview-control" style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  marginBottom: 8,
                }}>
                  <span className="input-preview-toggle-label" style={{ fontSize: 11, color: C.dim }}>Exclude from BG removal</span>
                  <button className="inp-btn input-preview-toggle-button" onClick={() => {
                    if (isExcl) setExcludeTags(prev => prev.filter(x => x !== imageId));
                    else setExcludeTags(prev => prev.includes(imageId) ? prev : [...prev, imageId]);
                  }} style={{
                    background: isExcl ? "var(--yellow-bg)" : C.panel2,
                    color: isExcl ? C.yellow : C.dim,
                    border: `1px solid ${isExcl ? "var(--yellow-bdr)" : C.border}`,
                    borderRadius: 4, padding: "4px 10px", fontSize: 10,
                    cursor: "pointer", fontFamily: "inherit",
                  }}>{isExcl ? "Excluded ✓" : "Exclude"}</button>
                </div>
                <div className="input-preview-divider" />

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
