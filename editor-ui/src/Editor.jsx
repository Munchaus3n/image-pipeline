/*
KNOWN LIMITATIONS (web build):
- Some settings changes do not hot-apply to an already-open editor session; reopening the Editor tab re-initializes state.
- If pipeline completion happens while already on Editor, use the new reload controls to refresh queue/source.
- /api/browse uses tkinter; desktop Electron should replace this with native dialog APIs.
*/
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import ConfirmModal from "./ConfirmModal.jsx";
import {
  getConfig, getSource, getImages,
  imageUrl, saveComposition, skipImage,
  getSession, saveSession, clearSession,
  browseFolder,
} from "./api.js";
import { apiBase, pathForFile } from "./runtime.js";

// ── Constants ─────────────────────────────────────────────────────────────────
// CANVAS_SIZE: logical composition size (matches pipeline output, e.g. 1440)
// DS: internal canvas pixel buffer — fixed at 720, never changes
// zoom: CSS scale applied to the canvas element for view zoom
let CANVAS_SIZE = 1440;  // mutable module var — kept for non-React drawing functions
const DS = 720;
const DISPLAY_ZOOM_MULTIPLIER = 0.74;
const scaleFactor = () => DS / CANVAS_SIZE;

const BASE = apiBase();
const SINGLE_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/tiff,image/avif,.png,.jpg,.jpeg,.webp,.tif,.tiff,.avif";
const SUPPORTED_SINGLE_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/tiff", "image/avif"]);
const SUPPORTED_SINGLE_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "tif", "tiff", "avif"]);
const DEFAULT_THUMBNAIL_SIZE = 400;

// Opens a folder in the native OS file explorer via the API server
const openFolder = (path = "") =>
  fetch(`${BASE}/open-folder?path=${encodeURIComponent(path)}`).catch(() => {});

const C = {
  bg:"var(--bg)", panel:"var(--panel)", panel2:"var(--panel2)",
  border:"var(--border)", text:"var(--text)", dim:"var(--dim)", dim2:"var(--dim2)",
  green:"var(--green)", blue:"var(--accent)", yellow:"var(--yellow)",
  red:"var(--red)", magenta:"var(--magenta)",
};

function normalizePathKey(path = "") {
  return String(path || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

const DEFAULT_OUTPUT_IDENTITY = "__default_output__";

function normalizeOutputIdentity(path = "") {
  const key = normalizePathKey(path);
  return key || DEFAULT_OUTPUT_IDENTITY;
}

function toForwardSlashes(path = "") {
  return String(path || "").replace(/\\/g, "/");
}

function trimTrailingSlashes(path = "") {
  return path.replace(/\/+$/, "");
}

function relativePathFromRoot(absPath, rootPath) {
  const absNorm = trimTrailingSlashes(toForwardSlashes(absPath).trim());
  const rootNorm = trimTrailingSlashes(toForwardSlashes(rootPath).trim());
  if (!absNorm || !rootNorm) return "";
  const absLower = absNorm.toLowerCase();
  const rootLower = rootNorm.toLowerCase();
  if (absLower === rootLower) return "";
  if (absLower.startsWith(`${rootLower}/`)) return absNorm.slice(rootNorm.length + 1);
  return "";
}

function naturalParts(value = "") {
  return String(value)
    .toLowerCase()
    .split(/(\d+)/)
    .filter(Boolean)
    .map(part => (/^\d+$/.test(part) ? Number(part) : part));
}

function compareNaturalPaths(a, b) {
  const aParts = toForwardSlashes(a).split("/").flatMap(part => [...naturalParts(part), "/"]);
  const bParts = toForwardSlashes(b).split("/").flatMap(part => [...naturalParts(part), "/"]);
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i += 1) {
    if (aParts[i] === undefined) return -1;
    if (bParts[i] === undefined) return 1;
    if (aParts[i] === bParts[i]) continue;
    if (typeof aParts[i] === "number" && typeof bParts[i] === "number") return aParts[i] - bParts[i];
    return String(aParts[i]).localeCompare(String(bParts[i]));
  }
  return 0;
}

function sortImageQueue(images, rootPath) {
  return [...images].sort((a, b) => {
    const relA = relativePathFromRoot(a, rootPath) || a;
    const relB = relativePathFromRoot(b, rootPath) || b;
    return compareNaturalPaths(relA, relB);
  });
}

function imageQueueLabel(path, rootPath) {
  const rel = relativePathFromRoot(path, rootPath);
  return rel || path.split(/[\\/]/).pop();
}

// Returns canvas-pixel-space bounds for an item.
// All hit testing and drawing uses these values (DS-space, not CANVAS_SIZE-space).
function itemBounds(item) {
  const S = scaleFactor();
  const w = item.origW * item.scale * S;
  const h = item.origH * item.scale * S;
  return { x: item.canvasX * S - w / 2, y: item.canvasY * S - h / 2, w, h };
}

function loadImageSize(url) {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 500, height: 500 });
    img.src = url;
  });
}

function loadHtmlImage(url) {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image could not be decoded"));
    img.src = url;
  });
}

function isSupportedSingleImageFile(file) {
  if (!file) return false;
  if (SUPPORTED_SINGLE_IMAGE_MIME_TYPES.has(file.type)) return true;
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  return SUPPORTED_SINGLE_IMAGE_EXTENSIONS.has(extension);
}

function pathDirectory(path = "") {
  const normalized = toForwardSlashes(path).replace(/\/+$/, "");
  const slash = normalized.lastIndexOf("/");
  return slash > 0 ? normalized.slice(0, slash) : "";
}

function commonDirectory(paths = []) {
  const directories = paths.map(pathDirectory).filter(Boolean);
  if (!directories.length) return "";
  const firstParts = directories[0].split("/");
  let end = firstParts.length;
  for (const directory of directories.slice(1)) {
    const parts = directory.split("/");
    end = Math.min(end, parts.length);
    for (let i = 0; i < end; i += 1) {
      if (firstParts[i].toLowerCase() !== parts[i].toLowerCase()) {
        end = i;
        break;
      }
    }
  }
  return firstParts.slice(0, end).join("/");
}

function fileFromEntry(entry) {
  return new Promise((resolve) => {
    entry.file(resolve, () => resolve(null));
  });
}

function readDirectoryEntries(reader) {
  return new Promise((resolve) => {
    reader.readEntries(resolve, () => resolve([]));
  });
}

async function filesFromEntry(entry) {
  if (!entry) return [];
  if (entry.isFile) {
    const file = await fileFromEntry(entry);
    return file && isSupportedSingleImageFile(file) ? [file] : [];
  }
  if (!entry.isDirectory) return [];

  const reader = entry.createReader();
  const files = [];
  while (true) {
    const entries = await readDirectoryEntries(reader);
    if (!entries.length) break;
    const nested = await Promise.all(entries.map(filesFromEntry));
    files.push(...nested.flat());
  }
  return files;
}

async function droppedImageFiles(dataTransfer) {
  const items = Array.from(dataTransfer?.items || []);
  const entries = items
    .map(item => (typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null))
    .filter(Boolean);
  if (entries.length) {
    const nested = await Promise.all(entries.map(filesFromEntry));
    return {
      files: nested.flat(),
      hasDirectory: entries.some(entry => entry.isDirectory),
    };
  }
  const files = Array.from(dataTransfer?.files || []).filter(isSupportedSingleImageFile);
  return { files, hasDirectory: false };
}

