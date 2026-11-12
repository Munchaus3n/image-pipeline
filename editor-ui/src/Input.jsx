import { useState, useCallback, useRef, useMemo } from "react";
import { browseFolder, getJson, previewUrl as apiPreviewUrl } from "./api.js";
import { relativePathFromRoot as relativePathFromInput, imageIdForPath } from "./paths.js";
import {
  ArrowRight, Check, Clock, Eye, FolderOpen, Grid3x3, ImageOff, Trash2, TriangleAlert, X,
} from "lucide-react";
import PageHeader from "./components/PageHeader.jsx";
import {
  Button, Checkbox, IconButton, MenuList, Popover, ResizablePanel, SearchField, Switch, TextField,
} from "./components/ui/index.jsx";
import { useUiPref } from "./hooks/useUiPref.js";

// Large (recursive) folders can take a while to scan.
const IMAGE_SCAN_TIMEOUT_MS = 120000;

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
  const [thumbSize, setThumbSize] = useUiPref("input.thumbSize", 156);
  const [recentOpen, setRecentOpen] = useState(false);
  const recentRef = useRef(null);
  const lastSelectedRef = useRef(null);  // for shift-click range
  const loadedDirRef = useRef("");
  // Bumped on every scan and on clear, so a slow response for an old path is ignored.
  const loadSeqRef = useRef(0);

  const clearLoadedImages = useCallback(() => {
    loadSeqRef.current += 1;
    setLoading(false);
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
    const runSeq = ++loadSeqRef.current;
    const isCurrent = () => runSeq === loadSeqRef.current;
    setLoading(true);
    setLoadError(null);
    setPreviewLoadError(false);
    setThumbLoadErrors(new Set());
    setPreviewVersion(v => v + 1);
    try {
      // Query kept inline: scripts/safe_smoke_test.py checks these markers (explicit, bounded scan).
      const data = await getJson(
        `/images?folder=${encodeURIComponent(folder)}&recursive=${includeSubfolders ? "true" : "false"}&limit=500`,
        IMAGE_SCAN_TIMEOUT_MS,
      );
      if (!isCurrent()) return;
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
    } catch (e) {
      if (!isCurrent()) return;
      setLoadError(e?.status ? (e.detail || `Server error ${e.status}`) : "Could not reach the API server.");
      setThumbs([]);
    }
    finally { if (isCurrent()) setLoading(false); }
  }, [clearLoadedImages, includeSubfolders, inputDir, rememberInputDir, setExcludeTags, setRemovedImages, setThumbs]);

  const previewUrl = useCallback((path, size) => (
    apiPreviewUrl(path, size, previewVersion)
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
  const visible = useMemo(() => {
    const q = search.toLowerCase();
    return imageEntries.filter(entry => {
      if (removedImages.has(entry.imageId)) return false;
      if (!q) return true;
      return entry.name.toLowerCase().includes(q) || entry.relativePath.toLowerCase().includes(q);
    });
  }, [imageEntries, removedImages, search]);
  // visible IDs list used for shift-click range
  const visibleIds = useMemo(() => visible.map(entry => entry.imageId), [visible]);
  const excludeSet = useMemo(() => new Set(excludeTags), [excludeTags]);

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
      const visibleIdSet = new Set(visibleIds);
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
  const allExcl     = selArr.length > 0 && selArr.every(n => excludeSet.has(n));
  // excludeTags that are still in the visible set (not removed)
  const activeExcludeCount = excludeTags.filter(n => !removedImages.has(n)).length;

  return (
    <div className="input-screen">
      <PageHeader
        title="Input"
        subtitle="Choose source images, review exclusions, then continue"
        className="input-app-header"
        actions={(
        <>
          <span className="input-count" aria-live="polite">
            {visible.length} image{visible.length !== 1 ? "s" : ""}
            {truncated && <span className="is-warn"> · first 500</span>}
            {activeExcludeCount > 0 && <span className="is-warn"> · {activeExcludeCount} excluded</span>}
          </span>
          <Button variant="primary" iconEnd={ArrowRight} onClick={onGoToProcess} disabled={!inputDir.trim()}>
            Go to Process
          </Button>
        </>
        )}
      />

      <div className="input-toolbar">
        {/* Folder input + browse */}
        <div className="input-folder-group">
          <TextField
            mono
            className="input-path-field"
            aria-label="Input folder"
            value={inputDir}
            onChange={e => { setInputDir(e.target.value); clearLoadedImages(); }}
            onBlur={() => rememberInputDir?.(inputDir)}
            placeholder="Select input folder…"
            title={inputDir}
          />
          {recentInputDirs.length > 0 && (
            <>
              <IconButton
                ref={recentRef}
                icon={Clock}
                variant="secondary"
                label="Recent input folders"
                aria-haspopup="listbox"
                aria-expanded={recentOpen}
                onClick={() => setRecentOpen(open => !open)}
              />
              <Popover
                open={recentOpen}
                onClose={() => setRecentOpen(false)}
                anchorRef={recentRef}
                width={360}
                align="end"
                label="Recent input folders"
                className="input-recent"
              >
                <MenuList
                  items={recentInputDirs.map(path => ({ value: path, label: path }))}
                  value={inputDir}
                  onSelect={(path) => {
                    setInputDir(path);
                    rememberInputDir?.(path);
                    clearLoadedImages();
                    setRecentOpen(false);
                  }}
                />
              </Popover>
            </>
          )}
          <IconButton
            icon={FolderOpen}
            variant="secondary"
            label="Browse input folder"
            onClick={browse}
            disabled={browseLoading}
          />
          <Button
            onClick={() => loadImages({ resetSession: loadedDirRef.current !== inputDir.trim() })}
            disabled={loading || !inputDir.trim()}
            title="Scan the selected folder on demand. No images load while typing."
          >
            {loading ? "Loading…" : "Load"}
          </Button>
        </div>

        <div className="input-filter-group">
          <SearchField value={search} onChange={setSearch} placeholder="Search by filename" />
          <Checkbox
            checked={includeSubfolders}
            onChange={e => { setIncludeSubfolders(e.target.checked); clearLoadedImages(); }}
            label="Subfolders"
          />
          <div className="input-size">
            <Grid3x3 size={14} aria-hidden="true" />
            <input
              type="range"
              min={110}
              max={260}
              step={10}
              value={thumbSize}
              aria-label="Thumbnail size"
              onChange={e => setThumbSize(parseInt(e.target.value, 10))}
            />
          </div>
          <Button variant="ghost" onClick={selectAll}>All</Button>
          <Button variant="ghost" onClick={selectNone}>None</Button>
        </div>
      </div>

      {/* ── Selection action bar ── */}
      {selected.size > 0 && (
        <div className="input-selection-bar">
          <span className="input-selection-count">{selected.size} selected</span>
          <Button onClick={allExcl ? unexcludeSelected : excludeSelected}>
            {allExcl ? "Remove exclusion" : "Exclude from BG"}
          </Button>
          <Button variant="danger" icon={Trash2} onClick={removeSelected}>Remove from session</Button>
          <span className="input-spacer" />
          <Button variant="ghost" onClick={selectNone}>Clear</Button>
        </div>
      )}

      {/* ── Main area: grid + optional preview panel ── */}
      <div className="input-main">

        {/* Image grid */}
        <div className="input-grid-scroll">
          {!inputDir.trim() ? (
            <div className="input-state">
              <FolderOpen size={32} aria-hidden="true" />
              <strong>Select an input folder</strong>
              <span>Browse for the folder that holds your product photos.</span>
              <Button onClick={browse}>Browse folder</Button>
            </div>
          ) : loading ? (
            <div className="input-state"><span>Loading images…</span></div>
          ) : loadError ? (
            <div className="input-state is-error" role="alert">
              <TriangleAlert size={28} aria-hidden="true" />
              <strong>{loadError}</strong>
              <span>Check that the folder path is correct and try again.</span>
            </div>
          ) : !loadedDirRef.current ? (
            <div className="input-state">
              <strong>Folder selected</strong>
              <span>Click Load to scan images. Nothing loads while you type or change folders.</span>
            </div>
          ) : visible.length === 0 ? (
            <div className="input-state"><span>No images found{search ? " matching your search" : ""}</span></div>
          ) : (
            <div className="input-grid" style={{ "--thumb": `${thumbSize}px` }}>
              {visible.map(entry => {
                const { absPath, name, imageId, relFolder } = entry;
                const ext       = name.includes(".") ? `.${name.split(".").pop().toLowerCase()}` : "";
                const isAvif    = ext === ".avif";
                const isSel     = selected.has(imageId);
                const isExcl    = excludeSet.has(imageId);
                const isPreview = previewPath === absPath;
                const thumbFailed = thumbLoadErrors.has(absPath);
                return (
                  <div
                    key={absPath}
                    className={`input-card${isSel ? " is-selected" : ""}${isExcl ? " is-excluded" : ""}${isPreview ? " is-preview" : ""}`}
                  >
                    <button
                      type="button"
                      className="input-card-select"
                      aria-pressed={isSel}
                      aria-label={`${isSel ? "Deselect" : "Select"} ${name}`}
                      onClick={e => toggleSelect(imageId, absPath, e, visibleIds)}
                    />

                    <span className="input-card-check" aria-hidden="true">
                      {isSel ? <Check size={14} /> : null}
                    </span>

                    <IconButton
                      icon={Eye}
                      label={isPreview ? "Close preview" : "Preview"}
                      size="s"
                      variant="secondary"
                      className="input-card-eye"
                      aria-pressed={isPreview}
                      onClick={() => { setPreviewPath(isPreview ? null : absPath); setPreviewLoadError(false); }}
                    />

                    {/* Thumbnail */}
                    {thumbFailed ? (
                      <div className="input-thumb-fallback">
                        <ImageOff size={18} aria-hidden="true" />
                        <span className="input-thumb-fallback-name">{name}</span>
                        <span>{isAvif ? "AVIF preview unavailable" : "Preview unavailable"}</span>
                      </div>
                    ) : (
                      <img
                        className="input-thumb-image"
                        src={previewUrl(absPath, thumbSize > 180 ? 400 : 200)}
                        alt=""
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
                      />
                    )}

                    {isExcl && <span className="input-card-badge">Excluded</span>}

                    <div className="input-card-meta">
                      <span className="input-card-name" title={name}>{name}</span>
                      {relFolder && <span className="input-card-folder" title={relFolder}>{relFolder}/</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Preview panel ── */}
        {previewPath && (() => {
          const previewEntry = entriesByAbsPath.get(previewPath);
          if (!previewEntry) return null;
          const { name, imageId, relFolder } = previewEntry;
          const previewExt = name.includes(".") ? `.${name.split(".").pop().toLowerCase()}` : "";
          const isExcl = excludeSet.has(imageId);
          return (
            <ResizablePanel
              prefKey="input.preview"
              side="right"
              defaultWidth={280}
              min={220}
              max={460}
              className="input-preview"
              aria-label="Image preview"
            >
              <div className="input-preview-header">
                <span className="input-preview-title">Preview</span>
                <IconButton
                  icon={X}
                  label="Close preview"
                  size="s"
                  onClick={() => { setPreviewPath(null); setPreviewLoadError(false); }}
                />
              </div>

              {previewLoadError ? (
                <div className="input-preview-image input-preview-error">
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
                />
              )}

              <div className="input-preview-body">
                <dl className="input-preview-facts">
                  <dt>Filename</dt>
                  <dd>{name}</dd>
                  {!!relFolder && (
                    <>
                      <dt>Folder</dt>
                      <dd>{relFolder}</dd>
                    </>
                  )}
                </dl>

                <Switch
                  checked={isExcl}
                  label="Exclude from BG removal"
                  onChange={(on) => {
                    if (on) setExcludeTags(prev => prev.includes(imageId) ? prev : [...prev, imageId]);
                    else setExcludeTags(prev => prev.filter(x => x !== imageId));
                  }}
                />

                <Button
                  variant="danger"
                  icon={Trash2}
                  onClick={() => {
                    setExcludeTags(prev => prev.filter(x => x !== imageId));
                    setRemovedImages(prev => { const n = new Set(prev); n.add(imageId); return n; });
                    setPreviewPath(null);
                    setPreviewLoadError(false);
                  }}
                >
                  Remove from session
                </Button>
              </div>
            </ResizablePanel>
          );
        })()}
      </div>
    </div>
  );
}
