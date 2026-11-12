/*
KNOWN LIMITATIONS (web build):
- Some settings changes do not hot-apply to an already-open editor session; reopening the Editor tab re-initializes state.
- If pipeline completion happens while already on Editor, use the new reload controls to refresh queue/source.
- /api/browse uses tkinter; desktop Electron should replace this with native dialog APIs.
*/
import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from "react";
import {
  AlignHorizontalJustifyCenter, AlignVerticalJustifyCenter, Check, FolderOpen, History, ImageOff,
  ImagePlus, Keyboard, Maximize, PanelRightClose, PanelRightOpen, RotateCcw, Scan, Trash2, TriangleAlert,
} from "lucide-react";
import ConfirmModal from "./ConfirmModal.jsx";
import TemplatePicker from "./components/TemplatePicker.jsx";
import {
  Button, Checkbox, IconButton, Popover, ResizablePanel, SegmentedControl, Section, Slider,
  StatusBar, Switch, TextField,
} from "./components/ui/index.jsx";
import { useUiPref } from "./hooks/useUiPref.js";
import { zoneColor } from "./utils/zones.js";
import { compactForMatch, naturalParts, templateKeywords } from "./utils/text.js";
import {
  getConfig, getSource, getImages,
  imageUrl, saveComposition, skipImage, unskipImage,
  getSession, saveSession, clearSession,
  browseFolder, openFolder,
  getSettings, patchSettings, templateRefUrl,
} from "./api.js";
import { pathForFile, canSaveWithDialog, saveFileWithDialog } from "./runtime.js";
import { toForwardSlashes, relativePathFromRoot } from "./paths.js";
import { useDefaultOutputLabel } from "./defaultOutput.js";
import { SHORTCUTS } from "./editorShortcuts.js";
import PageHeader from "./components/PageHeader.jsx";

// ── Constants ─────────────────────────────────────────────────────────────────
// CANVAS_SIZE: logical composition size (matches pipeline output, e.g. 1440)
// DS: logical preview size. Drawing and hit-testing always use DS units; the pixel
//     buffer is DS * canvasPixelScale so the canvas stays sharp at the size it is shown.
// zoom: multiplier on the "Fit" size (1 = fills the viewport)
let CANVAS_SIZE = 1440;  // mutable module var — kept for non-React drawing functions
const DS = 720;
// View sizing: zoom 1 ("Fit") fills the canvas viewport minus VIEWPORT_PAD on each side.
const VIEWPORT_PAD = 24;
const FIT_MIN_PX = 240;
const FIT_FALLBACK_PX = 533; // until the viewport has been measured
const MAX_PIXEL_SCALE = 3;   // preview buffer is at most 3x DS (2160px)
const scaleFactor = () => DS / CANVAS_SIZE;
// View zoom range. It only changes the preview, never the saved image.
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4.0;
const ZOOM_WHEEL_STEP = 1.1;
// A product drawn larger than its source pixels (beyond this factor) is
// upsampled in the saved image and will look soft.
const ENLARGE_WARN_THRESHOLD = 1.01;
// Ctrl+wheel rotates the selected product (degrees per notch; Shift = fine).
const ROTATE_WHEEL_STEP = 1;
const ROTATE_WHEEL_FINE_STEP = 0.1;
// Wheel notches closer together than this count as one rotate gesture (one undo step).
const ROTATE_GESTURE_GAP_MS = 600;
const clampZoom = (z) => {
  const rounded = Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)) * 100) / 100;
  return Math.abs(rounded - 1) < 0.04 ? 1.0 : rounded;
};

function isTextEntryTarget(target) {
  const tagName = target?.tagName?.toLowerCase?.() || "";
  return tagName === "input" || tagName === "select" || tagName === "textarea" || Boolean(target?.isContentEditable);
}

// Input types where Enter does nothing by itself, so Enter should still save the image.
const NON_TEXT_INPUT_TYPES = new Set(["checkbox", "radio", "range", "color", "button", "file"]);

// True when Enter belongs to the focused control (typing, picking from a list).
// A focused colour picker, checkbox or slider does not use Enter, so it must not block Save.
function enterBelongsToTarget(target) {
  const tagName = target?.tagName?.toLowerCase?.() || "";
  if (tagName === "input") return !NON_TEXT_INPUT_TYPES.has(String(target.type || "").toLowerCase());
  return tagName === "select" || tagName === "textarea" || Boolean(target?.isContentEditable);
}

// After a mouse click on a tool button, focus goes back to the editor so Enter saves
// and the arrow keys nudge. Keyboard activation (detail 0) and popup openers keep focus.
const CLICK_REFOCUS_SELECTOR = "button, [role='switch'], [role='radio'], input[type='checkbox'], input[type='radio']";
function shouldRefocusAfterClick(e) {
  if (!e.detail) return false;
  const control = e.target?.closest?.(CLICK_REFOCUS_SELECTOR);
  if (!control || control.disabled) return false;
  if (control.closest("[aria-haspopup], [role='dialog'], [role='listbox']")) return false;
  return true;
}

const SINGLE_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/tiff,image/avif,.png,.jpg,.jpeg,.webp,.tif,.tiff,.avif";
const SUPPORTED_SINGLE_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/tiff", "image/avif"]);
const SUPPORTED_SINGLE_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "tif", "tiff", "avif"]);
const DEFAULT_THUMBNAIL_SIZE = 400;

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

// Placement only (no decoded image), so the per-image history of a long batch stays light.
// Guides from the server config, with the user's custom overrides from Settings applied.
function resolveGuides(baseGuides, settings) {
  const next = { ...baseGuides };
  if (settings?.guides?.use_custom && settings?.guides?.custom) {
    for (const [zone, vals] of Object.entries(settings.guides.custom)) {
      if (!next[zone]) continue;
      next[zone] = { ...next[zone], ...vals };
    }
  }
  return next;
}

function placementSnapshot({ label, filePath, canvasX, canvasY, scale, rotation = 0, origW, origH }) {
  return { label, filePath, canvasX, canvasY, scale, rotation, origW, origH };
}

// Degrees, clockwise, kept in (-180, 180] at 0.1° precision.
function normalizeRotation(deg) {
  const r = Math.round(((((Number(deg) || 0) % 360) + 540) % 360 - 180) * 10) / 10;
  if (r === -180) return 180;
  return r === 0 ? 0 : r; // no -0
}

function undoSnapshot(it) {
  return { id: it.id, canvasX: it.canvasX, canvasY: it.canvasY, scale: it.scale, rotation: it.rotation || 0 };
}