function safeDownloadBaseName(name = "edited-image") {
  const baseName = name.replace(/\.[^.]+$/, "").trim() || "edited-image";
  return baseName.replace(/[\\/:*?"<>|]+/g, "-");
}

function finalDownloadName(name = "edited-image") {
  return `${safeDownloadBaseName(name)}.png`;
}

function thumbnailDownloadName(name = "edited-image") {
  return `${safeDownloadBaseName(name)}_thumb.png`;
}

function thumbnailPackagePath(name = "edited-image") {
  return `thumbnail/${finalDownloadName(name)}`;
}

function zipDownloadName(name = "edited-image") {
  return `${safeDownloadBaseName(name)}_editor.zip`;
}

function triggerBlobDownload(blob, filename) {
  const blobUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 1000);
}

function triggerPngDownload(blob, filename) {
  triggerBlobDownload(blob, filename);
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
}

const ZIP_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = ZIP_CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

async function createStoredZipBlob(entries) {
  const textEncoder = new TextEncoder();
  const now = dosDateTime();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const data = new Uint8Array(await entry.blob.arrayBuffer());
    const name = textEncoder.encode(entry.filename);
    const checksum = crc32(data);

    const localHeader = new Uint8Array(30 + name.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, now.time, true);
    localView.setUint16(12, now.date, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(name, 30);
    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + name.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, now.time, true);
    centralView.setUint16(14, now.date, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(name, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);
  endView.setUint16(20, 0, true);

  return new Blob([...localParts, ...centralParts, endRecord], { type: "application/zip" });
}

async function saveOutputSettingsPatch(patch) {
  const response = await fetch(`${BASE}/settings`);
  const data = response.ok ? await response.json() : { settings: {} };
  const current = data?.settings ?? {};
  await fetch(`${BASE}/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      settings: {
        ...current,
        output: { ...(current.output ?? {}), ...patch },
      },
    }),
  });
}

// Renders a template reference image with a proper error fallback
// — key={template} on the call site ensures full remount when template changes
function RefImage({ src }) {
  const [err, setErr] = useState(false);

  if (!src) return null;
  return (
    <div style={{
      borderRadius:4, overflow:"hidden", marginBottom:2,
      border:`1px solid ${C.border}`,
      background:"color-mix(in srgb,var(--accent) 4%,transparent)",
    }}>
      {err ? (
        <div style={{
          height:60, display:"flex", flexDirection:"column",
          alignItems:"center", justifyContent:"center", gap:4,
          color:C.dim, fontSize:9, fontFamily:"JetBrains Mono",
          background:"color-mix(in srgb,var(--border) 30%,transparent)",
        }}>
          <span style={{ fontSize:16, opacity:0.4 }}>🖼</span>
          <span>reference image not found</span>
        </div>
      ) : (
        <img
          src={src}
          alt="reference"
          style={{ width:"100%", display:"block", objectFit:"contain", maxHeight:110 }}
          onError={() => setErr(true)}
        />
      )}
      <div style={{ fontSize:9, color:C.dim, padding:"2px 6px", fontFamily:"JetBrains Mono" }}>reference</div>
    </div>
  );
}

function CollSection({ label, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="editor-tool-section">
      <button
        type="button"
        className="ed-btn editor-tool-toggle"
        onClick={() => setOpen(v => !v)}
        >
        <div className="editor-tool-title">
          <span>{label}</span>
        </div>
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          className="editor-tool-chevron"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
      {open && (
        <div className="editor-tool-content">
          {children}
        </div>
      )}
    </section>
  );
}

function Btn({ children, onClick, style={}, className = "" }) {
  return (
    <button type="button" className={`ed-btn editor-mini-button ${className}`.trim()} onClick={onClick} style={{
      background:C.panel2, color:C.dim, border:`1px solid ${C.border}`,
      borderRadius:8, padding:"7px 8px", fontSize:11, cursor:"pointer",
      width:"100%", textAlign:"left", fontFamily:"inherit",
      transition:"background 0.12s, color 0.12s",
      ...style,
    }}>{children}</button>
  );
}

export default function Editor({ outputDir = "", canvasSize: canvasSizeProp = null, thumbnail: thumbnailProp = true }) {
  const canvasRef    = useRef(null);
  const containerRef = useRef(null);
  const dragRef      = useRef(null);
  const undoRef      = useRef(null);
  const prefetchRef  = useRef(null); // holds pre-loaded next htmlImg + metadata
  const nextItemIdRef = useRef(1);
  const refImageCacheRef = useRef(new Map());
  const confirmResolverRef = useRef(null);
  const configRef = useRef({ guides: {}, templates: {} });
  const sourceLoadSeqRef = useRef(0);
  const resumePromptActiveRef = useRef(false);
  const sessionRunIdRef = useRef("");
  const srcFolderRef = useRef("");
  const singleFileInputRef = useRef(null);
  const singleObjectUrlRef = useRef("");
  const saveInFlightRef = useRef(false);
  // BUG-06 FIX: loadImage is useCallback but called from initFromFolder/advance which
  // need stable references. A ref breaks the circular dep chain cleanly — callers
  // always get the latest version without needing it in their own dep arrays.
  const loadImageRef = useRef(null);

  const [bootstrapReady, setBootstrapReady] = useState(false);
  const [guides,     setGuides]     = useState({});
  const [templates,  setTemplates]  = useState({});
  const [srcFolder,  setSrcFolder]  = useState("");
  const [srcLabel,   setSrcLabel]   = useState("…");
  const [queue,      setQueue]      = useState([]);
  const [queueIdx,   setQueueIdx]   = useState(0);
  const [items,      setItems]      = useState([]);
  const [selId,      setSelId]      = useState(null);
  const [template,   setTemplate]   = useState("— none —");
  const [scaleLocked,setScaleLocked]= useState(false);
  const [comboMode,  setComboMode]  = useState(false);
  const [status,     setStatus]     = useState("loading…");
  const [statusHistory, setStatusHistory] = useState([]);
  const [sidebarResetKey, setSidebarResetKey] = useState(0);
  const [saved,      setSaved]      = useState(false);
  const [guideOpacity, setGuideOpacity] = useState(1.0);  // loaded from settings
  const [canvasBgColor, setCanvasBgColor] = useState("#ffffff");
  const [canvasSizeState, setCanvasSizeState] = useState(1440);
  const [generateThumbnail, setGenerateThumbnail] = useState(Boolean(thumbnailProp));
  const [thumbnailSize, setThumbnailSize] = useState(DEFAULT_THUMBNAIL_SIZE);
  const [sourceStage, setSourceStage] = useState("");
  const [sessionOutputDir, setSessionOutputDir] = useState("");
  const [sourceMode, setSourceMode] = useState("batch");
  const [singleImageName, setSingleImageName] = useState("");
  const [singleDropActive, setSingleDropActive] = useState(false);
  const [activeSnapZone, setActiveSnapZone] = useState(null); // tracks last snapped guide zone
  const [showRefOnCanvas, setShowRefOnCanvas] = useState(true);
  const [refOpacity, setRefOpacity] = useState(0.22);
  const [refCanvasImage, setRefCanvasImage] = useState(null);
  const [confirmState, setConfirmState] = useState(null);

  // Phase 4: canvas view zoom (CSS scale, does not affect composition output)
  const [zoom, setZoom] = useState(1.0);

  const sel = items.find(it => it.id === selId) ?? null;
  const templateRefSrc = useMemo(() => {
    const ri = templates[template]?.ref_image;
    if (!ri) return null;
    if (ri.startsWith("data:")) return ri;
    if (ri.includes("/") || ri.includes("\\")) return `${BASE}/image?path=${encodeURIComponent(ri)}`;
    return `${BASE}/templates/image?name=${encodeURIComponent(ri)}`;
  }, [template, templates]);

  useEffect(() => {
    if (!sel && items.length > 0) setSelId(items[0].id);
  }, [items, sel]);

  useEffect(() => {
    if (selId !== null) {
      containerRef.current?.focus({ preventScroll: true });
    }
  }, [selId]);

  useEffect(() => {
    let cancelled = false;
    if (!templateRefSrc) {
      setRefCanvasImage(null);
      return () => { cancelled = true; };
    }

    const cacheKey = `${template}::${templateRefSrc}`;
    const cache = refImageCacheRef.current;
    let loader = cache.get(cacheKey);
    if (!loader) {
      loader = new Promise((resolve) => {
        const img = new window.Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = templateRefSrc;
      });
      cache.set(cacheKey, loader);
      if (cache.size > 32) {
        const first = cache.keys().next().value;
        if (first) cache.delete(first);
      }
    }

    loader.then((img) => {
      if (!cancelled) setRefCanvasImage(img);
    });
    return () => { cancelled = true; };
  }, [template, templateRefSrc]);

  const askConfirm = useCallback((title, message, confirmLabel = "Confirm", cancelLabel = "Cancel") => {
    return new Promise((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmState({ title, message, confirmLabel, cancelLabel });
    });
  }, []);

  const closeConfirm = useCallback((confirmed) => {
    confirmResolverRef.current?.(confirmed);
    confirmResolverRef.current = null;
    setConfirmState(null);
  }, []);

  const outputRoot = useMemo(() => {
    if (!srcFolder) return "";
    const normalized = srcFolder.replace(/\\/g, "/");
    if (normalized.endsWith("/processed") || normalized.endsWith("/upscaled")) {
      return srcFolder.replace(/[\\/](processed|upscaled)$/i, "");
    }
    return srcFolder;
  }, [srcFolder]);
  const requestedOutputDir = useMemo(() => outputDir.trim(), [outputDir]);
  const effectiveOutputDir = useMemo(() => requestedOutputDir || sessionOutputDir, [requestedOutputDir, sessionOutputDir]);
  const activeOutputDir = useMemo(() => effectiveOutputDir || outputRoot, [effectiveOutputDir, outputRoot]);
  const currentOutputIdentity = useMemo(
    () => normalizeOutputIdentity(requestedOutputDir),
    [requestedOutputDir],
  );
  const isSingleImageMode = sourceMode === "single";

  const revokeSingleImageUrl = useCallback(() => {
    if (!singleObjectUrlRef.current) return;
    window.URL.revokeObjectURL(singleObjectUrlRef.current);
    singleObjectUrlRef.current = "";
  }, []);

  useEffect(() => revokeSingleImageUrl, [revokeSingleImageUrl]);

  // ── BUG-06 FIX: convert plain functions to useCallback for stable references ──

  const resetEditorToDefaultState = useCallback(() => {
    revokeSingleImageUrl();
    prefetchRef.current = null;
    undoRef.current = null;
    dragRef.current = null;
    setSourceMode("batch");
    setSingleImageName("");
    setSrcLabel(srcFolder || "No image loaded");
    setQueue([]);
    setQueueIdx(0);
    setComboMode(false);
    setItems([]);
    setSelId(null);
    setActiveSnapZone(null);
    setSaved(false);
    setSourceStage(srcFolder ? sourceStage : "none");
    setSidebarResetKey(key => key + 1);
  }, [revokeSingleImageUrl, sourceStage, srcFolder]);

  // allDone has no state/callback deps — clearSession is a stable import
  const allDone = useCallback(async () => {
    resetEditorToDefaultState();
    setStatus(`all images processed.\noutput → ${activeOutputDir}/Editor/`);
    await clearSession().catch(() => {});
  }, [activeOutputDir, resetEditorToDefaultState]);

  // prefetchNextImage: reads template/guides to pre-size the placement
  const prefetchNextImage = useCallback((q, nextIdx) => {
    if (nextIdx >= q.length) { prefetchRef.current = null; return; }
    const path = q[nextIdx];
    const url  = imageUrl(path);
    const htmlImg = new window.Image();
    prefetchRef.current = new Promise((resolve) => {
      htmlImg.onload = () => {
        const activeZone = templates[template]?.zone || "green";
        const g = guides[activeZone] ?? guides["green"] ?? { top:224, bottom:1216 };
        resolve({
          path, url, htmlImg,
          width:  htmlImg.naturalWidth,
          height: htmlImg.naturalHeight,
          g,
        });
      };
      htmlImg.onerror = () => resolve(null);
      htmlImg.src = url;
    });
  }, [templates, template, guides]);

  // loadImage: stable per template/guides/comboMode combo; calls allDone when queue exhausted
  const loadImage = useCallback(async (q, idx, isCombo, guidesOverride) => {
    if (idx >= q.length) { allDone(); return; }

    let prefetched = null;
    if (prefetchRef.current) {
      prefetched = await prefetchRef.current;
      prefetchRef.current = null;
      if (prefetched && prefetched.path !== q[idx]) prefetched = null;
    }

    let htmlImg, width, height;
    if (prefetched) {
      ({ htmlImg, width, height } = prefetched);
    } else {
      const path = q[idx];
      const url  = imageUrl(path);
      ({ width, height } = await loadImageSize(url));
      htmlImg = new window.Image();
      await new Promise(r => { htmlImg.onload = r; htmlImg.onerror = r; htmlImg.src = url; });
    }

    const path = q[idx];
    const activeZone = templates[template]?.zone || "green";
    const guideSrc   = guidesOverride ?? guides;
    const g          = guideSrc[activeZone] ?? guideSrc["green"] ?? { top:224, bottom:1216, left:224, right:1216 };
    const initScale  = (g.bottom - g.top) / height;

    const newItem = {
      id:       nextItemIdRef.current++,
      label:    imageQueueLabel(path, srcFolderRef.current),
      filePath: path,
      canvasX:  CANVAS_SIZE / 2,
      canvasY:  Math.round((g.top + g.bottom) / 2),
      scale:    initScale,
      origW:    width,
      origH:    height,
      htmlImg,
    };

    if (isCombo) {
      setItems(prev => [...prev, newItem]);
    } else {
      setItems([newItem]);
    }
    setSelId(newItem.id);
  }, [template, templates, guides, comboMode, allDone]); // eslint-disable-line react-hooks/exhaustive-deps
  // comboMode is unused in loadImage body but kept for correctness (isCombo arg is passed in)

  // Keep the ref in sync so initFromFolder/advance always call the latest version
  // without needing loadImage in their own dep arrays (breaks circular dep chain).
  loadImageRef.current = loadImage;

  // initFromFolder: stable (uses loadImageRef to avoid circular dep on loadImage)
  const initFromFolder = useCallback(async (folder, startIdx, guidesOverride) => {
    const result = await getImages(folder);
    const nextQueue = sortImageQueue(result.images, folder);
    revokeSingleImageUrl();
    srcFolderRef.current = folder;
    setSourceMode("batch");
    setSingleImageName("");
    setSrcFolder(folder);
    setSrcLabel(folder);
    setQueue(nextQueue);
    setQueueIdx(startIdx);
    setItems([]);
    setSelId(null);
    setActiveSnapZone(null);
    await loadImageRef.current(nextQueue, startIdx, false, guidesOverride);
    setStatus("");
  }, [revokeSingleImageUrl]); // getImages is a stable import; all setters are stable; uses ref for loadImage

  const initFromDroppedPaths = useCallback(async (paths, label = "Dropped folder") => {
    const uniquePaths = [...new Set(paths.filter(Boolean))];
    if (!uniquePaths.length) return;
    const root = commonDirectory(uniquePaths);
    const nextQueue = sortImageQueue(uniquePaths, root);
    revokeSingleImageUrl();
    prefetchRef.current = null;
    undoRef.current = null;
    dragRef.current = null;
    srcFolderRef.current = root;
    sessionRunIdRef.current = `drop-${Date.now()}`;
    setSourceMode("batch");
    setSingleImageName("");
    setSessionOutputDir("");
    setSourceStage("dropped");
    setSrcFolder(root);
    setSrcLabel(label);
    setQueue(nextQueue);
    setQueueIdx(0);
    setItems([]);
    setSelId(null);
    setActiveSnapZone(null);
    setSaved(false);
    await loadImageRef.current(nextQueue, 0, false, configRef.current.guides);
    setStatus(`Loaded ${nextQueue.length} image${nextQueue.length === 1 ? "" : "s"} from dropped folder.`);
  }, [revokeSingleImageUrl]);

  // ── Init effect ───────────────────────────────────────────────────────────
  const clearToEmptySource = useCallback((message, label = "no output") => {
    revokeSingleImageUrl();
    setSourceMode("batch");
    setSingleImageName("");
    setSrcFolder("");
    setSrcLabel(label);
    setQueue([]);
    setQueueIdx(0);
    setItems([]);
    setSelId(null);
    setActiveSnapZone(null);
    setSourceStage("none");
    setStatus(message);
  }, [revokeSingleImageUrl]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await getConfig();

        let settings = {};
        try {
          const sRes = await fetch(`${BASE}/settings`);
          if (sRes.ok) {
            const sData = await sRes.json();
            settings = sData?.settings ?? {};
          }
        } catch {
          void 0;
        }

        let resolvedSize = canvasSizeProp ?? cfg.canvas_size;
        const fromSettings = settings?.output?.canvas_size;
        if (!canvasSizeProp && fromSettings && fromSettings > 0) {
          resolvedSize = fromSettings;
        }

        const nextGuides = { ...cfg.guides };
        if (settings?.guides?.use_custom && settings?.guides?.custom) {
          for (const [zone, vals] of Object.entries(settings.guides.custom)) {
            if (!nextGuides[zone]) continue;
            nextGuides[zone] = { ...nextGuides[zone], ...vals };
          }
        }

        if (cancelled) return;
        CANVAS_SIZE = resolvedSize;
        setCanvasSizeState(resolvedSize);
        setGuides(nextGuides);
        setTemplates(cfg.templates);
        configRef.current = { guides: nextGuides, templates: cfg.templates };

        const opacity = settings?.appearance?.guide_opacity;
        if (typeof opacity === "number") setGuideOpacity(Math.max(0, Math.min(1, opacity)));
        const bg = settings?.appearance?.canvas_bg_color;
        if (typeof bg === "string" && bg) setCanvasBgColor(bg);
        if (typeof settings?.output?.thumbnail === "boolean") setGenerateThumbnail(settings.output.thumbnail);
        const savedThumbnailSize = Number(settings?.output?.thumbnail_size);
        if (Number.isFinite(savedThumbnailSize) && savedThumbnailSize > 0) {
          setThumbnailSize(Math.round(savedThumbnailSize));
        }
        setBootstrapReady(true);
      } catch (e) {
        setStatus(`API error: ${e.message}\nIs api.py running?`);
      }
    })();

    return () => { cancelled = true; };
  }, [canvasSizeProp]);

  const loadEditorSource = useCallback(async () => {
    if (!bootstrapReady || resumePromptActiveRef.current) return;

    const runSeq = ++sourceLoadSeqRef.current;
    const stillCurrent = () => runSeq === sourceLoadSeqRef.current;
    const guidesForInit = configRef.current.guides;
    const templateMap = configRef.current.templates;
    const currentOutput = requestedOutputDir;

    try {
      const session = await getSession();
      if (!stillCurrent()) return;

      if (session.exists) {
        const sessionOutputDir = (session.output_dir ?? "").trim();
        const outputMismatch = requestedOutputDir && normalizeOutputIdentity(sessionOutputDir) !== currentOutputIdentity;
        const currentOutputLabel = currentOutput || "./output";

        if (outputMismatch) {
          setStatus(`Ignored stale session output (${sessionOutputDir || "./output"}); using current output (${currentOutputLabel}).`);
          await clearSession().catch(() => {});
        } else if (session.completed) {
          sessionRunIdRef.current = session.run_id || `pipeline-${Date.now()}`;
          setSessionOutputDir(sessionOutputDir);
          setSourceStage(session.source_stage || "");
          await initFromFolder(session.src_root, 0, guidesForInit);
          return;
        } else {
          setSessionOutputDir(sessionOutputDir);
          resumePromptActiveRef.current = true;
          const resume = await askConfirm(
            "Resume previous editor session?",
            `Resume from image ${session.queue_index + 1}/${session.total}?\nsource: ${session.src_root}\noutput: ${sessionOutputDir || "./output"}`,
            "Resume",
            "Start over",
          );
          resumePromptActiveRef.current = false;
          if (!stillCurrent()) {
            queueMicrotask(() => { loadEditorSource().catch(() => {}); });
            return;
          }
          if (resume) {
            sessionRunIdRef.current = session.run_id || `editor-${Date.now()}`;
            setSourceStage(session.source_stage || "");
            await initFromFolder(session.src_root, session.queue_index, guidesForInit);
            if (session.template && templateMap[session.template]) setTemplate(session.template);
            return;
          }
          await clearSession().catch(() => {});
        }
      }

      setSessionOutputDir("");
      const src = await getSource(currentOutput);
      if (!stillCurrent()) return;
      if (!src?.found || !src?.folder) {
        clearToEmptySource(
          currentOutput
            ? "No processed or upscaled images found for this output folder."
            : "No processed or upscaled output found. Using default ./input.",
          src?.label || "no output",
        );
        return;
      }
      sessionRunIdRef.current = `editor-${Date.now()}`;
      setSourceStage(src.source_stage || "");
      setSrcLabel(src.label);
      await initFromFolder(src.folder, 0, guidesForInit);
    } catch (e) {
      if (stillCurrent()) setStatus(`API error: ${e.message}\nIs api.py running?`);
    } finally {
      resumePromptActiveRef.current = false;
    }
  }, [askConfirm, bootstrapReady, clearToEmptySource, initFromFolder, requestedOutputDir, currentOutputIdentity]);

  useEffect(() => {
    loadEditorSource().catch(() => {});
  }, [loadEditorSource]);

  useEffect(() => {
    const message = String(status || "").trim();
    if (!message || message === "loading…") return;
    setStatusHistory(prev => {
      if (prev[0]?.message === message) return prev;
      return [{
        id: `${Date.now()}-${message}`,
        message,
        time: new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }),
      }, ...prev].slice(0, 6);
    });
  }, [status]);

  const loadSingleImageFile = useCallback(async (file) => {
    if (!file) return;
    if (!bootstrapReady) {
      setStatus("Editor is still loading. Try the image again in a moment.");
      return;
    }
    if (!isSupportedSingleImageFile(file)) {
      setStatus("Unsupported file. Use PNG, JPG, JPEG, WebP, TIFF, or AVIF.");
      return;
    }

    const objectUrl = window.URL.createObjectURL(file);
    try {
      const htmlImg = await loadHtmlImage(objectUrl);
      const activeZone = templates[template]?.zone || "green";
      const guideSrc = configRef.current.guides || guides;
      const guide = guideSrc[activeZone] ?? guideSrc.green ?? { top:224, bottom:1216, left:224, right:1216 };
      const initScale = (guide.bottom - guide.top) / htmlImg.naturalHeight;
      const previousUrl = singleObjectUrlRef.current;

      singleObjectUrlRef.current = objectUrl;
      if (previousUrl && previousUrl !== objectUrl) window.URL.revokeObjectURL(previousUrl);
      prefetchRef.current = null;
      undoRef.current = null;
      dragRef.current = null;
      srcFolderRef.current = "";
      sessionRunIdRef.current = `single-${Date.now()}`;

      const nextItem = {
        id: nextItemIdRef.current++,
        label: file.name,
        filePath: objectUrl,
        canvasX: CANVAS_SIZE / 2,
        canvasY: Math.round((guide.top + guide.bottom) / 2),
        scale: initScale,
        origW: htmlImg.naturalWidth,
        origH: htmlImg.naturalHeight,
        htmlImg,
      };

      setSourceMode("single");
      setSingleImageName(file.name);
      setSessionOutputDir("");
      setSourceStage("single");
      setSrcFolder("");
      setSrcLabel(file.name);
      setQueue([file.name]);
      setQueueIdx(0);
      setComboMode(false);
      setItems([nextItem]);
      setSelId(nextItem.id);
      setActiveSnapZone(null);
      setSaved(false);
      setStatus("Single image loaded. Use Download for a local PNG export.");
    } catch (error) {
      window.URL.revokeObjectURL(objectUrl);
      setStatus(`single image load failed: ${error.message}`);
    }
  }, [bootstrapReady, guides, template, templates]);

  const loadSingleImageFromFiles = useCallback((fileList) => {
    const files = Array.from(fileList || []);
    const [file] = files;
    if (!file) return;
    if (files.length > 1) {
      setStatus("One image at a time. Loading the first file only.");
    }
    loadSingleImageFile(file).catch((error) => {
      setStatus(`single image load failed: ${error.message}`);
    });
  }, [loadSingleImageFile]);

  const onSingleImageInputChange = useCallback((event) => {
    loadSingleImageFromFiles(event.target.files);
    event.target.value = "";
  }, [loadSingleImageFromFiles]);

  const onSingleImageDragOver = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    setSingleDropActive(true);
  }, []);

  const onSingleImageDragLeave = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    setSingleDropActive(false);
  }, []);

  const onSingleImageDrop = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    setSingleDropActive(false);
    droppedImageFiles(event.dataTransfer)
      .then(async ({ files, hasDirectory }) => {
        if (!files.length) {
          setStatus(hasDirectory ? "Dropped folder does not contain supported images." : "Unsupported file. Use PNG, JPG, JPEG, WebP, TIFF, or AVIF.");
          return;
        }
        if (hasDirectory) {
          const paths = files.map(file => pathForFile(file)).filter(Boolean);
          if (!paths.length) {
            setStatus("Folder drop needs the desktop app so image paths can be loaded.");
            return;
          }
          await initFromDroppedPaths(paths, commonDirectory(paths) || "Dropped folder");
          return;
        }
        loadSingleImageFromFiles(files);
      })
      .catch((error) => {
        setStatus(`drop failed: ${error.message}`);
      });
  }, [initFromDroppedPaths, loadSingleImageFromFiles]);

  const browseSingleImage = useCallback(() => {
    singleFileInputRef.current?.click();
  }, []);

  // ── BUG-17 FIX: advance was a plain function — converted to useCallback ──
  // Uses loadImageRef so loadImage doesn't need to be in deps (avoids stale closure).
  const advance = useCallback(() => {
    const nextIdx = queueIdx + 1;
    setQueueIdx(nextIdx);
    setActiveSnapZone(null);
    undoRef.current = null;
    dragRef.current = null;
    if (!comboMode) { setItems([]); setSelId(null); }
    loadImageRef.current(queue, nextIdx, comboMode);
  }, [queueIdx, comboMode, queue]);

  // ── Canvas draw ───────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || Object.keys(guides).length === 0) return;
    const ctx = canvas.getContext("2d");
    const S   = scaleFactor();
    ctx.clearRect(0, 0, DS, DS);
    ctx.fillStyle = canvasBgColor;
    ctx.fillRect(0, 0, DS, DS);

    // 1. Draw template reference overlay
    if (showRefOnCanvas && refCanvasImage?.complete && refCanvasImage.naturalWidth > 0 && refCanvasImage.naturalHeight > 0) {
      const contain = Math.min(DS / refCanvasImage.naturalWidth, DS / refCanvasImage.naturalHeight);
      const rw = refCanvasImage.naturalWidth * contain;
      const rh = refCanvasImage.naturalHeight * contain;
      const rx = (DS - rw) / 2;
      const ry = (DS - rh) / 2;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, refOpacity));
      ctx.drawImage(refCanvasImage, rx, ry, rw, rh);
      ctx.restore();
    }

    // 2. Draw product images
    ctx.setLineDash([]);
    for (const item of items) {
      const { x, y, w, h } = itemBounds(item);
      if (item.htmlImg?.complete) {
        ctx.drawImage(item.htmlImg, x, y, w, h);
      } else {
        ctx.fillStyle = "#3b82f644";
        ctx.fillRect(x, y, w, h);
      }
    }

    // 3. Selection highlight
    if (sel) {
      const { x, y, w, h } = itemBounds(sel);
      ctx.strokeStyle = "rgba(250,204,21,0.85)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(x-2, y-2, w+4, h+4);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(250,204,21,0.9)";
      [[x-2,y-2],[x+w+2,y-2],[x-2,y+h+2],[x+w+2,y+h+2]].forEach(([hx,hy]) => {
        ctx.fillRect(hx-3, hy-3, 6, 6);
      });
    }

    // 4. All guides — dashed lines
    const opHex = Math.round(guideOpacity * 255).toString(16).padStart(2, "0");
    for (const g of Object.values(guides)) {
      const t=g.top*S, b=g.bottom*S, l=g.left*S, r=g.right*S;
      ctx.strokeStyle = g.color + opHex;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0,t); ctx.lineTo(DS,t);
      ctx.moveTo(0,b); ctx.lineTo(DS,b);
      ctx.moveTo(l,0); ctx.lineTo(l,DS);
      ctx.moveTo(r,0); ctx.lineTo(r,DS);
      ctx.stroke();
    }

    // 5. Active snap zone — solid colored border
    const snapZone = activeSnapZone && guides[activeSnapZone] ? activeSnapZone : null;
    if (snapZone) {
      const g = guides[snapZone];
      const t=g.top*S, b=g.bottom*S, l=g.left*S, r=g.right*S;
      ctx.setLineDash([]);
      ctx.fillStyle = g.color + "08";
      ctx.fillRect(l, t, r-l, b-t);
      ctx.strokeStyle = g.color + "ee";
      ctx.lineWidth = 2.5;
      ctx.strokeRect(l, t, r-l, b-t);
      const cs = 10;
      ctx.lineWidth = 3;
      ctx.strokeStyle = g.color;
      [[l,t,1,1],[r,t,-1,1],[l,b,1,-1],[r,b,-1,-1]].forEach(([cx,cy,dx,dy]) => {
        ctx.beginPath();
        ctx.moveTo(cx+dx*cs, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy+dy*cs);
        ctx.stroke();
      });
    }

    ctx.setLineDash([]);
  }, [items, selId, sel, template, scaleLocked, guides, templates, guideOpacity, canvasBgColor, activeSnapZone, showRefOnCanvas, refOpacity, refCanvasImage]);

  // ── Wheel zoom (product scale) ────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e) => {
      e.preventDefault();
      if (scaleLocked || !selId) return;
      const f = e.deltaY < 0 ? 1.04 : 0.96;
      setItems(prev => prev.map(it =>
        it.id===selId ? {...it, scale: Math.max(0.02, Math.min(4.0, it.scale*f))} : it
      ));
    };
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, [scaleLocked, selId]);

  // ── Mouse helpers ─────────────────────────────────────────────────────────
  const toCanvasCoords = (clientX, clientY) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const rx = canvasRef.current.width  / rect.width;
    const ry = canvasRef.current.height / rect.height;
    return {
      mx: (clientX - rect.left) * rx,
      my: (clientY - rect.top)  * ry,
    };
  };

  const onMouseDown = useCallback((e) => {
    const { mx, my } = toCanvasCoords(e.clientX, e.clientY);
    for (let i = items.length-1; i >= 0; i--) {
      const it = items[i];
      const { x,y,w,h } = itemBounds(it);
      if (mx>=x && mx<=x+w && my>=y && my<=y+h) {
        undoRef.current = { id:it.id, canvasX:it.canvasX, canvasY:it.canvasY, scale:it.scale };
        setSelId(it.id);
        dragRef.current = {
          itemId: it.id,
          ox: mx - it.canvasX * scaleFactor(),
          oy: my - it.canvasY * scaleFactor(),
        };
        containerRef.current?.focus();
        return;
      }
    }
    setSelId(null);
    dragRef.current = null;
  }, [items]);

  const onMouseMove = useCallback((e) => {
    if (!dragRef.current) return;
    const { mx, my } = toCanvasCoords(e.clientX, e.clientY);
    const S = scaleFactor();
    const { itemId, ox, oy } = dragRef.current;
    setItems(prev => prev.map(it =>
      it.id===itemId ? {...it, canvasX:Math.round((mx-ox)/S), canvasY:Math.round((my-oy)/S)} : it
    ));
  }, []);

  const onMouseUp = useCallback(() => { dragRef.current = null; }, []);

  const doUndo = useCallback(() => {
    if (!undoRef.current) return;
    const { id,canvasX,canvasY,scale } = undoRef.current;
    setItems(prev => prev.map(it => it.id===id ? {...it,canvasX,canvasY,scale} : it));
    undoRef.current = null;
    setStatus("undone.");
  }, []);

  const saveSessionCheckpoint = useCallback(async (nextQueueIndex) => {
    await saveSession({
      src_root: srcFolder,
      queue_index: nextQueueIndex,
      template,
      output_dir: effectiveOutputDir,
      input_dir: sourceStage === "input" ? srcFolder : "",
      source_stage: sourceStage,
      run_id: sessionRunIdRef.current || `editor-${Date.now()}`,
      timestamp: Date.now(),
    });
  }, [effectiveOutputDir, srcFolder, template, sourceStage]);

  const toggleGenerateThumbnail = useCallback((enabled) => {
    setGenerateThumbnail(enabled);
    saveOutputSettingsPatch({ thumbnail: enabled }).catch(() => {
      setStatus("thumbnail preference changed locally, but settings save failed");
    });
  }, []);

  const renderExportCanvas = useCallback(({ includeBackground = true } = {}) => {
    const exportSize = canvasSizeProp ?? canvasSizeState;
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = exportSize;
    exportCanvas.height = exportSize;
    const ctx = exportCanvas.getContext("2d");
    const renderScale = exportSize / CANVAS_SIZE;

    ctx.clearRect(0, 0, exportSize, exportSize);
    if (includeBackground) {
      ctx.fillStyle = canvasBgColor;
      ctx.fillRect(0, 0, exportSize, exportSize);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    for (const item of items) {
      if (!item.htmlImg?.complete || item.htmlImg.naturalWidth <= 0) continue;
      const width = Math.max(1, Math.round(item.origW * item.scale * renderScale));
      const height = Math.max(1, Math.round(item.origH * item.scale * renderScale));
      const x = Math.round(item.canvasX * renderScale - width / 2);
      const y = Math.round(item.canvasY * renderScale - height / 2);
      ctx.drawImage(item.htmlImg, x, y, width, height);
    }

    return exportCanvas;
  }, [canvasBgColor, canvasSizeProp, canvasSizeState, items]);

  const renderThumbnailCanvas = useCallback((exportCanvas) => {
    const size = Math.max(1, Math.round(thumbnailSize || DEFAULT_THUMBNAIL_SIZE));
    const thumbnailCanvas = document.createElement("canvas");
    thumbnailCanvas.width = size;
    thumbnailCanvas.height = size;
    const ctx = thumbnailCanvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(exportCanvas, 0, 0, size, size);
    return thumbnailCanvas;
  }, [thumbnailSize]);

  const doDownload = useCallback(async (fromSave = false) => {
    if (!items.length) {
      setStatus("No image loaded. Drop or browse a single image first.");
      return false;
    }

    const exportCanvas = renderExportCanvas({ includeBackground: !isSingleImageMode });
    const finalBlob = await canvasToPngBlob(exportCanvas);
    if (!finalBlob) {
      setStatus("download failed: browser could not create PNG");
      return false;
    }

    const currentName = isSingleImageMode
      ? singleImageName
      : imageQueueLabel(queue[queueIdx] || items[0]?.label || "edited-image", srcFolder);

    let thumbnailBlob = null;
    if (generateThumbnail) {
      const thumbnailCanvas = renderThumbnailCanvas(exportCanvas);
      thumbnailBlob = await canvasToPngBlob(thumbnailCanvas);
      if (!thumbnailBlob) {
        setStatus("download failed: browser could not create thumbnail PNG");
        return false;
      }
    }

    let packageDownloaded = false;
    if (isSingleImageMode && thumbnailBlob) {
      const packageBlob = await createStoredZipBlob([
        { filename: finalDownloadName(currentName), blob: finalBlob },
        { filename: thumbnailPackagePath(currentName), blob: thumbnailBlob },
      ]);
      triggerBlobDownload(packageBlob, zipDownloadName(currentName));
      packageDownloaded = true;
    } else {
      triggerPngDownload(finalBlob, finalDownloadName(currentName));
      if (thumbnailBlob) triggerPngDownload(thumbnailBlob, thumbnailDownloadName(currentName));
    }

    if (fromSave) setSaved(true);
    const downloadLabel = packageDownloaded
      ? "downloaded ZIP package."
      : thumbnailBlob ? "downloaded PNG + thumbnail." : "downloaded PNG.";
    setStatus(fromSave && isSingleImageMode
      ? `${downloadLabel} Single image mode does not write to batch output.`
      : downloadLabel);
    if (fromSave && isSingleImageMode) resetEditorToDefaultState();
    if (fromSave) window.setTimeout(() => setSaved(false), 1600);
    return true;
  }, [generateThumbnail, isSingleImageMode, items, queue, queueIdx, renderExportCanvas, renderThumbnailCanvas, resetEditorToDefaultState, singleImageName, srcFolder]);

  const doSave = useCallback(async () => {
    if (saveInFlightRef.current) return;
    if (!items.length) return;
    saveInFlightRef.current = true;
    try {
      if (isSingleImageMode) {
        await doDownload(true);
        return;
      }
      prefetchNextImage(queue, queueIdx + 1);

      const payload = items.map(it => ({
        image_path: it.filePath,
        canvas_x:   it.canvasX,
        canvas_y:   it.canvasY,
        scale:      it.scale,
      }));
      const result = await saveComposition(
        payload, srcFolder, queueIdx, comboMode,
        generateThumbnail,
        canvasSizeProp ?? canvasSizeState,
        activeOutputDir,
      );
      setSaved(true);
      setStatus(`saved: ${result.saved.split(/[\\/]/).pop()}${generateThumbnail && result.thumb ? " + thumbnail" : ""}`);
      setTimeout(() => setSaved(false), 1600);
      await saveSessionCheckpoint(queueIdx + 1);
      advance();
    } catch (e) {
      prefetchRef.current = null;
      setStatus(`save failed: ${e.message}`);
    } finally {
      saveInFlightRef.current = false;
    }
  }, [items, isSingleImageMode, doDownload, queue, queueIdx, srcFolder, comboMode, generateThumbnail, canvasSizeProp, canvasSizeState, advance, prefetchNextImage, activeOutputDir, saveSessionCheckpoint]);

  const doSkip = useCallback(async () => {
    if (isSingleImageMode) return;
    prefetchNextImage(queue, queueIdx + 1);
    if (queueIdx < queue.length) {
      try { await skipImage(queue[queueIdx], srcFolder, activeOutputDir); } catch { void 0; }
    }
    await saveSessionCheckpoint(queueIdx + 1).catch(() => {});
    setStatus("skipped.");
    advance();
  }, [isSingleImageMode, queue, queueIdx, advance, prefetchNextImage, srcFolder, activeOutputDir, saveSessionCheckpoint]);

  const onKeyDown = useCallback((e) => {
    const target = e.target;
    const tagName = target?.tagName?.toLowerCase?.() || "";
    const isEditingText = (
      tagName === "input" ||
      tagName === "select" ||
      tagName === "textarea" ||
      target?.isContentEditable
    );
    if (e.key === "Enter") {
      if (isEditingText || saveInFlightRef.current) return;
      e.preventDefault();
      doSave();
      return;
    }
    const n = e.shiftKey ? 10 : 1;
    const map = { ArrowLeft:[-n,0], ArrowRight:[n,0], ArrowUp:[0,-n], ArrowDown:[0,n] };
    if (map[e.key]) {
      e.preventDefault();
      if (!selId) return;
      const [dx,dy] = map[e.key];
      setItems(prev => prev.map(it => it.id===selId ? {...it,canvasX:it.canvasX+dx,canvasY:it.canvasY+dy} : it));
      return;
    }
    if (e.key==="s"||e.key==="S") doSkip();
    if ((e.ctrlKey||e.metaKey) && e.key==="z") doUndo();
  }, [selId, doSave, doSkip, doUndo]);

  function removeSelected() {
    if (!selId) return;
    setItems(prev => prev.filter(it => it.id!==selId));
    setSelId(null);
  }

  function snapTo(zone) {
    if (!sel) { setStatus("select an item first."); return; }
    const g = guides[zone];
    if (!g) return;
    undoRef.current = { id:sel.id, canvasX:sel.canvasX, canvasY:sel.canvasY, scale:sel.scale };
    setItems(prev => prev.map(it =>
      it.id===selId ? {
        ...it,
        scale:   (g.bottom - g.top) / it.origH,
        canvasX: CANVAS_SIZE / 2,
        canvasY: Math.round((g.top + g.bottom) / 2),
      } : it
    ));
    setActiveSnapZone(zone);
  }

  function snapToFull() {
    if (!sel) { setStatus("select an item first."); return; }
    undoRef.current = { id:sel.id, canvasX:sel.canvasX, canvasY:sel.canvasY, scale:sel.scale };
    const snapScale = Math.min(CANVAS_SIZE / sel.origW, CANVAS_SIZE / sel.origH);
    setItems(prev => prev.map(it =>
      it.id===selId ? {
        ...it,
        scale:   snapScale,
        canvasX: CANVAS_SIZE / 2,
        canvasY: CANVAS_SIZE / 2,
      } : it
    ));
    setActiveSnapZone(null);
  }

  function doAlign(axis) {
    if (!selId) return;
    undoRef.current = sel ? { id:sel.id, canvasX:sel.canvasX, canvasY:sel.canvasY, scale:sel.scale } : null;
    setItems(prev => prev.map(it =>
      it.id===selId
        ? axis==="h" ? {...it,canvasX:CANVAS_SIZE/2} : {...it,canvasY:CANVAS_SIZE/2}
        : it
    ));
  }

  function onTemplateChange(name) {
    setTemplate(name);
    if (!name || name === "— none —") { setActiveSnapZone(null); return; }
    const tmpl = templates[name];
    if (tmpl?.zone && sel) snapTo(tmpl.zone);
    else if (tmpl?.zone) setActiveSnapZone(tmpl.zone);
  }

  function nudgeScale(d) {
    if (scaleLocked||!sel) return;
    undoRef.current = { id:sel.id, canvasX:sel.canvasX, canvasY:sel.canvasY, scale:sel.scale };
    setItems(prev => prev.map(it =>
      it.id===selId ? {...it, scale:Math.max(0.02,Math.min(4.0,it.scale+d))} : it
    ));
  }

  const snapBtns = [
    { lbl:"G", zone:"green",   col:C.green   },
    { lbl:"B", zone:"blue",    col:C.blue    },
    { lbl:"M", zone:"magenta", col:C.magenta },
    { lbl:"R", zone:"red",     col:C.red     },
  ];

  const zoomPresets = [
    { label:"75%",  value:0.75 },
    { label:"100%", value:1.0  },
    { label:"125%", value:1.25 },
    { label:"150%", value:1.5  },
  ];
  const displayZoom = zoom * DISPLAY_ZOOM_MULTIPLIER;
  const canvasDisplayPixels = Math.round(DS * displayZoom);
  const canvasDisplaySize = zoom === 1.0
    ? `min(${canvasDisplayPixels}px, calc(100vh - 156px), calc(100% - 12px))`
    : `${canvasDisplayPixels}px`;
  const queueChip = isSingleImageMode
    ? "single"
    : queue.length ? `${Math.min(queueIdx + 1, queue.length)} / ${queue.length}` : "— / —";
  const currentFileLabel = isSingleImageMode
    ? singleImageName || "Single image"
    : queue[queueIdx] ? imageQueueLabel(queue[queueIdx], srcFolder) : (srcLabel || "No image loaded");
  const singlePreviewSrc = isSingleImageMode ? items[0]?.htmlImg?.src || "" : "";
  const saveButtonLabel = saved
    ? isSingleImageMode ? "Downloaded!" : "Saved!"
    : isSingleImageMode ? "Download" : "Save & Next";

  return (
    <>
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="editor-root"
      >
      <style>{`
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:var(--scrollbar);border-radius:2px}
        .ed-btn:active{transform:scale(0.98)}
        select,input{outline:none} input[type=range]{accent-color:var(--green)}
        input[type=checkbox]{accent-color:var(--accent)}
        [data-theme="dark"] select option{background:hsl(222,20%,16%);color:hsl(210,40%,95%)}
        [data-theme="light"] select option{background:hsl(220,14%,94%);color:hsl(224,20%,15%)}
      `}</style>
      <input
        ref={singleFileInputRef}
        className="editor-single-file-input"
        type="file"
        accept={SINGLE_IMAGE_ACCEPT}
        onChange={onSingleImageInputChange}
      />

      <header className="editor-topbar">
        <h1 className="editor-title">Editor · Place &amp; Save</h1>
        <div className="editor-topbar-actions">
          {!isSingleImageMode && (
            <button type="button" className="ed-btn editor-action-secondary" onClick={doSkip}>
              <span>Skip</span>
              <kbd>S</kbd>
            </button>
          )}
          <span className="editor-queue-chip">{queueChip}</span>
          <button type="button" className={saved ? "ed-btn editor-action-primary editor-action-saved" : "ed-btn editor-action-primary"} onClick={doSave}>
            <span>{saveButtonLabel}</span>
            <kbd>↵</kbd>
          </button>
        </div>
      </header>

      <div className="editor-workspace">
      {/* ── Canvas area ──────────────────────────────────────────── */}
      <div className="editor-canvas-column">
        <div className="editor-canvas-viewport">
          {items.length ? (
            <div className="editor-canvas-frame" style={{ width: canvasDisplaySize, height: canvasDisplaySize }}>
              <div className="editor-artboard" style={{ background: canvasBgColor }}>
                <canvas
                  ref={canvasRef} width={DS} height={DS}
                  onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
                  style={{ cursor:"crosshair", display:"block" }}
                />
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={singleDropActive ? "ed-btn editor-empty-dropzone is-dragging" : "ed-btn editor-empty-dropzone"}
              onClick={browseSingleImage}
              onDragOver={onSingleImageDragOver}
              onDragLeave={onSingleImageDragLeave}
              onDrop={onSingleImageDrop}
            >
              <span className="editor-empty-dropzone-icon">＋</span>
              <strong>Drop an image or folder here to edit</strong>
              <span>or browse a single PNG, JPG, WebP, TIFF, or AVIF.</span>
            </button>
          )}
        </div>

        <div className="editor-file-status" title={currentFileLabel}>
          <span>Current file</span>
          <strong>{currentFileLabel}</strong>
        </div>

        {/* ── Footer bar ── */}
        <div className="editor-footer">
          <div className="editor-footer-hints">
            {["Drag=Move","Scroll=Resize","Arrows=Nudge","Ctrl+Z=Undo"].map(h => (
              <span key={h}>{h}</span>
            ))}
          </div>

          <div className="editor-zoom-controls">
            {zoomPresets.map(({ label, value }) => (
              <button key={label} className="ed-btn" onClick={() => setZoom(value)} style={{
                padding:"2px 6px", fontSize:9, cursor:"pointer", fontFamily:"inherit", borderRadius:3,
                border:`1px solid ${zoom===value ? "var(--accent)" : "transparent"}`,
                background: zoom===value ? "color-mix(in srgb,var(--accent) 12%,transparent)" : "transparent",
                color: zoom===value ? "var(--accent)" : C.dim,
                fontWeight: zoom===value ? 700 : 400,
              }}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Sidebar ───────────────────────────────────────────────── */}
      <aside className="editor-sidebar">
        {/* Scrollable content */}
        <div key={sidebarResetKey} className="editor-sidebar-scroll">

          <CollSection label="Single Image" accent="var(--green)" defaultOpen={false}>
            <div
              className={singleDropActive ? "editor-single-source is-dragging" : "editor-single-source"}
              onDragOver={onSingleImageDragOver}
              onDragLeave={onSingleImageDragLeave}
              onDrop={onSingleImageDrop}
            >
              <button
                type="button"
                className="ed-btn editor-single-drop-field"
                onClick={browseSingleImage}
                aria-label={isSingleImageMode ? "Replace single image" : "Select single image"}
              >
                {singlePreviewSrc ? (
                  <img src={singlePreviewSrc} alt="" />
                ) : (
                  <>
                    <span className="editor-single-drop-icon">＋</span>
                    <span className="editor-single-drop-title">Drop or select</span>
                    <span className="editor-single-drop-hint">PNG · JPG · WebP · TIFF · AVIF</span>
                  </>
                )}
              </button>
              <div className="editor-single-file-row">
                <span className="editor-single-file-name" title={isSingleImageMode ? singleImageName : ""}>
                  {isSingleImageMode ? singleImageName || "Single image selected" : "No direct image selected"}
                </span>
              </div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:4, marginBottom:4 }}>
              <Btn className="ed-btn" onClick={async () => {
                try {
                  const { path } = await browseFolder(srcFolder);
                  if (!path) return;
                  setSessionOutputDir("");
                  await initFromFolder(path, 0);
                } catch {
                  setStatus("folder picker unavailable\ncheck that api.py is running");
                }
              }} style={{ fontSize:10, color:C.dim, textAlign:"center", marginBottom:0 }}>
                📂 Change Source Folder
              </Btn>
              <button className="ed-btn" onClick={() => initFromFolder(srcFolder, 0)} disabled={!srcFolder || isSingleImageMode} style={{
                border:`1px solid ${C.border}`, background:C.panel2, color:C.dim, borderRadius:5,
                padding:"0 8px", fontSize:10, cursor:"pointer", fontFamily:"inherit"
              }}>↺ Reload</button>
            </div>
            <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:10, color:C.dim, cursor:"pointer", marginBottom:2 }}>
              <input type="checkbox" checked={comboMode} onChange={e=>setComboMode(e.target.checked)} />
              Combo mode
            </label>
          </CollSection>

          {/* ── Template ── */}
          <CollSection label="Template" accent="var(--magenta)" defaultOpen>
          <select value={template} onChange={e => onTemplateChange(e.target.value)} style={{
            background:C.panel2, color:C.text, border:`1px solid ${C.border}`, borderRadius:5,
            padding:"5px 7px", fontSize:11, width:"100%", marginBottom:3,
            fontFamily:"inherit", colorScheme:"dark light",
          }}>
            <option value="— none —" style={{ background:"var(--panel2)", color:"var(--text)" }}>— none —</option>
            {Object.keys(templates).filter(k => k !== "— none —").map(k => (
              <option key={k} value={k} style={{ background:"var(--panel2)", color:"var(--text)" }}>{k}</option>
            ))}
          </select>
          {templates[template]?.hint && (
            <div style={{ fontSize:10, color:C.dim, marginBottom:3, paddingLeft:2, lineHeight:1.4 }}>
              {templates[template].hint}
            </div>
          )}
          {templates[template]?.ref_image && (
            <RefImage
              key={template}
              src={templateRefSrc}
            />
          )}
          {!!templates[template]?.ref_image && (
            <div style={{ marginBottom:5, padding:"4px 6px", border:`1px solid ${C.border}`, borderRadius:5, background:C.panel2 }}>
              <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:10, color:C.dim, cursor:"pointer", marginBottom:4 }}>
                <input type="checkbox" checked={showRefOnCanvas} onChange={e => setShowRefOnCanvas(e.target.checked)} />
                Show ref on canvas
              </label>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:2 }}>
                <span style={{ fontSize:9, color:C.dim }}>Ref opacity</span>
                <span style={{ fontSize:9, color:C.dim, fontFamily:"JetBrains Mono" }}>{Math.round(refOpacity * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.15}
                max={0.35}
                step={0.01}
                value={refOpacity}
                onChange={e => setRefOpacity(parseFloat(e.target.value))}
                disabled={!showRefOnCanvas}
                style={{ width:"100%" }}
              />
            </div>
          )}
          </CollSection>

          {/* ── Snap & Align ── */}
          <CollSection label="Snap & Align" accent="hsl(191 85% 52%)" defaultOpen>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:3, marginBottom:5 }}>
              {snapBtns.map(({ lbl, zone, col }) => (
                <button key={zone} className="ed-btn" onClick={() => { snapTo(zone); }} style={{
                  background: activeSnapZone===zone ? `color-mix(in srgb, ${col} 25%, transparent)` : `color-mix(in srgb, ${col} 10%, transparent)`,
                  color:col, border:`1px solid color-mix(in srgb, ${col} ${activeSnapZone===zone ? 60 : 30}%, transparent)`,
                  borderRadius:5, padding:"6px 0", fontSize:12, fontWeight:800,
                  cursor:"pointer", fontFamily:"inherit", textAlign:"center",
                  boxShadow: activeSnapZone===zone ? `0 0 8px color-mix(in srgb, ${col} 30%, transparent)` : "none",
                  transition:"all 0.15s",
                }}>{lbl}</button>
              ))}
            </div>
            <div style={{ display:"flex", gap:3, marginBottom:6 }}>
              <button className="ed-btn" onClick={snapToFull} style={{
                flex:2, background:C.panel2, color:C.dim, border:`1px solid ${C.border}`,
                borderRadius:5, padding:"5px 0", fontSize:10, cursor:"pointer", fontFamily:"inherit",
                display:"flex", alignItems:"center", justifyContent:"center", gap:4,
              }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
                  <path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
                </svg>
                Fit
              </button>
              <button className="ed-btn" onClick={()=>doAlign("h")} style={{
                flex:1, background:C.panel2, color:C.dim, border:`1px solid ${C.border}`,
                borderRadius:5, padding:"5px 0", fontSize:10, cursor:"pointer", fontFamily:"inherit",
                display:"flex", alignItems:"center", justifyContent:"center", gap:3,
              }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 12h20"/><path d="M10 16v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4"/>
                  <path d="M10 8V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v4"/>
                  <path d="M20 16v1a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-1"/><path d="M14 8V7c0-1.1.9-2 2-2h2a2 2 0 0 1 2 2v1"/>
                </svg>
                H
              </button>
              <button className="ed-btn" onClick={()=>doAlign("v")} style={{
                flex:1, background:C.panel2, color:C.dim, border:`1px solid ${C.border}`,
                borderRadius:5, padding:"5px 0", fontSize:10, cursor:"pointer", fontFamily:"inherit",
                display:"flex", alignItems:"center", justifyContent:"center", gap:3,
              }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v20"/><path d="M8 10H4a2 2 0 0 1-2-2V6c0-1.1.9-2 2-2h4"/>
                  <path d="M16 10h4a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-4"/>
                  <path d="M8 20H7a2 2 0 0 1-2-2v-2c0-1.1.9-2 2-2h1"/><path d="M16 14h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1"/>
                </svg>
                V
              </button>
            </div>
          </CollSection>

          {/* ── Scale ── */}
          <CollSection label="Scale" accent="var(--accent)" defaultOpen>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:4 }}>
              <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:10, color:C.dim, cursor:"pointer" }}>
                <input type="checkbox" checked={scaleLocked} onChange={e=>setScaleLocked(e.target.checked)} style={{ accentColor:"var(--red)" }} />
                Lock
              </label>
              {sel && (
                <span style={{
                  fontSize:10, fontFamily:"JetBrains Mono", color:C.text,
                  background:C.panel2, border:`1px solid ${C.border}`, borderRadius:4, padding:"1px 6px",
                }}>{sel.scale.toFixed(3)}</span>
              )}
            </div>
            <input type="range" min={0.05} max={3.0} step={0.005}
              value={sel?.scale ?? 1.0}
              onChange={e => { if (scaleLocked||!selId) return; setItems(prev => prev.map(it => it.id===selId ? {...it,scale:parseFloat(e.target.value)} : it)); }}
              disabled={scaleLocked||!sel}
              style={{ width:"100%", marginBottom:4 }}
            />
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:3, marginBottom:2 }}>
              {[["−5%",-0.05],["−1%",-0.01],["+1%",0.01],["+5%",0.05]].map(([l,d]) => (
                <button key={l} className="ed-btn" onClick={()=>nudgeScale(d)} style={{
                  background:C.panel2, color:C.dim, border:`1px solid ${C.border}`,
                  borderRadius:4, padding:"4px 0", fontSize:10, cursor:"pointer", fontFamily:"inherit", textAlign:"center",
                }}>{l}</button>
              ))}
            </div>
          </CollSection>

          {/* ── Canvas Settings ── */}
          <CollSection label="Canvas" accent="hsl(32 90% 54%)" defaultOpen={false}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <span style={{ fontSize:10, color:C.dim }}>Background</span>
              <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                <input type="color" value={canvasBgColor} onChange={e=>setCanvasBgColor(e.target.value)}
                  style={{ width:24, height:24, border:`1px solid ${C.border}`, borderRadius:4, cursor:"pointer", padding:1 }} />
                <input type="text" value={canvasBgColor}
                  onChange={e => { const v=e.target.value; if(/^#[0-9a-fA-F]{0,6}$/.test(v)) setCanvasBgColor(v); }}
                  maxLength={7}
                  style={{ width:64, background:C.panel2, color:C.text, border:`1px solid ${C.border}`, borderRadius:4, padding:"3px 5px", fontSize:10, fontFamily:"JetBrains Mono", textAlign:"center" }}
                />
              </div>
            </div>
          </CollSection>

          {/* ── Canvas Items ── */}
          {items.length > 0 && (
             <CollSection label="Items" accent="hsl(246 82% 66%)" defaultOpen={false}>
              <div style={{ display:"flex", flexDirection:"column", gap:2, marginBottom:2 }}>
                {items.map(item => (
                  <button key={item.id} className="ed-btn" onClick={() => setSelId(item.id)} style={{
                    background: item.id===selId ? "color-mix(in srgb,var(--accent) 12%,var(--panel2))" : C.panel2,
                    color: item.id===selId ? C.text : C.dim,
                    border:`1px solid ${item.id===selId ? "var(--accent)" : C.border}`,
                    borderLeft: `3px solid ${item.id===selId ? "var(--accent)" : "transparent"}`,
                    borderRadius:5, padding:"4px 8px", fontSize:10,
                    cursor:"pointer", textAlign:"left", fontFamily:"JetBrains Mono",
                    minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                  }}>
                    {item.label}
                  </button>
                ))}
              </div>
              <button type="button" className="ed-btn editor-remove-item" onClick={removeSelected}>
                Remove item <kbd>Del</kbd>
              </button>
            </CollSection>
          )}

          {/* ── Output ── */}
          <CollSection label="Output" accent="var(--green)" defaultOpen={false}>
          <label className="editor-output-toggle">
            <span className="editor-output-toggle-copy">
              <strong>Generate thumbnail</strong>
              <span>Save a {thumbnailSize}px preview copy in a thumbnail folder next to the final image.</span>
            </span>
            <input
              type="checkbox"
              checked={generateThumbnail}
              onChange={event => toggleGenerateThumbnail(event.target.checked)}
            />
          </label>
          {isSingleImageMode ? (
            <div className="editor-single-output-note">
              Single image export downloads {generateThumbnail ? "the final PNG and thumbnail PNG" : "the final PNG only"} without writing to a batch output folder.
            </div>
          ) : (
            <>
              {/* BUG-03 FIX: was openFolder() with no arg — opened OUTPUT_ROOT on server.
                  Now passes srcFolder so Explorer opens the actual session source folder. */}
              <Btn className="ed-btn" onClick={() => openFolder(activeOutputDir || srcFolder)} style={{ color:"var(--green)", borderColor:"var(--green-bdr)", textAlign:"center", fontSize:10 }}>
                📁 Open Output Folder
              </Btn>
            </>
          )}
          </CollSection>

          <CollSection label="History" accent="var(--accent)" defaultOpen={false}>
            <div className="editor-history-list">
              {statusHistory.length ? statusHistory.map((entry, index) => (
                <div key={entry.id} className={index === 0 ? "editor-history-entry is-current" : "editor-history-entry"}>
                  <div className="editor-history-meta">{index === 0 ? "Current" : entry.time}</div>
                  <div className="editor-history-message">{entry.message}</div>
                </div>
              )) : (
                <div className="editor-history-empty">No editor activity yet.</div>
              )}
            </div>
          </CollSection>
        </div>
      </aside>
      </div>
      </div>
      <ConfirmModal
        open={Boolean(confirmState)}
        title={confirmState?.title}
        message={confirmState?.message}
        confirmLabel={confirmState?.confirmLabel}
        cancelLabel={confirmState?.cancelLabel}
        onConfirm={() => closeConfirm(true)}
        onCancel={() => closeConfirm(false)}
      />
    </>
  );
}