// Size of the item's axis-aligned box at scale 1 once rotated (canvas units).
function rotatedExtent(item) {
  const rad = ((item.rotation || 0) * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  return { w: item.origW * c + item.origH * s, h: item.origW * s + item.origH * c };
}

// Starting scale for a new image: 1.000 (one source pixel per canvas pixel), shrunk
// only when the image is taller than the template zone or wider than the canvas.
function initialScaleFor(guide, width, height) {
  if (!(width > 0) || !(height > 0)) return 1;
  const zoneHeight = guide ? guide.bottom - guide.top : CANVAS_SIZE;
  return Math.min(1, zoneHeight / height, CANVAS_SIZE / width);
}

// Template whose keywords appear in the file name; the longest keyword wins.
// "26 cm", "26cm" and "26_CM" all match each other, but "26cm" never matches "126cm".
function matchTemplateForName(fileName, templates) {
  const baseName = String(fileName || "").split(/[\\/]/).pop().replace(/\.[^.]+$/, "");
  const target = compactForMatch(baseName);
  if (!target.compact) return null;
  let best = null;
  for (const [name, tpl] of Object.entries(templates || {})) {
    if (name === "— none —") continue;
    for (const keyword of templateKeywords(tpl)) {
      const needle = compactForMatch(keyword).compact;
      if (!needle || (best && needle.length <= best.length)) continue;
      const startsWithDigit = /\d/.test(needle[0]);
      const endsWithDigit = /\d/.test(needle[needle.length - 1]);
      for (let at = target.compact.indexOf(needle); at !== -1; at = target.compact.indexOf(needle, at + 1)) {
        const before = target.text[target.index[at] - 1] || "";
        const after = target.text[target.index[at + needle.length - 1] + 1] || "";
        if (startsWithDigit && /\d/.test(before)) continue;
        if (endsWithDigit && /\d/.test(after)) continue;
        best = { name, keyword, length: needle.length };
        break;
      }
    }
  }
  return best ? { name: best.name, keyword: best.keyword } : null;
}

// Hit test in DS (preview pixel) space, honouring the item's rotation.
function pointInItem(item, mx, my) {
  const { x, y, w, h } = itemBounds(item);
  const dx = mx - (x + w / 2);
  const dy = my - (y + h / 2);
  const rad = ((item.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  return Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2;
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

// Renders a template reference image with a proper error fallback
// — key={template} on the call site ensures full remount when template changes
function RefImage({ src }) {
  const [err, setErr] = useState(false);

  if (!src) return null;
  return (
    <figure className="editor-ref">
      {err ? (
        <div className="editor-ref-missing">
          <ImageOff size={18} aria-hidden="true" />
          <span>Reference image not found</span>
        </div>
      ) : (
        <img src={src} alt="Reference" onError={() => setErr(true)} />
      )}
      <figcaption>Reference</figcaption>
    </figure>
  );
}

export default function Editor({ outputDir = "", canvasSize: canvasSizeProp = null, thumbnail: thumbnailProp = true }) {
  const defaultOutputLabel = useDefaultOutputLabel();
  const defaultOutputLabelRef = useRef(defaultOutputLabel);
  defaultOutputLabelRef.current = defaultOutputLabel;
  const canvasRef    = useRef(null);
  const containerRef = useRef(null);
  const viewportRef  = useRef(null);
  const zoomAnchorRef = useRef(null);   // { fx, fy, clientX, clientY } kept under the cursor across a zoom
  const panRef       = useRef(null);    // { x, y, scrollLeft, scrollTop } while panning the viewport
  const spaceHeldRef = useRef(false);
  const [panMode, setPanMode] = useState(null); // null | "ready" (Space held) | "panning"
  const dragRef      = useRef(null);
  const undoRef      = useRef(null);
  const prefetchRef  = useRef(null); // holds pre-loaded next htmlImg + metadata
  const nextItemIdRef = useRef(1);
  const refImageCacheRef = useRef(new Map());
  const confirmResolverRef = useRef(null);
  const configRef = useRef({ guides: {}, templates: {} });
  const sourceLoadSeqRef = useRef(0);
  // queue index → { action: "saved" | "skipped", comboMode, items } for Previous / re-save.
  const historyRef = useRef(new Map());
  const resumePromptActiveRef = useRef(false);
  const sessionRunIdRef = useRef("");
  const srcFolderRef = useRef("");
  const imageFileInputRef = useRef(null);
  const singleObjectUrlRef = useRef("");
  // Shared busy flag for Save and Skip so neither can start while the other runs.
  const saveInFlightRef = useRef(false);
  const savedResetTimerRef = useRef(null);
  const dragFrameRef = useRef(null);
  const dragPointRef = useRef(null);
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
  const [dropActive, setDropActive] = useState(false);
  const [activeSnapZone, setActiveSnapZone] = useState(null); // tracks last snapped guide zone
  const [showRefOnCanvas, setShowRefOnCanvas] = useState(true);
  const [refOpacity, setRefOpacity] = useState(0.22);
  const [refCanvasImage, setRefCanvasImage] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  // Queue of the batch that just finished, so Previous still works after the last image.
  const [finishedQueue, setFinishedQueue] = useState([]);
  // Template auto-match by file name (Settings → Auto-match template).
  const [autoTemplateMatch, setAutoTemplateMatch] = useState(true);
  const [templateMatchInfo, setTemplateMatchInfo] = useState(null); // { name, keyword } | null
  const itemsRef = useRef([]);
  const rotateGestureRef = useRef({ id: null, at: 0 });

  // Phase 4: canvas view zoom (CSS scale, does not affect composition output)
  const [zoom, setZoom] = useState(1.0);
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 });
  const [toolsCollapsed, setToolsCollapsed] = useUiPref("editor.toolsCollapsed", false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const activityButtonRef = useRef(null);
  const shortcutsRef = useRef(null);

  // Zoom 1 ("Fit") fills the viewport and follows window resizing; other zooms scale that.
  const fitPx = viewportSize.w > 0 && viewportSize.h > 0
    ? Math.max(FIT_MIN_PX, Math.floor(Math.min(viewportSize.w, viewportSize.h) - VIEWPORT_PAD * 2))
    : FIT_FALLBACK_PX;
  const canvasCssPx = Math.round(fitPx * zoom);
  const devicePixelRatio = window.devicePixelRatio || 1;
  const canvasPixelScale = Math.min(MAX_PIXEL_SCALE, Math.max(1, Math.ceil((canvasCssPx * devicePixelRatio / DS) * 2) / 2));

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      // offsetWidth/Height include padding and scrollbars, so the fit size does not
      // jump when zooming in makes the viewport scroll. Hidden screens report 0: ignore.
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w > 0 && h > 0) setViewportSize(prev => (prev.w === w && prev.h === h ? prev : { w, h }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const sel = items.find(it => it.id === selId) ?? null;
  itemsRef.current = items;
  const templateRefSrc = useMemo(
    () => templateRefUrl(templates[template]?.ref_image),
    [template, templates],
  );

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

  // The "Saved!/Downloaded!" flash resets after a delay; in single image mode that
  // reset also clears the canvas, so a new load must cancel any pending reset.
  const clearSavedResetTimer = useCallback(() => {
    if (savedResetTimerRef.current === null) return;
    window.clearTimeout(savedResetTimerRef.current);
    savedResetTimerRef.current = null;
  }, []);

  const scheduleSavedReset = useCallback((afterReset) => {
    clearSavedResetTimer();
    savedResetTimerRef.current = window.setTimeout(() => {
      savedResetTimerRef.current = null;
      setSaved(false);
      afterReset?.();
    }, 1600);
  }, [clearSavedResetTimer]);

  const resetQueueHistory = useCallback(() => {
    historyRef.current = new Map();
    setFinishedQueue([]);
  }, []);

  useEffect(() => () => {
    clearSavedResetTimer();
    if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
  }, [clearSavedResetTimer]);

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
  const allDone = useCallback(async (finished = []) => {
    resetEditorToDefaultState();
    setFinishedQueue(finished);
    setStatus(`all images processed.\noutput → ${activeOutputDir}/Editor/${finished.length ? "\nPress P to go back to the last image." : ""}`);
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
    if (idx >= q.length) { allDone(q); return; }

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
    const matched    = autoTemplateMatch ? matchTemplateForName(path, templates) : null;
    const tplName    = matched?.name ?? template;
    if (matched && matched.name !== template) setTemplate(matched.name);
    setTemplateMatchInfo(matched);
    const activeZone = templates[tplName]?.zone || "green";
    const guideSrc   = guidesOverride ?? guides;
    const g          = guideSrc[activeZone] ?? guideSrc["green"] ?? { top:224, bottom:1216, left:224, right:1216 };
    const initScale  = initialScaleFor(g, width, height);

    const newItem = {
      id:       nextItemIdRef.current++,
      label:    imageQueueLabel(path, srcFolderRef.current),
      filePath: path,
      canvasX:  CANVAS_SIZE / 2,
      canvasY:  Math.round((g.top + g.bottom) / 2),
      scale:    initScale,
      rotation: 0,
      origW:    width,
      origH:    height,
      htmlImg,
      loadFailed: !(htmlImg?.naturalWidth > 0),
    };

    if (isCombo) {
      setItems(prev => [...prev, newItem]);
    } else {
      setItems([newItem]);
    }
    setSelId(newItem.id);
  }, [template, templates, guides, comboMode, allDone, autoTemplateMatch]); // eslint-disable-line react-hooks/exhaustive-deps
  // comboMode is unused in loadImage body but kept for correctness (isCombo arg is passed in)

  // Keep the ref in sync so initFromFolder/advance always call the latest version
  // without needing loadImage in their own dep arrays (breaks circular dep chain).
  loadImageRef.current = loadImage;

  // initFromFolder: stable (uses loadImageRef to avoid circular dep on loadImage).
  // Guarded by sourceLoadSeqRef so a slower call (e.g. a stale "Change Source
  // Folder" request) can't clobber state set by a faster, later one (e.g. a
  // "Reload" click fired right after it) — see doc/plan item 9.
  const initFromFolder = useCallback(async (folder, startIdx, guidesOverride) => {
    const runSeq = ++sourceLoadSeqRef.current;
    const result = await getImages(folder);
    if (runSeq !== sourceLoadSeqRef.current) return;
    const nextQueue = sortImageQueue(result.images, folder);
    clearSavedResetTimer();
    resetQueueHistory();
    setSaved(false);
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
    if (runSeq !== sourceLoadSeqRef.current) return;
    setStatus("");
  }, [clearSavedResetTimer, resetQueueHistory, revokeSingleImageUrl]); // getImages is a stable import; all setters are stable; uses ref for loadImage

  const initFromDroppedPaths = useCallback(async (paths, label = "Dropped folder") => {
    const uniquePaths = [...new Set(paths.filter(Boolean))];
    if (!uniquePaths.length) return;
    const root = commonDirectory(uniquePaths);
    const nextQueue = sortImageQueue(uniquePaths, root);
    clearSavedResetTimer();
    resetQueueHistory();
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
    setStatus(`Loaded ${nextQueue.length} dropped image${nextQueue.length === 1 ? "" : "s"} into the queue.`);
  }, [clearSavedResetTimer, resetQueueHistory, revokeSingleImageUrl]);

  // ── Init effect ───────────────────────────────────────────────────────────
  const clearToEmptySource = useCallback((message, label = "no output") => {
    revokeSingleImageUrl();
    resetQueueHistory();
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
  }, [resetQueueHistory, revokeSingleImageUrl]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await getConfig();

        let settings = {};
        try {
          settings = (await getSettings()) ?? {};
        } catch {
          void 0;
        }

        let resolvedSize = canvasSizeProp ?? cfg.canvas_size;
        const fromSettings = settings?.output?.canvas_size;
        if (!canvasSizeProp && fromSettings && fromSettings > 0) {
          resolvedSize = fromSettings;
        }

        const nextGuides = resolveGuides(cfg.guides, settings);

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
        if (typeof settings?.editor?.auto_template_match === "boolean") setAutoTemplateMatch(settings.editor.auto_template_match);
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

  // Settings and Templates are separate screens that stay mounted. Pick up what they
  // save without reopening the Editor. The canvas size is left alone on purpose: items
  // on the canvas are positioned in its units, so it still needs a reopen to change.
  useEffect(() => {
    if (!bootstrapReady) return undefined;
    let cancelled = false;
    const refresh = async () => {
      try {
        const [cfg, settings] = await Promise.all([getConfig(), getSettings().catch(() => ({}))]);
        if (cancelled) return;
        const nextGuides = resolveGuides(cfg.guides, settings ?? {});
        setGuides(nextGuides);
        setTemplates(cfg.templates);
        configRef.current = { guides: nextGuides, templates: cfg.templates };

        const opacity = settings?.appearance?.guide_opacity;
        if (typeof opacity === "number") setGuideOpacity(Math.max(0, Math.min(1, opacity)));
        const bg = settings?.appearance?.canvas_bg_color;
        if (typeof bg === "string" && bg) setCanvasBgColor(bg);
        if (typeof settings?.output?.thumbnail === "boolean") setGenerateThumbnail(settings.output.thumbnail);
        if (typeof settings?.editor?.auto_template_match === "boolean") setAutoTemplateMatch(settings.editor.auto_template_match);
        const savedThumbnailSize = Number(settings?.output?.thumbnail_size);
        if (Number.isFinite(savedThumbnailSize) && savedThumbnailSize > 0) {
          setThumbnailSize(Math.round(savedThumbnailSize));
        }
      } catch {
        // Keep what is on screen; the next save will try again.
      }
    };
    window.addEventListener("cutout-settings-saved", refresh);
    window.addEventListener("cutout-templates-saved", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("cutout-settings-saved", refresh);
      window.removeEventListener("cutout-templates-saved", refresh);
    };
  }, [bootstrapReady]);

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

      // An interrupted processing run is resumed from the Process screen, not
      // here: its queue_index counts processed images, not an editor position.
      // Leave it in place and load whatever that output already holds.
      const interruptedPipelineRun = session.kind === "pipeline" && !session.completed;
      if (session.exists && !interruptedPipelineRun) {
        const sessionOutputDir = (session.output_dir ?? "").trim();
        const outputMismatch = requestedOutputDir && normalizeOutputIdentity(sessionOutputDir) !== currentOutputIdentity;
        const currentOutputLabel = currentOutput || defaultOutputLabelRef.current;

        if (outputMismatch) {
          setStatus(`Ignored stale session output (${sessionOutputDir || defaultOutputLabelRef.current}); using current output (${currentOutputLabel}).`);
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
            `Resume from image ${session.queue_index + 1}/${session.total}?\nsource: ${session.src_root}\noutput: ${sessionOutputDir || defaultOutputLabelRef.current}`,
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
      const matched = autoTemplateMatch ? matchTemplateForName(file.name, templates) : null;
      const tplName = matched?.name ?? template;
      const activeZone = templates[tplName]?.zone || "green";
      const guideSrc = configRef.current.guides || guides;
      const guide = guideSrc[activeZone] ?? guideSrc.green ?? { top:224, bottom:1216, left:224, right:1216 };
      const initScale = initialScaleFor(guide, htmlImg.naturalWidth, htmlImg.naturalHeight);
      const previousUrl = singleObjectUrlRef.current;

      clearSavedResetTimer();
      resetQueueHistory();
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
        rotation: 0,
        origW: htmlImg.naturalWidth,
        origH: htmlImg.naturalHeight,
        htmlImg,
      };

      if (matched && matched.name !== template) setTemplate(matched.name);
      setTemplateMatchInfo(matched);
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
      setStatus(matched
        ? `Single image loaded · template "${matched.name}" matched from the file name. Save to export a PNG.`
        : "Single image loaded. Save to export a PNG.");
    } catch (error) {
      window.URL.revokeObjectURL(objectUrl);
      setStatus(`single image load failed: ${error.message}`);
    }
  }, [autoTemplateMatch, bootstrapReady, clearSavedResetTimer, guides, resetQueueHistory, template, templates]);

  // Any mix of dropped/browsed images and folders. One loose image opens in single
  // image mode (works in the browser too); anything more becomes the Editor queue,
  // which needs real file paths (desktop app).
  const loadDroppedFiles = useCallback(async (files, hasDirectory = false) => {
    if (!files.length) {
      setStatus(hasDirectory ? "Dropped folder does not contain supported images." : "Unsupported file. Use PNG, JPG, JPEG, WebP, TIFF, or AVIF.");
      return;
    }
    if (files.length === 1 && !hasDirectory) {
      await loadSingleImageFile(files[0]);
      return;
    }
    const paths = files.map(file => pathForFile(file)).filter(Boolean);
    if (!paths.length) {
      if (hasDirectory) {
        setStatus("Folder drop needs the desktop app so image paths can be loaded.");
        return;
      }
      await loadSingleImageFile(files[0]);
      setStatus("Several images need the desktop app to queue. Loaded the first image only.");
      return;
    }
    const label = hasDirectory && paths.length === files.length
      ? commonDirectory(paths) || "Dropped folder"
      : `${paths.length} dropped image${paths.length === 1 ? "" : "s"}`;
    await initFromDroppedPaths(paths, label);
    if (paths.length < files.length) {
      setStatus(`Queued ${paths.length} of ${files.length} images; ${files.length - paths.length} had no readable file path.`);
    }
  }, [initFromDroppedPaths, loadSingleImageFile]);

  const onImageInputChange = useCallback((event) => {
    const files = Array.from(event.target.files || []).filter(isSupportedSingleImageFile);
    event.target.value = "";
    loadDroppedFiles(files).catch((error) => {
      setStatus(`image load failed: ${error.message}`);
    });
  }, [loadDroppedFiles]);

  const onDropDragOver = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    setDropActive(true);
  }, []);

  const onDropDragLeave = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    // dragleave also fires when moving onto a child element; only clear when leaving the target.
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setDropActive(false);
  }, []);

  const onDrop = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    setDropActive(false);
    droppedImageFiles(event.dataTransfer)
      .then(({ files, hasDirectory }) => loadDroppedFiles(files, hasDirectory))
      .catch((error) => {
        setStatus(`drop failed: ${error.message}`);
      });
  }, [loadDroppedFiles]);

  const browseImages = useCallback(() => {
    imageFileInputRef.current?.click();
  }, []);

  // Puts back the placement an image was saved with (images are re-decoded from disk).
  // Returns false when there is nothing saved to restore.
  const restoreSavedPlacement = useCallback(async (entry) => {
    if (entry?.action !== "saved" || !entry.items?.length) return false;
    const restored = await Promise.all(entry.items.map(async (item) => {
      const htmlImg = new window.Image();
      await new Promise(resolve => { htmlImg.onload = resolve; htmlImg.onerror = resolve; htmlImg.src = imageUrl(item.filePath); });
      return { ...item, id: nextItemIdRef.current++, htmlImg };
    }));
    setComboMode(entry.comboMode);
    setItems(restored);
    setSelId(restored[restored.length - 1].id);
    return true;
  }, []);

  const historyStatus = useCallback((q, idx, prefix) => {
    const entry = historyRef.current.get(idx);
    const label = imageQueueLabel(q[idx], srcFolderRef.current);
    if (entry?.action === "saved") return `${prefix} ${label}: saved earlier. Save again to overwrite it.`;
    if (entry?.action === "skipped") return `${prefix} ${label}: skipped earlier. Saving it now removes the skipped copy.`;
    return `${prefix} ${label}.`;
  }, []);

  // ── BUG-17 FIX: advance was a plain function — converted to useCallback ──
  // Uses loadImageRef so loadImage doesn't need to be in deps (avoids stale closure).
  const advance = useCallback(async () => {
    const nextIdx = queueIdx + 1;
    setQueueIdx(nextIdx);
    setActiveSnapZone(null);
    undoRef.current = null;
    dragRef.current = null;
    if (!comboMode) { setItems([]); setSelId(null); }
    // Moving forward again after going back: show images already handled as they were saved.
    const entry = nextIdx < queue.length ? historyRef.current.get(nextIdx) : null;
    if (entry) {
      const message = historyStatus(queue, nextIdx, "next:");
      if (!await restoreSavedPlacement(entry)) await loadImageRef.current(queue, nextIdx, comboMode);
      setStatus(message);
      return;
    }
    return loadImageRef.current(queue, nextIdx, comboMode);
  }, [queueIdx, comboMode, queue, historyStatus, restoreSavedPlacement]);

  // ── Canvas draw ───────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || Object.keys(guides).length === 0) return;
    const ctx = canvas.getContext("2d");
    const S   = scaleFactor();
    // Draw in DS units whatever the pixel buffer size is.
    const bufferScale = canvas.width / DS;
    ctx.setTransform(bufferScale, 0, 0, bufferScale, 0, 0);
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
      const { x: bx, y: by, w, h } = itemBounds(item);
      ctx.save();
      ctx.translate(bx + w / 2, by + h / 2);
      ctx.rotate(((item.rotation || 0) * Math.PI) / 180);
      const x = -w / 2;
      const y = -h / 2;
      if (item.htmlImg?.complete && item.htmlImg.naturalWidth > 0) {
        ctx.drawImage(item.htmlImg, x, y, w, h);
      } else {
        ctx.fillStyle = "#3b82f644";
        ctx.fillRect(x, y, w, h);
        if (item.loadFailed) {
          ctx.save();
          ctx.fillStyle = "#ef4444";
          ctx.font = "bold 28px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("Could not load this image. Press S to skip it.", 0, 0);
          ctx.restore();
        }
      }
      ctx.restore();
    }

    // 3. Selection highlight (drawn in the item's rotated frame)
    if (sel) {
      const { x: bx, y: by, w, h } = itemBounds(sel);
      ctx.save();
      ctx.translate(bx + w / 2, by + h / 2);
      ctx.rotate(((sel.rotation || 0) * Math.PI) / 180);
      const x = -w / 2;
      const y = -h / 2;
      ctx.strokeStyle = "rgba(250,204,21,0.85)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(x-2, y-2, w+4, h+4);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(250,204,21,0.9)";
      [[x-2,y-2],[x+w+2,y-2],[x-2,y+h+2],[x+w+2,y+h+2]].forEach(([hx,hy]) => {
        ctx.fillRect(hx-3, hy-3, 6, 6);
      });
      ctx.restore();
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
  }, [items, selId, sel, guides, guideOpacity, canvasBgColor, activeSnapZone, showRefOnCanvas, refOpacity, refCanvasImage, canvasPixelScale]);

  // ── View zoom ─────────────────────────────────────────────────────────────
  // Zoom so the canvas point under (clientX, clientY) stays under it; without a
  // point, zoom around the middle of the viewport.
  const zoomTo = useCallback((nextZoomOrFn, clientX, clientY) => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (canvas && viewport) {
      const vr = viewport.getBoundingClientRect();
      const cx = clientX ?? vr.left + vr.width / 2;
      const cy = clientY ?? vr.top + vr.height / 2;
      const r = canvas.getBoundingClientRect();
      zoomAnchorRef.current = {
        fx: r.width  ? Math.max(0, Math.min(1, (cx - r.left) / r.width))  : 0.5,
        fy: r.height ? Math.max(0, Math.min(1, (cy - r.top)  / r.height)) : 0.5,
        clientX: cx, clientY: cy,
      };
    }
    setZoom(prev => clampZoom(typeof nextZoomOrFn === "function" ? nextZoomOrFn(prev) : nextZoomOrFn));
  }, []);

  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    zoomAnchorRef.current = null;
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!anchor || !canvas || !viewport) return;
    const r = canvas.getBoundingClientRect();
    viewport.scrollLeft += r.left + anchor.fx * r.width  - anchor.clientX;
    viewport.scrollTop  += r.top  + anchor.fy * r.height - anchor.clientY;
  }, [zoom]);

  // ── Wheel: Alt+wheel = view zoom, Ctrl+wheel = rotate, wheel on canvas = product scale ──
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const handler = (e) => {
      // Shift+wheel arrives as horizontal scroll on Windows, so read both axes.
      const delta = e.deltaY || e.deltaX;
      if (e.altKey) {
        e.preventDefault();
        if (!canvasRef.current || !delta) return;
        const f = delta < 0 ? ZOOM_WHEEL_STEP : 1 / ZOOM_WHEEL_STEP;
        zoomTo(z => z * f, e.clientX, e.clientY);
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault(); // also keeps the window from page-zooming
        if (!selId || !delta) return;
        const current = itemsRef.current.find(it => it.id === selId);
        if (!current) return;
        // One undo step per continuous rotate gesture.
        const now = Date.now();
        const gesture = rotateGestureRef.current;
        if (gesture.id !== selId || now - gesture.at > ROTATE_GESTURE_GAP_MS) {
          undoRef.current = undoSnapshot(current);
        }
        rotateGestureRef.current = { id: selId, at: now };
        const step = (e.shiftKey ? ROTATE_WHEEL_FINE_STEP : ROTATE_WHEEL_STEP) * (delta > 0 ? 1 : -1);
        setItems(prev => prev.map(it =>
          it.id===selId ? {...it, rotation: normalizeRotation((it.rotation || 0) + step)} : it
        ));
        return;
      }
      if (e.target !== canvasRef.current) return; // let the zoomed viewport scroll normally
      e.preventDefault();
      if (scaleLocked || !selId) return;
      const f = e.deltaY < 0 ? 1.04 : 0.96;
      setItems(prev => prev.map(it =>
        it.id===selId ? {...it, scale: Math.max(0.02, Math.min(Math.max(4.0, it.scale), it.scale*f))} : it
      ));
    };
    viewport.addEventListener("wheel", handler, { passive: false });
    return () => viewport.removeEventListener("wheel", handler);
  }, [scaleLocked, selId, zoomTo]);

  // ── Pan: hold Space and drag, or drag with the middle mouse button ────────
  useEffect(() => {
    const endPan = () => {
      if (!panRef.current) return;
      panRef.current = null;
      setPanMode(spaceHeldRef.current ? "ready" : null);
    };
    // The Editor stays mounted (display:none) on other screens; Space must keep
    // working normally there and while no image is loaded.
    const canPan = () => Boolean(canvasRef.current && canvasRef.current.offsetParent !== null);
    const onKeyDown = (e) => {
      if (e.code !== "Space" || isTextEntryTarget(e.target) || !canPan()) return;
      e.preventDefault(); // no page scroll, no "click" on a focused button
      if (e.repeat || spaceHeldRef.current) return;
      spaceHeldRef.current = true;
      if (!panRef.current) setPanMode("ready");
    };
    const onKeyUp = (e) => {
      if (e.code !== "Space" || !spaceHeldRef.current) return;
      if (!isTextEntryTarget(e.target)) e.preventDefault();
      spaceHeldRef.current = false;
      if (!panRef.current) setPanMode(null);
    };
    const onMove = (e) => {
      const pan = panRef.current;
      const viewport = viewportRef.current;
      if (!pan || !viewport) return;
      viewport.scrollLeft = pan.scrollLeft - (e.clientX - pan.x);
      viewport.scrollTop  = pan.scrollTop  - (e.clientY - pan.y);
    };
    const onBlur = () => {
      spaceHeldRef.current = false;
      panRef.current = null;
      setPanMode(null);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", endPan);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", endPan);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Capture phase so a pan never also selects or drags a product.
  const onViewportMouseDownCapture = useCallback((e) => {
    const viewport = viewportRef.current;
    if (!viewport || !canvasRef.current) return;
    if (!(e.button === 1 || (e.button === 0 && spaceHeldRef.current))) return;
    e.preventDefault();
    e.stopPropagation();
    panRef.current = { x: e.clientX, y: e.clientY, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop };
    setPanMode("panning");
  }, []);

  // ── Mouse helpers ─────────────────────────────────────────────────────────
  const toCanvasCoords = (clientX, clientY) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const rx = DS / rect.width;
    const ry = DS / rect.height;
    return {
      mx: (clientX - rect.left) * rx,
      my: (clientY - rect.top)  * ry,
    };
  };

  const onMouseDown = useCallback((e) => {
    const { mx, my } = toCanvasCoords(e.clientX, e.clientY);
    for (let i = items.length-1; i >= 0; i--) {
      const it = items[i];
      if (pointInItem(it, mx, my)) {
        undoRef.current = undoSnapshot(it);
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
    if (e.buttons === 0) { dragRef.current = null; return; }
    const { mx, my } = toCanvasCoords(e.clientX, e.clientY);
    const { itemId, ox, oy } = dragRef.current;
    // Coalesce mousemoves into one state update per animation frame. The pending
    // point carries its own drag info so a mouseup before the frame still lands it.
    dragPointRef.current = { itemId, ox, oy, mx, my };
    if (dragFrameRef.current !== null) return;
    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null;
      const point = dragPointRef.current;
      dragPointRef.current = null;
      if (!point) return;
      const S = scaleFactor();
      setItems(prev => prev.map(it =>
        it.id===point.itemId ? {...it, canvasX:Math.round((point.mx-point.ox)/S), canvasY:Math.round((point.my-point.oy)/S)} : it
      ));
    });
  }, []);

  const onMouseUp = useCallback(() => { dragRef.current = null; }, []);

  // Bound to window (not just the canvas) so a drag that leaves the canvas
  // bounds before mouseup still tracks the cursor and still releases the
  // drag on button-up, instead of "sticking" the item to the next cursor
  // position when the mouse re-enters the canvas.
  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  const doUndo = useCallback(() => {
    if (!undoRef.current) return;
    const { id,canvasX,canvasY,scale,rotation = 0 } = undoRef.current;
    undoRef.current = null;
    rotateGestureRef.current = { id: null, at: 0 };
    if (!items.some(it => it.id === id)) {
      setStatus("nothing to undo.");
      return;
    }
    setItems(prev => prev.map(it => it.id===id ? {...it,canvasX,canvasY,scale,rotation} : it));
    setStatus("undone.");
  }, [items]);

  const removeSelected = useCallback(() => {
    if (!selId) return;
    if (undoRef.current?.id === selId) undoRef.current = null;
    setItems(prev => prev.filter(it => it.id!==selId));
    setSelId(null);
  }, [selId]);

  const saveSessionCheckpoint = useCallback(async (nextQueueIndex) => {
    // A dropped selection is not a folder the session can reopen (resume rescans src_root),
    // so its progress is not written; resuming would land on the wrong images.
    if (sourceStage === "dropped") return;
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
    patchSettings({ output: { thumbnail: enabled } }).catch(() => {
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
      const rotation = item.rotation || 0;
      if (!rotation) {
        const x = Math.round(item.canvasX * renderScale - width / 2);
        const y = Math.round(item.canvasY * renderScale - height / 2);
        ctx.drawImage(item.htmlImg, x, y, width, height);
        continue;
      }
      ctx.save();
      ctx.translate(item.canvasX * renderScale, item.canvasY * renderScale);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.drawImage(item.htmlImg, -width / 2, -height / 2, width, height);
      ctx.restore();
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
    let packageBlob = null;
    if (isSingleImageMode && thumbnailBlob) {
      packageBlob = await createStoredZipBlob([
        { filename: finalDownloadName(currentName), blob: finalBlob },
        { filename: thumbnailPackagePath(currentName), blob: thumbnailBlob },
      ]);
      packageDownloaded = true;
    }

    // Desktop app: native Save dialog, so a cancel is known and the photo stays.
    if (isSingleImageMode && canSaveWithDialog()) {
      let result;
      try {
        result = packageBlob
          ? await saveFileWithDialog(packageBlob, zipDownloadName(currentName), "zip")
          : await saveFileWithDialog(finalBlob, finalDownloadName(currentName), "png");
      } catch (error) {
        setStatus(`save failed: ${error.message}. The photo is still open.`);
        return false;
      }
      if (!result?.saved) {
        setStatus("Save cancelled. The photo is still open.");
        return false;
      }
      const savedName = String(result.path || "").split(/[\\/]/).pop();
      if (fromSave) setSaved(true);
      setStatus(`saved ${packageDownloaded ? "ZIP (PNG + thumbnail)" : "PNG"}: ${savedName}`);
      if (fromSave) {
        // Let the "Saved!" flash paint before clearing the canvas; the timer is
        // cancelled if a new image is loaded before it fires.
        scheduleSavedReset(resetEditorToDefaultState);
      }
      return true;
    }

    if (packageBlob) {
      triggerBlobDownload(packageBlob, zipDownloadName(currentName));
    } else {
      triggerBlobDownload(finalBlob, finalDownloadName(currentName));
      if (thumbnailBlob) triggerBlobDownload(thumbnailBlob, thumbnailDownloadName(currentName));
    }

    if (fromSave) setSaved(true);
    const downloadLabel = packageDownloaded
      ? "downloaded ZIP package."
      : thumbnailBlob ? "downloaded PNG + thumbnail." : "downloaded PNG.";
    setStatus(fromSave && isSingleImageMode
      ? `${downloadLabel} Single image mode does not write to batch output.`
      : downloadLabel);
    // A browser download can't report a cancelled Save dialog, so the photo is
    // never cleared here; loading another image replaces it.
    if (fromSave) scheduleSavedReset();
    return true;
  }, [generateThumbnail, isSingleImageMode, items, queue, queueIdx, renderExportCanvas, renderThumbnailCanvas, resetEditorToDefaultState, scheduleSavedReset, singleImageName, srcFolder]);

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
        rotation:   it.rotation || 0,
      }));
      const result = await saveComposition(
        payload, srcFolder, queueIdx, comboMode,
        generateThumbnail,
        canvasSizeProp ?? canvasSizeState,
        activeOutputDir,
      );
      const wasSkipped = historyRef.current.get(queueIdx)?.action === "skipped";
      historyRef.current.set(queueIdx, { action: "saved", comboMode, items: items.map(placementSnapshot) });
      let skippedNote = "";
      if (wasSkipped) {
        try {
          await unskipImage(queue[queueIdx], srcFolder, activeOutputDir);
          skippedNote = " · removed skipped copy";
        } catch (e) {
          skippedNote = e.status === 404
            ? " · skipped copy kept (API has no /unskip yet)"
            : ` · skipped copy kept (${e.message})`;
        }
      }
      setSaved(true);
      setStatus(`saved: ${result.saved.split(/[\\/]/).pop()}${generateThumbnail && result.thumb ? " + thumbnail" : ""}${skippedNote}`);
      scheduleSavedReset();
      try {
        await saveSessionCheckpoint(queueIdx + 1);
      } catch {
        setStatus(prev => `${prev} · session checkpoint not saved`);
      }
      // Await the chained load so the in-flight guard stays set until the
      // next item has actually finished loading — otherwise, in combo mode
      // (where `items` isn't cleared by advance()), a fast double-save can
      // start a second save/advance cycle while this one's loadImage is
      // still mid-flight, racing both against `items`/`selId`.
      await advance();
    } catch (e) {
      prefetchRef.current = null;
      setStatus(`save failed: ${e.message}`);
    } finally {
      saveInFlightRef.current = false;
    }
  }, [items, isSingleImageMode, doDownload, queue, queueIdx, srcFolder, comboMode, generateThumbnail, canvasSizeProp, canvasSizeState, advance, prefetchNextImage, activeOutputDir, saveSessionCheckpoint, scheduleSavedReset]);

  const doSkip = useCallback(async () => {
    if (isSingleImageMode) return;
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    try {
      prefetchNextImage(queue, queueIdx + 1);
      if (queueIdx < queue.length) {
        try {
          await skipImage(queue[queueIdx], srcFolder, activeOutputDir);
        } catch (e) {
          prefetchRef.current = null;
          setStatus(`skip failed: ${e.message}`);
          return;
        }
      }
      const wasSaved = historyRef.current.get(queueIdx)?.action === "saved";
      historyRef.current.set(queueIdx, { action: "skipped" });
      await saveSessionCheckpoint(queueIdx + 1).catch(() => {});
      setStatus(wasSaved ? "skipped. Its earlier saved output is still in the output folder." : "skipped.");
      await advance();
    } finally {
      saveInFlightRef.current = false;
    }
  }, [isSingleImageMode, queue, queueIdx, advance, prefetchNextImage, srcFolder, activeOutputDir, saveSessionCheckpoint]);

  // Back to the previous queue image (also after the batch finished) to fix and re-save it.
  const goPrevious = useCallback(async () => {
    if (isSingleImageMode || saveInFlightRef.current) return;
    const reopenFinished = !queue.length && finishedQueue.length > 0;
    const q = reopenFinished ? finishedQueue : queue;
    const prevIdx = (reopenFinished ? q.length : queueIdx) - 1;
    if (prevIdx < 0) {
      setStatus("already at the first image.");
      return;
    }
    saveInFlightRef.current = true;
    try {
      clearSavedResetTimer();
      setSaved(false);
      prefetchRef.current = null;
      undoRef.current = null;
      dragRef.current = null;
      if (reopenFinished) {
        setQueue(q);
        setFinishedQueue([]);
      }
      setQueueIdx(prevIdx);
      setActiveSnapZone(null);
      setItems([]);
      setSelId(null);
      const message = historyStatus(q, prevIdx, "back to");
      if (!await restoreSavedPlacement(historyRef.current.get(prevIdx))) {
        await loadImageRef.current(q, prevIdx, false);
      }
      // Keep the saved session on the image now being edited.
      await saveSessionCheckpoint(prevIdx).catch(() => {});
      setStatus(message);
    } finally {
      saveInFlightRef.current = false;
    }
  }, [clearSavedResetTimer, finishedQueue, historyStatus, isSingleImageMode, queue, queueIdx, restoreSavedPlacement, saveSessionCheckpoint]);

  const onKeyDown = useCallback((e) => {
    const isEditingText = isTextEntryTarget(e.target);
    if (e.key === "Enter") {
      if (enterBelongsToTarget(e.target) || saveInFlightRef.current) return;
      // Enter on a focused button, switch or option activates that control instead.
      if (e.target?.closest?.("button, a, [role='switch'], [role='radio'], [role='option'], [role='separator']")) return;
      e.preventDefault();
      if (e.repeat) return; // holding Enter must not save the following images unseen
      Promise.resolve(doSave()).catch((err) => setStatus(`save failed: ${err?.message || err}`));
      return;
    }
    // Arrows, S, Ctrl+Z and Delete belong to the focused field while typing or using a slider/select.
    if (isEditingText) return;
    const n = e.shiftKey ? 10 : 1;
    const map = { ArrowLeft:[-n,0], ArrowRight:[n,0], ArrowUp:[0,-n], ArrowDown:[0,n] };
    if (map[e.key]) {
      e.preventDefault();
      if (!selId) return;
      const [dx,dy] = map[e.key];
      setItems(prev => prev.map(it => it.id===selId ? {...it,canvasX:it.canvasX+dx,canvasY:it.canvasY+dy} : it));
      return;
    }
    const plainKey = !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat;
    const report = (what) => (err) => setStatus(`${what} failed: ${err?.message || err}`);
    if ((e.key==="s"||e.key==="S") && plainKey) Promise.resolve(doSkip()).catch(report("skip"));
    if ((e.key==="p"||e.key==="P") && plainKey) Promise.resolve(goPrevious()).catch(report("previous"));
    if ((e.ctrlKey||e.metaKey) && e.key==="z") doUndo();
    if ((e.key==="Delete"||e.key==="Backspace") && selId) {
      e.preventDefault();
      removeSelected();
    }
  }, [selId, doSave, doSkip, doUndo, goPrevious, removeSelected]);

  function snapTo(zone) {
    if (!sel) { setStatus("select an item first."); return; }
    const g = guides[zone];
    if (!g) return;
    undoRef.current = undoSnapshot(sel);
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

  // mode "fit": whole photo visible, touching two canvas edges.
  // mode "fill": photo covers the whole canvas; the overflow is cut off on save.
  function snapToFull(mode = "fit") {
    if (!sel) { setStatus("select an item first."); return; }
    undoRef.current = undoSnapshot(sel);
    const extent = rotatedExtent(sel);
    const pick = mode === "fill" ? Math.max : Math.min;
    const snapScale = pick(CANVAS_SIZE / extent.w, CANVAS_SIZE / extent.h);
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
    undoRef.current = sel ? undoSnapshot(sel) : null;
    setItems(prev => prev.map(it =>
      it.id===selId
        ? axis==="h" ? {...it,canvasX:CANVAS_SIZE/2} : {...it,canvasY:CANVAS_SIZE/2}
        : it
    ));
  }

  function onTemplateChange(name) {
    setTemplate(name);
    setTemplateMatchInfo(null);
    if (!name || name === "— none —") { setActiveSnapZone(null); return; }
    const tmpl = templates[name];
    if (tmpl?.zone && sel) snapTo(tmpl.zone);
    else if (tmpl?.zone) setActiveSnapZone(tmpl.zone);
  }

  function setRotation(next, { relative = false } = {}) {
    if (!sel) return;
    undoRef.current = undoSnapshot(sel);
    rotateGestureRef.current = { id: null, at: 0 };
    setItems(prev => prev.map(it =>
      it.id===selId ? {...it, rotation: normalizeRotation(relative ? (it.rotation || 0) + next : next)} : it
    ));
  }

  function toggleAutoTemplateMatch(enabled) {
    setAutoTemplateMatch(enabled);
    if (!enabled) setTemplateMatchInfo(null);
    patchSettings({ editor: { auto_template_match: enabled } }).catch(() => {
      setStatus("auto-match changed locally, but settings save failed");
    });
  }

  function nudgeScale(d) {
    if (scaleLocked||!sel) return;
    undoRef.current = undoSnapshot(sel);
    setItems(prev => prev.map(it =>
      it.id===selId ? {...it, scale:Math.max(0.02,Math.min(Math.max(4.0,it.scale),it.scale+d))} : it
    ));
  }

  const snapBtns = [
    { lbl:"Green",   zone:"green"   },
    { lbl:"Blue",    zone:"blue"    },
    { lbl:"Magenta", zone:"magenta" },
    { lbl:"Red",     zone:"red"     },
  ];

  const zoomPresets = [
    { label:"50%",  value:0.5  },
    { label:"75%",  value:0.75 },
    { label:"Fit",  value:1.0  },
    { label:"150%", value:1.5  },
    { label:"200%", value:2.0  },
    { label:"400%", value:4.0  },
  ];
  const zoomIsPreset = zoomPresets.some(p => p.value === zoom);

  // How much each product is enlarged in the saved image relative to its own
  // source pixels (both save paths draw at origW * scale * exportSize / CANVAS_SIZE).
  const exportSizeNow = canvasSizeProp ?? canvasSizeState;
  const enlargementOf = (it) => it.scale * exportSizeNow / CANVAS_SIZE;
  const enlargedItems = items.filter(it => enlargementOf(it) > ENLARGE_WARN_THRESHOLD);
  const selEnlargement = sel ? enlargementOf(sel) : 0;
  const selIsEnlarged = selEnlargement > ENLARGE_WARN_THRESHOLD;
  const otherEnlargedCount = enlargedItems.filter(it => it.id !== selId).length;
  const canvasCursor = panMode === "panning" ? "grabbing" : panMode === "ready" ? "grab" : "crosshair";
  const canGoPrevious = !isSingleImageMode && (queue.length ? queueIdx > 0 : finishedQueue.length > 0);
  const queueChip = isSingleImageMode
    ? "single"
    : queue.length ? `${Math.min(queueIdx + 1, queue.length)} / ${queue.length}` : "— / —";
  const currentFileLabel = isSingleImageMode
    ? singleImageName || "Single image"
    : queue[queueIdx] ? imageQueueLabel(queue[queueIdx], srcFolder) : (srcLabel || "No image loaded");
  const singleSavesWithDialog = canSaveWithDialog();
  const saveButtonLabel = saved
    ? isSingleImageMode && !singleSavesWithDialog ? "Downloaded" : "Saved"
    : isSingleImageMode ? (singleSavesWithDialog ? "Save…" : "Download") : "Save & next";

  const statusLine = String(statusHistory[0]?.message || status || "").split("\n")[0];
  const zoomOptions = zoomPresets.map(({ label, value }) => ({ value, label: value === 1.0 ? "Fit" : label }));

  return (
    <>
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onClickCapture={(e) => {
          if (!shouldRefocusAfterClick(e)) return;
          // Deferred so it runs after the button's own click handler and default focus.
          window.setTimeout(() => containerRef.current?.focus({ preventScroll: true }), 0);
        }}
        className="editor-root"
      >
      <input
        ref={imageFileInputRef}
        className="editor-single-file-input"
        type="file"
        multiple
        accept={SINGLE_IMAGE_ACCEPT}
        onChange={onImageInputChange}
      />

      <PageHeader
        title="Editor"
        subtitle="Place products on the canvas and export"
        className="editor-app-header"
        actions={(
        <>
          {!isSingleImageMode && (
            <Button onClick={goPrevious} disabled={!canGoPrevious} title="Back to the previous image to fix and save it again">
              Previous <kbd className="ui-kbd">P</kbd>
            </Button>
          )}
          {!isSingleImageMode && (
            <Button onClick={doSkip}>
              Skip <kbd className="ui-kbd">S</kbd>
            </Button>
          )}
          <span className="ui-badge editor-queue-chip" title="Position in the queue">{queueChip}</span>
          <Button variant="primary" icon={saved ? Check : undefined} onClick={doSave}>
            {saveButtonLabel} <kbd className="ui-kbd">↵</kbd>
          </Button>
          <IconButton
            icon={toolsCollapsed ? PanelRightOpen : PanelRightClose}
            label={toolsCollapsed ? "Show tools panel" : "Hide tools panel"}
            onClick={() => setToolsCollapsed(!toolsCollapsed)}
          />
        </>
        )}
      />

      <div className="editor-workspace">
      {/* ── Canvas area ──────────────────────────────────────────── */}
      <div className="editor-canvas-column">
        <div
          ref={viewportRef}
          className={dropActive && items.length ? "editor-canvas-viewport is-drop-target" : "editor-canvas-viewport"}
          onMouseDownCapture={onViewportMouseDownCapture}
          style={panMode ? { cursor: canvasCursor } : undefined}
          onDragOver={onDropDragOver}
          onDragLeave={onDropDragLeave}
          onDrop={onDrop}
        >
          {items.length ? (
            <div className="editor-canvas-frame" style={{ width: canvasCssPx, height: canvasCssPx }}>
              <div className="editor-artboard" style={{ background: canvasBgColor }}>
                <canvas
                  ref={canvasRef} width={DS * canvasPixelScale} height={DS * canvasPixelScale}
                  onMouseDown={onMouseDown}
                  style={{ cursor: canvasCursor, display:"block", width:"100%", height:"100%" }}
                />
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={dropActive ? "editor-empty-dropzone is-dragging" : "editor-empty-dropzone"}
              onClick={browseImages}
            >
              <ImagePlus size={28} aria-hidden="true" />
              <strong>Drop images or folders here to edit</strong>
              <span>Several at once go straight into the queue. PNG, JPG, WebP, TIFF, or AVIF.</span>
            </button>
          )}
        </div>

        <StatusBar
          left={(
            <>
              <span className="editor-status-file" title={currentFileLabel}>{currentFileLabel}</span>
              {statusLine ? <span className="editor-status-message" title={statusLine}>{statusLine}</span> : null}
            </>
          )}
          right={(
            <>
              <IconButton
                ref={activityButtonRef}
                icon={History}
                label="Activity history"
                size="s"
                aria-expanded={historyOpen}
                onClick={() => { setShortcutsOpen(false); setHistoryOpen(o => !o); }}
              />
              <IconButton
                ref={shortcutsRef}
                icon={Keyboard}
                label="Keyboard and mouse shortcuts"
                size="s"
                aria-expanded={shortcutsOpen}
                onClick={() => { setHistoryOpen(false); setShortcutsOpen(o => !o); }}
              />
              {!zoomIsPreset && (
                <span className="ui-badge" title="Current zoom (Alt+Scroll)">{Math.round(zoom * 100)}%</span>
              )}
              <SegmentedControl
                size="s"
                label="Zoom"
                options={zoomOptions}
                value={zoomIsPreset ? zoom : null}
                onChange={(value) => zoomTo(value)}
              />
            </>
          )}
        />

        <Popover open={historyOpen} onClose={() => setHistoryOpen(false)} anchorRef={activityButtonRef} width={340} align="end" label="Activity history">
          <div className="editor-history-list">
            {statusHistory.length ? statusHistory.map((entry, index) => (
              <div key={entry.id} className={index === 0 ? "editor-history-entry is-current" : "editor-history-entry"}>
                <div className="editor-history-meta">{index === 0 ? "Latest" : entry.time}</div>
                <div className="editor-history-message">{entry.message}</div>
              </div>
            )) : (
              <div className="editor-history-empty">No editor activity yet.</div>
            )}
          </div>
        </Popover>

        <Popover open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} anchorRef={shortcutsRef} width={300} align="end" label="Shortcuts">
          <dl className="editor-shortcuts">
            {SHORTCUTS.map(([action, keys]) => (
              <div key={action} className="editor-shortcut">
                <dt>{action}</dt>
                <dd>{keys}</dd>
              </div>
            ))}
          </dl>
        </Popover>
      </div>

      {/* ── Tools panel ───────────────────────────────────────────── */}
      <ResizablePanel
        prefKey="editor.tools"
        side="right"
        defaultWidth={320}
        min={260}
        max={460}
        collapsed={toolsCollapsed}
        className="editor-sidebar"
        aria-label="Tools"
      >
        <div key={sidebarResetKey} className="editor-sidebar-scroll">

          {/* ── Template ── */}
          <Section title="Template" prefKey="editor.template">
            <TemplatePicker
              templates={templates}
              value={template}
              onChange={onTemplateChange}
              onClosed={() => containerRef.current?.focus({ preventScroll: true })}
            />
            <Checkbox
              checked={autoTemplateMatch}
              onChange={e => toggleAutoTemplateMatch(e.target.checked)}
              label="Auto-match from file name"
              title="Pick the template whose file-name words (Templates screen) appear in the photo's name"
            />
            {templateMatchInfo && templateMatchInfo.name === template && (
              <p className="editor-note">Matched “{templateMatchInfo.keyword}” in the file name</p>
            )}
            {templates[template]?.hint && <p className="ui-hint">{templates[template].hint}</p>}
            {templates[template]?.ref_image && <RefImage key={template} src={templateRefSrc} />}
            {!!templates[template]?.ref_image && (
              <div className="editor-ref-controls">
                <Checkbox checked={showRefOnCanvas} onChange={e => setShowRefOnCanvas(e.target.checked)} label="Show reference on canvas" />
                <span className="ui-row-label">Reference opacity</span>
                <Slider
                  label="Reference opacity"
                  min={0.15}
                  max={0.35}
                  step={0.01}
                  decimals={0}
                  suffix="%"
                  value={refOpacity}
                  display={v => Math.round(v * 100)}
                  parse={v => v / 100}
                  onChange={setRefOpacity}
                  disabled={!showRefOnCanvas}
                />
              </div>
            )}
          </Section>

          {/* ── Placement ── */}
          <Section title="Placement" prefKey="editor.placement">
            <div className="editor-grid editor-grid-2">
              {snapBtns.map(({ lbl, zone }) => (
                <button
                  key={zone}
                  type="button"
                  className={activeSnapZone === zone ? "editor-zone-button is-active" : "editor-zone-button"}
                  aria-pressed={activeSnapZone === zone}
                  title={`Snap to the ${zone} guide`}
                  onClick={() => snapTo(zone)}
                >
                  <span className="ui-dot" style={{ background: zoneColor(zone) }} aria-hidden="true" />
                  {lbl}
                </button>
              ))}
            </div>
            <div className="editor-grid editor-grid-4">
              <Button size="m" icon={Scan} title="Whole photo visible, touching two canvas edges" onClick={() => snapToFull("fit")}>Fit</Button>
              <Button size="m" icon={Maximize} title="Cover the whole canvas; edges that stick out are cut off" onClick={() => snapToFull("fill")}>Fill</Button>
              <Button size="m" icon={AlignHorizontalJustifyCenter} title="Center horizontally" onClick={() => doAlign("h")}>H</Button>
              <Button size="m" icon={AlignVerticalJustifyCenter} title="Center vertically" onClick={() => doAlign("v")}>V</Button>
            </div>
          </Section>

          {/* ── Transform ── */}
          <Section title="Scale" prefKey="editor.scale">
            <Checkbox checked={scaleLocked} onChange={e => setScaleLocked(e.target.checked)} label="Lock scale" />
            <Slider
              label="Scale"
              min={0.05}
              max={3}
              step={0.005}
              decimals={3}
              value={sel?.scale ?? 1.0}
              disabled={scaleLocked || !sel}
              onChange={v => { if (scaleLocked || !selId) return; setItems(prev => prev.map(it => it.id === selId ? { ...it, scale: v } : it)); }}
              onTypedChange={v => {
                if (scaleLocked || !sel) return;
                undoRef.current = undoSnapshot(sel);
                setItems(prev => prev.map(it => it.id === selId ? { ...it, scale: v } : it));
              }}
            />
            <div className="editor-grid editor-grid-4">
              {[["−5%", -0.05], ["−1%", -0.01], ["+1%", 0.01], ["+5%", 0.05]].map(([l, d]) => (
                <Button key={l} size="m" onClick={() => nudgeScale(d)} disabled={scaleLocked || !sel}>{l}</Button>
              ))}
            </div>
            {sel && selIsEnlarged && (
              <div className="editor-callout" role="status">
                <TriangleAlert size={14} aria-hidden="true" />
                <div>
                  <strong>Enlarged to {Math.round(selEnlargement * 100)}% of the original</strong>
                  <span>
                    The source is only {sel.origW}×{sel.origH}px, so the saved image will look soft.
                    It stays sharp up to scale {(CANVAS_SIZE / exportSizeNow).toFixed(3)}. Reduce the
                    scale or use a larger source image.
                  </span>
                </div>
              </div>
            )}
            {otherEnlargedCount > 0 && (
              <div className="editor-callout" role="status">
                <TriangleAlert size={14} aria-hidden="true" />
                <div>
                  <span>
                    {otherEnlargedCount} other item{otherEnlargedCount > 1 ? "s are" : " is"} enlarged past
                    {otherEnlargedCount > 1 ? " their" : " its"} original size.
                  </span>
                </div>
              </div>
            )}
          </Section>

          <Section title="Rotate" prefKey="editor.rotate">
            <Slider
              label="Rotation"
              min={-180}
              max={180}
              step={0.1}
              decimals={1}
              suffix="°"
              value={sel?.rotation ?? 0}
              disabled={!sel}
              onPointerDown={() => { if (sel) undoRef.current = undoSnapshot(sel); }}
              onChange={v => { if (!selId) return; const r = normalizeRotation(v); setItems(prev => prev.map(it => it.id === selId ? { ...it, rotation: r } : it)); }}
              onTypedChange={v => {
                if (!sel) return;
                undoRef.current = undoSnapshot(sel);
                const r = normalizeRotation(v);
                setItems(prev => prev.map(it => it.id === selId ? { ...it, rotation: r } : it));
              }}
            />
            <div className="editor-grid editor-grid-5">
              {[["−90°", -90, true], ["−1°", -1, true], ["0°", 0, false], ["+1°", 1, true], ["+90°", 90, true]].map(([l, d, relative]) => (
                <Button key={l} size="m" onClick={() => setRotation(d, { relative })} disabled={!sel}>{l}</Button>
              ))}
            </div>
            <p className="ui-hint">Ctrl+Scroll on the canvas rotates; hold Shift for 0.1° steps.</p>
          </Section>

          {/* ── Canvas ── */}
          <Section title="Canvas" prefKey="editor.canvas" defaultOpen={false}>
            <div className="ui-row">
              <label className="ui-row-label" htmlFor="editor-bg-hex">Background</label>
              <div className="editor-color">
                <input
                  type="color"
                  aria-label="Background color"
                  value={canvasBgColor}
                  onChange={e => setCanvasBgColor(e.target.value)}
                />
                <TextField
                  id="editor-bg-hex"
                  mono
                  value={canvasBgColor}
                  maxLength={7}
                  onChange={e => { const v = e.target.value; if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setCanvasBgColor(v); }}
                />
              </div>
            </div>
            <p className="ui-hint">Preview only. Saved images always keep a transparent background.</p>
          </Section>

          {/* ── Items ── */}
          {items.length > 0 && (
            <Section title="Items" prefKey="editor.items" defaultOpen={false} badge={items.length}>
              <div className="editor-items">
                {items.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    className={item.id === selId ? "editor-item is-active" : "editor-item"}
                    aria-pressed={item.id === selId}
                    onClick={() => setSelId(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <Button variant="danger" icon={Trash2} onClick={removeSelected} disabled={!sel}>
                Remove item <kbd className="ui-kbd">Del</kbd>
              </Button>
            </Section>
          )}

          {/* ── Output ── */}
          <Section title="Output" prefKey="editor.output" defaultOpen={false}>
            <Switch
              checked={generateThumbnail}
              onChange={toggleGenerateThumbnail}
              label="Generate thumbnail"
            />
            <p className="ui-hint">Save a {thumbnailSize}px preview copy in a thumbnail folder next to the final image.</p>
            {isSingleImageMode ? (
              <p className="ui-hint">
                Single image export downloads {generateThumbnail ? "the final PNG and thumbnail PNG" : "the final PNG only"} without writing to a batch output folder.
              </p>
            ) : (
              /* Passes the session folder so Explorer opens the folder the images came from/go to. */
              <Button icon={FolderOpen} onClick={() => openFolder(activeOutputDir || srcFolder).catch(() => {})}>
                Open output folder
              </Button>
            )}
          </Section>

          {/* ── Source ── */}
          <Section title="Source" prefKey="editor.source" defaultOpen={false}>
            <div className="editor-source-row">
              <Button icon={FolderOpen} onClick={async () => {
                let path = "";
                try {
                  ({ path } = await browseFolder(srcFolder));
                } catch {
                  setStatus("folder picker unavailable\ncheck that api.py is running");
                  return;
                }
                if (!path) return;
                setSessionOutputDir("");
                await initFromFolder(path, 0).catch((e) => {
                  setStatus(`folder load failed: ${e.message}`);
                });
              }}>
                Change source folder
              </Button>
              <IconButton
                icon={RotateCcw}
                label="Reload source folder"
                variant="secondary"
                disabled={!srcFolder || isSingleImageMode}
                onClick={() => {
                  initFromFolder(srcFolder, 0).catch((e) => {
                    setStatus(`reload failed: ${e.message}`);
                  });
                }}
              />
            </div>
            <Checkbox checked={comboMode} onChange={e => setComboMode(e.target.checked)} label="Combo mode" />
          </Section>
        </div>
      </ResizablePanel>
      </div>
      </div>
      <ConfirmModal
        open={Boolean(confirmState)}
        title={confirmState?.title}
        message={confirmState?.message}
        confirmLabel={confirmState?.confirmLabel}
        cancelLabel={confirmState?.cancelLabel}
        tone="default"
        onConfirm={() => closeConfirm(true)}
        onCancel={() => closeConfirm(false)}
      />
    </>
  );
}
