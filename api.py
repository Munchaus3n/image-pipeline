# =============================================================
# IMAGE PIPELINE — Local API Server
# Version : v1.2
# Copyright (c) 2026 Liudas. Licensed under AGPL-3.0. See LICENSE.
# =============================================================

import asyncio
import copy
import hashlib
import io
import json
import os
import platform
import re
import shutil
import string
import subprocess
import sys
import time
import uuid
import configparser
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field, field_validator
from PIL import Image, UnidentifiedImageError
from sse_starlette.sse import EventSourceResponse
from contextlib import asynccontextmanager
import threading
from concurrent.futures import ThreadPoolExecutor

# If pillow-avif-plugin is installed, importing it may register AVIF decoders in Pillow.
_PILLOW_AVIF_IMPORTED = False
_PILLOW_AVIF_IMPORT_ERROR = ""
try:
    import pillow_avif  # noqa: F401
    _PILLOW_AVIF_IMPORTED = True
except Exception as e:
    _PILLOW_AVIF_IMPORT_ERROR = f"{type(e).__name__}: {e}"

# Thumbnail writes are CPU+disk bound — run them on a thread pool so they
# never block the save response. The editor advances immediately; thumb
# writes finish in the background a few hundred ms later.
_thumb_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="thumb")

# ── Model warm-up ─────────────────────────────────────────────────────────────
# Runs once in a background thread when api.py starts.
# Ensures model weights are downloaded + in OS file cache before the first
# pipeline run. pipeline.py runs in a subprocess, so this cannot keep a live
# model session loaded for the actual processing run.

def _warmup_worker():
    try:
        from rembg import new_session
        import onnxruntime as ort
        # Read model name from settings if already saved, else use default
        model = "birefnet-general"
        try:
            if SETTINGS_FILE.exists():
                _s = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
                model = _s.get("processing", {}).get("rembg_model", model)
        except Exception:
            pass
        # Always warm up on CPU — we just want weights on disk/OS cache.
        # The real pipeline run will pick the right provider (DML/CUDA/CPU).
        new_session(model, providers=["CPUExecutionProvider"])
    except Exception:
        pass  # Warm-up is best-effort; never crash the server

@asynccontextmanager
async def lifespan(app_instance: "FastAPI"):
    _cleanup_app_cache()
    t = threading.Thread(target=_warmup_worker, daemon=True, name="model-warmup")
    t.start()
    yield

# ── Config ────────────────────────────────────────────────────────────────────

def _env_path(name: str) -> Path | None:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return None
    try:
        return Path(raw).expanduser().resolve()
    except Exception:
        return Path(raw).expanduser()


BASE_DIR = _env_path("CUTOUT_STUDIO_RESOURCE_DIR") or Path(__file__).parent
APP_DATA_ROOT = _env_path("CUTOUT_STUDIO_USER_DATA")
PACKAGED_MODE = bool(APP_DATA_ROOT and os.environ.get("CUTOUT_STUDIO_PACKAGED") == "1")

CONFIG_DIR = APP_DATA_ROOT / "config" if PACKAGED_MODE else BASE_DIR
SESSION_DIR = APP_DATA_ROOT / "session" if PACKAGED_MODE else BASE_DIR
CACHE_ROOT = APP_DATA_ROOT / "cache" if PACKAGED_MODE else BASE_DIR / ".cache"
PREVIEW_CACHE_DIR = CACHE_ROOT / "previews"
TEMP_CACHE_DIR = CACHE_ROOT / "temp"
THUMBNAIL_CACHE_DIR = CACHE_ROOT / "thumbnails"
MODELS_DIR = APP_DATA_ROOT / "models" if PACKAGED_MODE else None
LOGS_DIR = APP_DATA_ROOT / "logs" if PACKAGED_MODE else BASE_DIR
HISTORY_DIR = APP_DATA_ROOT / "history" if PACKAGED_MODE else BASE_DIR / "history"

_cfg = configparser.ConfigParser()
_cfg.read(BASE_DIR / "config.ini")

CANVAS_SIZE   = _cfg.getint("canvas", "canvas_size",  fallback=1440)
OUTPUT_ROOT   = (APP_DATA_ROOT / "exports") if PACKAGED_MODE else BASE_DIR / _cfg.get("paths", "output_root",   fallback="output")
TEMPLATES_DIR = BASE_DIR / _cfg.get("paths", "templates_dir", fallback="templates")
SESSION_FILE  = SESSION_DIR / "session.json"
SETTINGS_FILE = CONFIG_DIR / "settings.json"
PREVIEW_CACHE_VERSION = "preview-v1"
PREVIEW_CACHE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
PREVIEW_CACHE_CLEANUP_INTERVAL_SECONDS = 15 * 60
APP_CACHE_MAX_BYTES = 5 * 1024 * 1024 * 1024
APP_CACHE_TARGET_BYTES = 4 * 1024 * 1024 * 1024
DEFAULT_UPSCALE_MAX_PX = 3600

for _dir in (CONFIG_DIR, SESSION_DIR, PREVIEW_CACHE_DIR, TEMP_CACHE_DIR, THUMBNAIL_CACHE_DIR, LOGS_DIR, OUTPUT_ROOT):
    _dir.mkdir(parents=True, exist_ok=True)
if MODELS_DIR is not None:
    for _dir in (MODELS_DIR / "rembg", MODELS_DIR / "huggingface", MODELS_DIR / "onnx"):
        _dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("HF_HOME", str(MODELS_DIR / "huggingface"))
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", str(MODELS_DIR / "huggingface" / "hub"))
    os.environ.setdefault("XDG_CACHE_HOME", str(MODELS_DIR))
    os.environ.setdefault("U2NET_HOME", str(MODELS_DIR / "rembg"))
    os.environ.setdefault("REMBG_HOME", str(MODELS_DIR / "rembg"))
    os.environ.setdefault("ONNXRUNTIME_HOME", str(MODELS_DIR / "onnx"))

SUPPORTED_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".avif"}
IMAGE_MEDIA_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".avif": "image/avif",
}
AVIF_DECODE_ERROR = "AVIF preview decode failed. Install pillow-avif-plugin in the API environment."

_preview_cache_cleanup_lock = threading.Lock()
_preview_cache_last_cleanup = 0.0

def _registered_avif_decoder() -> str | None:
    try:
        ext_map = Image.registered_extensions()
        value = ext_map.get(".avif")
        return str(value) if value is not None else None
    except Exception:
        return None


def _is_avif_decode_supported() -> bool:
    return _registered_avif_decoder() is not None

_AVIF_DECODE_SUPPORTED = _is_avif_decode_supported()

_ALLOWED_REMBG_FALLBACKS = {"auto"}
_ALLOWED_BG_DEVICE_MODES = {"cpu", "gpu", "gpu_auto"}

def _open_image_checked(path: Path) -> Image.Image:
    if path.suffix.lower() == ".avif" and not _AVIF_DECODE_SUPPORTED:
        raise HTTPException(status_code=400, detail=AVIF_DECODE_ERROR)
    try:
        with Image.open(path) as opened:
            return opened.copy()
    except (UnidentifiedImageError, OSError) as e:
        if path.suffix.lower() == ".avif":
            raise HTTPException(status_code=400, detail=AVIF_DECODE_ERROR) from e
        raise


def _media_type_for_image(path: Path) -> str:
    return IMAGE_MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream")


def _read_image_snapshot(path: Path, *, missing_detail: str) -> bytes:
    try:
        return path.read_bytes()
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=missing_detail) from e
    except OSError as e:
        raise HTTPException(status_code=503, detail=f"Image snapshot read failed, file may still be changing: {e}") from e

def _normalize_rembg_fallback(value: Any) -> str:
    raw = str(value or "").strip().lower()
    return raw if raw in _ALLOWED_REMBG_FALLBACKS else "auto"

def _normalize_bg_device_mode(value: Any, processing: dict | None = None) -> str:
    raw = str(value or "").strip().lower()
    if raw in _ALLOWED_BG_DEVICE_MODES:
        return raw
    if isinstance(processing, dict) and "force_cpu" in processing:
        return "cpu" if bool(processing.get("force_cpu")) else "gpu_auto"
    return "cpu"

def _g(key, fallback):
    return _cfg.getint("guides", key, fallback=fallback)

GUIDES = {
    "red":     {"top": _g("red_top",140),     "bottom": _g("red_bottom",1300),
                "left": _g("red_left",140),   "right": _g("red_right",1300),   "color": "#FF0000"},
    "green":   {"top": _g("green_top",224),   "bottom": _g("green_bottom",1216),
                "left": _g("green_left",224), "right": _g("green_right",1216), "color": "#00FF00"},
    "blue":    {"top": _g("blue_top",284),    "bottom": _g("blue_bottom",1156),
                "left": _g("blue_left",284),  "right": _g("blue_right",1156),  "color": "#0000FF"},
    "magenta": {"top": _g("magenta_top",434), "bottom": _g("magenta_bottom",1006),
                "left": _g("magenta_left",434),"right": _g("magenta_right",1006),"color": "#FF00FF"},
}

# ── Terminal output cleaning ──────────────────────────────────────────────────

_ANSI_RE = re.compile(
    r'\x1b'
    r'(?:[@-Z\\-_]'
    r'|\[[0-?]*[ -/]*[@-~]'
    r'|\][^\x07\x1b]*(?:\x07|\x1b\\))'
)
_CTRL_RE = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')

def _clean(raw: bytes) -> list[str]:
    text = raw.decode("utf-8", errors="replace")
    text = _ANSI_RE.sub("", text)
    lines = re.split(r"[\r\n]+", text)
    cleaned = []
    for line in lines:
        line = _CTRL_RE.sub("", line).strip()
        if line:
            cleaned.append(line)
    return cleaned

# ── Helpers ───────────────────────────────────────────────────────────────────

def images_in_folder(folder: Path, *, recursive: bool = True, limit: int = 0) -> tuple[list[Path], bool]:
    walker = folder.rglob("*") if recursive else folder.iterdir()
    images: list[Path] = []
    capped = limit > 0
    max_items = limit + 1 if capped else 0
    for p in walker:
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS:
            images.append(p)
            if capped and len(images) >= max_items:
                break
    truncated = capped and len(images) > limit
    if truncated:
        images = images[:limit]
    return sorted(images, key=lambda p: _natural_path_key(p, folder)), truncated

def _natural_path_key(path: Path, root: Path) -> tuple:
    try:
        value = path.relative_to(root)
    except ValueError:
        value = path
    parts = str(value).replace("\\", "/").lower().split("/")
    return tuple(
        tuple(int(chunk) if chunk.isdigit() else chunk for chunk in re.split(r"(\d+)", part))
        for part in parts
    )

def detect_source_folder(
    output_root: Path | None = None, *, allow_input_fallback: bool = True
) -> tuple[Path | None, str, str]:
    root = output_root or OUTPUT_ROOT
    for folder, label, stage in [
        (root / "processed", f"{root.name}/processed", "processed"),
        (root / "upscaled", f"{root.name}/upscaled", "upscaled"),
    ]:
        if folder.exists() and any(
            p.suffix.lower() in SUPPORTED_EXTS
            for p in folder.rglob("*") if p.is_file()
        ):
            return folder, label, stage
    if allow_input_fallback:
        return BASE_DIR / "input", "input", "input"
    root_label = root.name or str(root)
    return None, f"{root_label}/(no output)", "none"

# BUG-13 FIX: derive output base from src_root instead of using hardcoded OUTPUT_ROOT.
# If src_root ends with a known pipeline output stage name (processed/upscaled/bg_removed),
# go up one level to get the actual output folder. This means a custom output dir set by
# the user (e.g. D:/project/output/processed) correctly resolves to D:/project/output/editor.
# Default case (src_root = ./output/processed) is unchanged: parent = ./output = OUTPUT_ROOT.
def _output_base_from_src_root(src_root: Path) -> Path:
    if src_root.name in ("processed", "upscaled", "bg_removed"):
        return src_root.parent
    return OUTPUT_ROOT

def _hashed_rel_fallback(src: Path) -> Path:
    digest = hashlib.sha1(str(src).encode("utf-8")).hexdigest()[:10]
    return Path(f"{src.stem}__{digest}{src.suffix}")

def _relative_or_hashed(src: Path, src_root: Path) -> Path:
    try:
        rel = src.relative_to(src_root)
        if str(rel) and str(rel) != ".":
            return rel
    except ValueError:
        pass
    return _hashed_rel_fallback(src)

def mirror_save_path(src: Path, src_root: Path, output_base: Path | None = None, stage: str = "final") -> Path:
    base = output_base or _output_base_from_src_root(src_root)
    rel = _relative_or_hashed(src, src_root)
    if stage in ("", "final"):
        return base / "Editor" / rel
    return base / "Editor" / stage / rel

def mirror_thumbnail_path(save_path: Path, output_base: Path, thumb_size: int) -> Path:
    return save_path.parent / "thumbnail" / save_path.name

def mirror_skip_path(src: Path, src_root: Path, output_base: Path | None = None) -> Path:
    return mirror_save_path(src, src_root, output_base=output_base, stage="skipped")

# Allow any path on any local drive — this is a local-only app with no remote access.
# On Windows: add every mounted drive root (C:\, D:\, ...).
# On all platforms: also allow the user's home directory.
_drive_roots: set[Path] = set()
if platform.system() == "Windows":
    for d in string.ascii_uppercase:
        root = Path(f"{d}:\\")
        try:
            if root.exists():
                _drive_roots.add(root)
        except OSError:
            # Some mapped/system drives can raise access errors on stat().
            continue
_drive_roots.add(Path.home())

_allowed_roots_seed = {BASE_DIR, OUTPUT_ROOT, TEMPLATES_DIR, BASE_DIR / "input"} | _drive_roots
if APP_DATA_ROOT is not None:
    _allowed_roots_seed.add(APP_DATA_ROOT)
_ALLOWED_ROOTS = tuple(p.resolve() for p in _allowed_roots_seed)

def _resolve_safe_path(raw: str, *, must_exist: bool = True, allow_file: bool = True, allow_dir: bool = True) -> Path:
    value = (raw or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="Path is required")

    p = Path(value).expanduser()
    try:
        resolved = p.resolve(strict=must_exist)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Not found: {value}")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid path")

    if must_exist:
        if allow_file and resolved.is_file():
            pass
        elif allow_dir and resolved.is_dir():
            pass
        else:
            raise HTTPException(status_code=400, detail="Invalid path type")

    if not any(resolved == root or root in resolved.parents for root in _ALLOWED_ROOTS):
        raise HTTPException(status_code=403, detail="Path outside allowed roots")
    return resolved


def _preview_has_alpha(img: Image.Image) -> bool:
    return img.mode in {"RGBA", "LA"} or (img.mode == "P" and "transparency" in img.info)


def _preview_cache_key(src: Path, size: int) -> str:
    stat = src.stat()
    payload = "|".join([
        str(src.resolve()),
        str(stat.st_mtime_ns),
        str(stat.st_size),
        str(size),
        PREVIEW_CACHE_VERSION,
    ])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _preview_cache_path(cache_key: str, fmt: str) -> Path:
    ext = ".png" if fmt == "PNG" else ".jpg"
    return PREVIEW_CACHE_DIR / f"{cache_key}{ext}"


def _preview_cached_file(cache_key: str) -> Path | None:
    best_path: Path | None = None
    best_mtime = -1
    for ext in (".png", ".jpg"):
        file_path = PREVIEW_CACHE_DIR / f"{cache_key}{ext}"
        try:
            if not file_path.is_file():
                continue
            stat = file_path.stat()
            if stat.st_size <= 0:
                continue
            if stat.st_mtime_ns > best_mtime:
                best_mtime = stat.st_mtime_ns
                best_path = file_path
        except Exception:
            continue
    return best_path


def _write_preview_cache_atomically(target: Path, content: bytes) -> bool:
    tmp = target.with_name(f"{target.name}.{uuid.uuid4().hex}.tmp")
    try:
        with tmp.open("wb") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, target)
        return True
    except Exception:
        try:
            tmp.unlink(missing_ok=True)
        except Exception:
            pass
        return False


def _cleanup_preview_cache_if_due() -> None:
    global _preview_cache_last_cleanup
    now = time.time()
    if now - _preview_cache_last_cleanup < PREVIEW_CACHE_CLEANUP_INTERVAL_SECONDS:
        return
    if not _preview_cache_cleanup_lock.acquire(blocking=False):
        return
    try:
        now = time.time()
        if now - _preview_cache_last_cleanup < PREVIEW_CACHE_CLEANUP_INTERVAL_SECONDS:
            return
        cutoff = now - PREVIEW_CACHE_MAX_AGE_SECONDS
        try:
            PREVIEW_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        except Exception:
            return
        for file_path in PREVIEW_CACHE_DIR.glob("*"):
            try:
                if not file_path.is_file():
                    continue
                stat = file_path.stat()
                if stat.st_size <= 0 or stat.st_mtime < cutoff:
                    file_path.unlink(missing_ok=True)
            except Exception:
                continue
        _preview_cache_last_cleanup = now
    finally:
        _preview_cache_cleanup_lock.release()


def _app_cache_files() -> list[tuple[float, int, Path]]:
    files: list[tuple[float, int, Path]] = []
    for root in (PREVIEW_CACHE_DIR, TEMP_CACHE_DIR, THUMBNAIL_CACHE_DIR):
        try:
            if not root.exists():
                continue
            for file_path in root.rglob("*"):
                try:
                    if not file_path.is_file():
                        continue
                    stat = file_path.stat()
                    files.append((stat.st_mtime, stat.st_size, file_path))
                except Exception:
                    continue
        except Exception:
            continue
    return files


def _cleanup_app_cache() -> None:
    if not PACKAGED_MODE:
        return
    files = _app_cache_files()
    total = sum(size for _, size, _ in files)
    if total <= APP_CACHE_MAX_BYTES:
        return
    for _, size, file_path in sorted(files, key=lambda item: item[0]):
        if total <= APP_CACHE_TARGET_BYTES:
            break
        try:
            file_path.unlink(missing_ok=True)
            total -= size
        except Exception:
            continue

# ── Template helpers ──────────────────────────────────────────────────────────

CUSTOM_TEMPLATES_FILE = CONFIG_DIR / "templates_custom.json"
RESOURCE_TEMPLATES_FILE = BASE_DIR / "templates_custom.json"


def _load_templates_file(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _builtin_templates() -> dict:
    if RESOURCE_TEMPLATES_FILE.resolve() == CUSTOM_TEMPLATES_FILE.resolve():
        return {}
    return _load_templates_file(RESOURCE_TEMPLATES_FILE)

def _load_custom_templates() -> dict:
    return _load_templates_file(CUSTOM_TEMPLATES_FILE) or _builtin_templates()

def _seed_templates():
    """Write bundled templates to the writable config file if it is missing."""
    if not CUSTOM_TEMPLATES_FILE.exists():
        CUSTOM_TEMPLATES_FILE.parent.mkdir(parents=True, exist_ok=True)
        CUSTOM_TEMPLATES_FILE.write_text(
            json.dumps(_builtin_templates(), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return
    # File exists - backfill ref_image for any bundled template that lacks it.
    try:
        data = json.loads(CUSTOM_TEMPLATES_FILE.read_text(encoding="utf-8"))
        changed = False
        for name, tpl in _builtin_templates().items():
            if name in data and not data[name].get("ref_image") and tpl.get("ref_image"):
                data[name]["ref_image"] = tpl["ref_image"]
                changed = True
        if changed:
            CUSTOM_TEMPLATES_FILE.write_text(
                json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
            )
    except Exception:
        pass

_seed_templates()

# ── Request / response models ─────────────────────────────────────────────────

class PlacedItem(BaseModel):
    image_path: str
    canvas_x:   int
    canvas_y:   int
    scale:      float

class SaveRequest(BaseModel):
    items:       list[PlacedItem]
    src_root:    str
    queue_index: int
    is_combo:    bool       = False
    thumbnail:   bool       = True
    canvas_size: int | None = Field(default=None, ge=1, le=8192)
    output_dir:  str = ""

class SkipRequest(BaseModel):
    image_path: str
    src_root:   str = ""   # BUG-13 FIX: pass src_root so skip goes to the right output folder
    output_dir: str = ""

class SessionData(BaseModel):
    src_root:    str
    queue_index: int
    template:    str = ""
    output_dir:  str = ""
    input_dir:   str = ""
    source_stage: str = ""
    run_id:      str = ""
    timestamp:   int = 0
    completed:   bool = False

class PipelineConfig(BaseModel):
    folder_mode:    Literal["bulk", "clean"]
    do_upscale:     bool
    scale:          Literal["2", "4"]
    do_rembg:       bool
    input_dir:      str = ""
    output_dir:     str = ""
    exclude_rembg:  list[str] = Field(default_factory=list)
    skip_files:     list[str] = Field(default_factory=list)
    rembg_model:    str = ""
    bg_device_mode: Literal["cpu", "gpu", "gpu_auto"] = "cpu"
    resume:         bool = False
    upscale_max_px: int = 0
    reuse_exact_duplicates: bool = True

    @field_validator("upscale_max_px", mode="before")
    @classmethod
    def normalize_upscale_max_px(cls, value):
        if value in ("", None):
            return 0
        return value

class TemplatesPayload(BaseModel):
    templates: dict

class SettingsPayload(BaseModel):
    settings: dict

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="Image Pipeline API", version="1.2.0", lifespan=lifespan)

_LOCAL_ORIGINS = [
    "http://127.0.0.1",
    "http://localhost",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "null",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_LOCAL_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Pipeline state ────────────────────────────────────────────────────────────

_pipeline_running = False
_pipeline_proc: asyncio.subprocess.Process | None = None

def _terminate_process_tree_by_pid(pid: int | None) -> None:
    if not pid:
        return
    try:
        if platform.system() == "Windows":
            subprocess.call(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return
        import signal
        os.killpg(os.getpgid(pid), signal.SIGTERM)
    except ProcessLookupError:
        pass
    except Exception:
        pass

# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/config")
def get_config():
    return {
        "canvas_size": CANVAS_SIZE,
        "guides":      GUIDES,
        "templates":   _load_custom_templates(),
        "app_data_root": str(APP_DATA_ROOT) if PACKAGED_MODE else "",
        "default_output_dir": str(OUTPUT_ROOT),
    }


@app.get("/browse")
def browse_folder(initial: str = ""):
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.attributes("-topmost", True)
        root.focus_force()
        root.withdraw()
        folder = filedialog.askdirectory(
            title="Select folder",
            initialdir=initial.strip() or str(BASE_DIR),
            parent=root,
        )
        root.destroy()
        return {"path": folder or ""}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Folder dialog unavailable: {e}")


@app.get("/browse-file")
def browse_file(initial: str = "", filter: str = ""):
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.attributes("-topmost", True)
        root.focus_force()
        root.withdraw()
        filetypes = (
            [("Images", "*.png *.jpg *.jpeg *.webp *.tif *.tiff *.avif"), ("All files", "*.*")]
            if filter == "image" else [("All files", "*.*")]
        )
        path = filedialog.askopenfilename(
            title="Select reference image",
            initialdir=Path(initial).parent if initial and Path(initial).exists() else str(BASE_DIR),
            filetypes=filetypes,
            parent=root,
        )
        root.destroy()
        return {"path": path or ""}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"File dialog unavailable: {e}")


# ── Open folder in OS explorer ────────────────────────────────────────────────

@app.get("/open-folder")
def open_folder(path: str = ""):
    """
    Open a folder in the native OS file explorer.
    If path is empty or missing, opens OUTPUT_ROOT.
    Uses os.startfile on Windows (most reliable), open/xdg-open elsewhere.
    """
    p = _resolve_safe_path(path, must_exist=True, allow_file=False, allow_dir=True) if path.strip() else OUTPUT_ROOT.resolve()
    if not p.exists():
        p.mkdir(parents=True, exist_ok=True)
    if platform.system() == "Windows":
        # os.startfile is the correct way to open a folder in Explorer
        os.startfile(str(p))
    elif platform.system() == "Darwin":
        subprocess.Popen(["open", str(p)])
    else:
        subprocess.Popen(["xdg-open", str(p)])
    return {"ok": True, "path": str(p)}


# ── Templates ─────────────────────────────────────────────────────────────────

@app.get("/templates/list")
def list_templates():
    return {"templates": _load_custom_templates()}


@app.get("/templates/image")
def serve_template_image(name: str = Query(...)):
    """Serve a reference image from the templates/ folder by filename."""
    # Security: allow only a bare filename, no path traversal
    fname = Path(name).name
    p = TEMPLATES_DIR / fname
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"Template image not found: {fname}")
    return FileResponse(str(p))


@app.post("/templates/save")
def save_templates(payload: TemplatesPayload):
    CUSTOM_TEMPLATES_FILE.write_text(
        json.dumps(payload.templates, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return {"ok": True, "count": len(payload.templates)}


# ── Source / images ───────────────────────────────────────────────────────────

@app.get("/source")
def get_source(output_dir: str = ""):
    custom_output = bool(output_dir.strip())
    base = (
        _resolve_safe_path(output_dir, must_exist=False, allow_file=False, allow_dir=True)
        if custom_output else OUTPUT_ROOT
    )
    folder, label, stage = detect_source_folder(base, allow_input_fallback=not custom_output)
    if folder is None:
        return {
            "folder": "",
            "label": label,
            "count": 0,
            "found": False,
            "source_stage": "none",
            "reason": "no_output_for_custom",
            "output_dir": str(base),
        }
    images, _ = images_in_folder(folder)
    return {
        "folder": str(folder),
        "label": label,
        "count": len(images),
        "found": True,
        "source_stage": stage,
        "reason": "",
        "output_dir": str(base),
    }


@app.get("/images")
def list_images(
    folder: str = Query(...),
    recursive: bool = Query(True),
    limit: int = Query(0, ge=0, le=5000),
):
    path = _resolve_safe_path(folder, must_exist=True, allow_file=False, allow_dir=True)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Folder not found: {folder}")
    images, truncated = images_in_folder(path, recursive=recursive, limit=limit)
    return {
        "folder": str(path),
        "images": [str(p) for p in images],
        "count": len(images),
        "truncated": truncated,
        "recursive": recursive,
        "limit": limit,
    }


@app.get("/image")
def serve_image(path: str = Query(...)):
    p = _resolve_safe_path(path, must_exist=True, allow_file=True, allow_dir=False)
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"Not found: {path}")
    if p.suffix.lower() not in SUPPORTED_EXTS:
        raise HTTPException(status_code=400, detail="Unsupported file type")
    if p.suffix.lower() == ".avif":
        _open_image_checked(p)
    payload = _read_image_snapshot(p, missing_detail=f"Not found: {path}")
    return Response(content=payload, media_type=_media_type_for_image(p))


@app.get("/preview")
def serve_preview(path: str = Query(...), size: int = Query(default=800)):
    """Serve a downscaled preview image — much faster than loading full-res for sidebar display.
    size: max dimension in pixels (default 800). Original returned if already smaller."""
    p = _resolve_safe_path(path, must_exist=True, allow_file=True, allow_dir=False)
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"Missing file: {path}")
    if p.suffix.lower() not in SUPPORTED_EXTS:
        raise HTTPException(status_code=400, detail="Unsupported file type for preview")

    size = max(64, min(1600, size))
    try:
        cache_key = _preview_cache_key(p, size)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=f"Missing file: {path}") from e
    except OSError as e:
        raise HTTPException(status_code=400, detail=f"Preview source read failed: {e}") from e
    _cleanup_preview_cache_if_due()
    cached = _preview_cached_file(cache_key)
    if cached is not None:
        media_type = "image/png" if cached.suffix.lower() == ".png" else "image/jpeg"
        try:
            payload = cached.read_bytes()
            return Response(
                content=payload,
                media_type=media_type,
                headers={"Cache-Control": "public, max-age=60"},
            )
        except OSError:
            pass

    img: Image.Image | None = None
    fmt = "unknown"
    try:
        img = _open_image_checked(p)
        # Downscale preserving aspect ratio (no-op if already within bounds)
        if max(img.width, img.height) > size:
            img.thumbnail((size, size), Image.LANCZOS)

        buf = io.BytesIO()
        has_alpha = _preview_has_alpha(img)
        fmt = "PNG" if has_alpha else "JPEG"

        # Always return browser-safe raster format for previews.
        if fmt == "PNG":
            if img.mode not in {"RGBA", "RGB", "L"}:
                img = img.convert("RGBA")
        elif img.mode not in {"RGB", "L"}:
            img = img.convert("RGB")

        quality_kwargs = {} if fmt == "PNG" else {"quality": 85, "optimize": True}
        img.save(buf, format=fmt, **quality_kwargs)
        payload = buf.getvalue()

        cache_target = _preview_cache_path(cache_key, fmt)
        try:
            PREVIEW_CACHE_DIR.mkdir(parents=True, exist_ok=True)
            _write_preview_cache_atomically(cache_target, payload)
        except Exception:
            pass

        mime = "image/png" if fmt == "PNG" else "image/jpeg"
        return Response(content=payload, media_type=mime, headers={"Cache-Control": "public, max-age=60"})
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError) as e:
        raise HTTPException(status_code=400, detail=f"Preview decode failed: {e}") from e
    except Exception as e:
        detail = f"Preview generation failed (mode={getattr(img, 'mode', 'unknown')}, fmt={fmt}): {e}"
        raise HTTPException(status_code=500, detail=detail)


# ── Save composition ──────────────────────────────────────────────────────────

@app.post("/save")
def save_composition(req: SaveRequest):
    if not req.items:
        raise HTTPException(status_code=400, detail="No items to save")

    # canvas_size: request > settings.json > config.ini constant
    cs = req.canvas_size if req.canvas_size and req.canvas_size > 0 else None
    if cs is None:
        try:
            if SETTINGS_FILE.exists():
                _s = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
                cs = _s.get("output", {}).get("canvas_size") or None
        except Exception:
            pass
    cs = int(cs) if cs else CANVAS_SIZE
    source_used = "request" if req.canvas_size else ("settings" if cs != CANVAS_SIZE else "config")
    print(f"__save_canvas_size__:{cs}:{source_used}", flush=True)

    # thumbnail_size: settings.json > 400
    thumb_size = 400
    try:
        if SETTINGS_FILE.exists():
            _s = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            thumb_size = int(_s.get("output", {}).get("thumbnail_size") or 400)
    except Exception:
        pass
    canvas = Image.new("RGBA", (cs, cs), (0, 0, 0, 0))

    for item in req.items:
        p = Path(item.image_path)
        if not p.exists():
            raise HTTPException(status_code=404, detail=f"Source image not found: {item.image_path}")
        img = _open_image_checked(p).convert("RGBA")
        w   = max(1, int(img.width  * item.scale))
        h   = max(1, int(img.height * item.scale))
        resized = img.resize((w, h), Image.LANCZOS)
        x = item.canvas_x - w // 2
        y = item.canvas_y - h // 2
        canvas.paste(resized, (x, y), resized)

    ref_path = Path(req.items[0].image_path)
    src_root = Path(req.src_root) if req.src_root.strip() else None
    if req.output_dir.strip():
        output_base = _resolve_safe_path(req.output_dir, must_exist=False, allow_file=False, allow_dir=True)
    elif src_root:
        output_base = _output_base_from_src_root(src_root)
    else:
        output_base = OUTPUT_ROOT

    if src_root:
        save_path = mirror_save_path(ref_path, src_root, output_base=output_base, stage="final").with_suffix(".png")
    else:
        save_path = (output_base / "Editor" / _hashed_rel_fallback(ref_path)).with_suffix(".png")
    if req.is_combo:
        save_path = save_path.with_name(save_path.stem + "_combo.png")

    save_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(save_path)

    # Thumbnail: fire-and-forget on thread pool.
    thumb_path = None
    if req.thumbnail:
        thumb_file = mirror_thumbnail_path(save_path, output_base, thumb_size)
        thumb_file.parent.mkdir(parents=True, exist_ok=True)
        thumb_path = str(thumb_file)

        _canvas_snap = canvas.copy()
        _cs          = cs
        _tf          = thumb_file
        _ts          = thumb_size

        def _write_thumb(snap, size, dst, ts):
            try:
                white = Image.new("RGBA", (size, size), (255, 255, 255, 255))
                white.paste(snap, mask=snap.split()[3])
                white.convert("RGB").resize((ts, ts), Image.LANCZOS).save(dst, quality=95)
            except Exception:
                pass

        _thumb_executor.submit(_write_thumb, _canvas_snap, _cs, _tf, _ts)

    return {"saved": str(save_path), "thumb": thumb_path}


# ── Skip ──────────────────────────────────────────────────────────────────────

@app.post("/skip")
def skip_image(req: SkipRequest):
    src = Path(req.image_path)
    if not src.exists():
        raise HTTPException(status_code=404, detail=f"Not found: {req.image_path}")
    src_root = Path(req.src_root) if req.src_root.strip() else None
    # BUG-13 FIX: derive skip destination from src_root when provided,
    # so custom output dirs land in the right place.
    if req.output_dir.strip():
        output_base = _resolve_safe_path(req.output_dir, must_exist=False, allow_file=False, allow_dir=True)
    elif src_root:
        output_base = _output_base_from_src_root(src_root)
    else:
        output_base = OUTPUT_ROOT

    if src_root:
        dst = mirror_skip_path(src, src_root, output_base=output_base)
    else:
        dst = output_base / "Editor" / "skipped" / _hashed_rel_fallback(src)

    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return {"skipped": str(dst)}


# ── Session ───────────────────────────────────────────────────────────────────

@app.get("/session")
def get_session():
    if not SESSION_FILE.exists():
        return {"exists": False}
    try:
        raw_data = json.loads(SESSION_FILE.read_text(encoding="utf-8"))
        if not isinstance(raw_data, dict):
            return {"exists": False}
        data = SessionData.model_validate(raw_data).model_dump()
        src_root = Path(data["src_root"])
        if not src_root.exists():
            return {"exists": False}
        images, _ = images_in_folder(src_root)
        idx    = int(data.get("queue_index", 0))
        if idx >= len(images):
            return {"exists": False}
        if not data.get("timestamp"):
            data["timestamp"] = int(time.time())
        return {"exists": True, **data, "total": len(images)}
    except Exception:
        return {"exists": False}


@app.post("/session")
def save_session(data: SessionData):
    payload = data.model_dump()
    if not payload.get("timestamp"):
        payload["timestamp"] = int(time.time())
    if not payload.get("run_id"):
        payload["run_id"] = f"session-{uuid.uuid4().hex[:10]}"
    SESSION_FILE.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return {"ok": True}


@app.delete("/session")
def clear_session():
    SESSION_FILE.unlink(missing_ok=True)
    return {"ok": True}


# ── Settings ──────────────────────────────────────────────────────────────────

_DEFAULT_SETTINGS = {
    "processing":   {"crop_padding": 0.04, "edge_blur": 1.2,
                                          "rembg_model": "birefnet-general", "rembg_fallback": "auto",
                     "bg_device_mode": "cpu", "history_keep": 30, "force_cpu": True, "wipe_input_after_run": False,
                     "reuse_exact_duplicates": True, "upscale_max_px": 3600},
    "upscaler_api": {"provider": "local", "url": "", "key": "", "model": ""},
    "rembg_api":    {"provider": "local", "url": "", "key": ""},
    "output":       {"canvas_size": 1440, "thumbnail": True,
                     "thumbnail_size": 400, "folder_mode": "bulk", "input_dir": "", "output_dir": "",
                     "recent_input_dirs": [], "recent_output_dirs": [],
                     "do_upscale": True, "do_rembg": True, "upscale_scale": "2"},
    "appearance":   {"guide_opacity": 1.0, "ref_img_opacity": 0.05, "canvas_bg_color": "#f5f5f1", "theme": "light"},
    "guides":       {"use_custom": False, "custom": {}},
}

_REMBG_MODELS = [
    "birefnet-general",
    "birefnet-general-lite",
    "birefnet-massive",
    "birefnet-dis",
    "birefnet-hrsod",
    "bria-rmbg",
]

def _deep_merge(base: Any, incoming: Any) -> Any:
    if isinstance(base, dict) and isinstance(incoming, dict):
        merged = dict(base)
        for key, value in incoming.items():
            merged[key] = _deep_merge(merged.get(key), value)
        return merged
    return incoming

def _load_saved_settings_file() -> dict:
    if not SETTINGS_FILE.exists():
        return {}
    try:
        data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {}
        processing = data.get("processing")
        if isinstance(processing, dict):
            if "rembg_fallback" in processing:
                processing["rembg_fallback"] = _normalize_rembg_fallback(processing.get("rembg_fallback"))
            processing["bg_device_mode"] = _normalize_bg_device_mode(processing.get("bg_device_mode"), processing)
        return data
    except Exception:
        return {}

def _merged_settings(*layers: dict) -> dict:
    merged = copy.deepcopy(_DEFAULT_SETTINGS)
    for layer in layers:
        if isinstance(layer, dict):
            merged = _deep_merge(merged, layer)
    processing = merged.get("processing")
    if isinstance(processing, dict):
        processing["bg_device_mode"] = _normalize_bg_device_mode(processing.get("bg_device_mode"), processing)
        processing["force_cpu"] = processing["bg_device_mode"] == "cpu"
    return merged

@app.get("/settings")
def get_settings():
    return {"settings": _merged_settings(_load_saved_settings_file())}

@app.post("/settings")
def save_settings(payload: SettingsPayload):
    try:
        existing = _load_saved_settings_file()
        incoming = payload.settings if isinstance(payload.settings, dict) else {}
        merged = _merged_settings(existing, incoming)
        processing = merged.get("processing")
        if isinstance(processing, dict):
            if "rembg_fallback" in processing:
                processing["rembg_fallback"] = _normalize_rembg_fallback(processing.get("rembg_fallback"))
            processing["bg_device_mode"] = _normalize_bg_device_mode(processing.get("bg_device_mode"), processing)
            processing["force_cpu"] = processing["bg_device_mode"] == "cpu"
        SETTINGS_FILE.write_text(
            json.dumps(merged, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save settings: {e}")

@app.get("/models/rembg")
def list_rembg_models():
    return {"models": _REMBG_MODELS}


@app.get("/history-path")
def get_history_path():
    return {"path": str(HISTORY_DIR)}


# ── Pipeline ──────────────────────────────────────────────────────────────────

@app.get("/pipeline/status")
def pipeline_status():
    registered = _registered_avif_decoder()
    return {
        "running": _pipeline_running,
        "avif_decode_supported": bool(registered),
        "pillow_registered_avif": bool(registered),
        "pillow_avif_imported": _PILLOW_AVIF_IMPORTED,
        "pillow_avif_import_error": _PILLOW_AVIF_IMPORT_ERROR if not _PILLOW_AVIF_IMPORTED else "",
    }


def _pipeline_command() -> list[str]:
    if getattr(sys, "frozen", False):
        return [sys.executable, "--pipeline"]
    return [sys.executable, "-u", str(BASE_DIR / "pipeline.py")]


def _pipeline_env() -> dict:
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    env["CUTOUT_STUDIO_RESOURCE_DIR"] = str(BASE_DIR)
    env["CUTOUT_STUDIO_DEFAULT_OUTPUT_DIR"] = str(OUTPUT_ROOT)
    if PACKAGED_MODE and APP_DATA_ROOT is not None and MODELS_DIR is not None:
        env["CUTOUT_STUDIO_PACKAGED"] = "1"
        env["CUTOUT_STUDIO_USER_DATA"] = str(APP_DATA_ROOT)
        env.setdefault("HF_HOME", str(MODELS_DIR / "huggingface"))
        env.setdefault("HUGGINGFACE_HUB_CACHE", str(MODELS_DIR / "huggingface" / "hub"))
        env.setdefault("XDG_CACHE_HOME", str(MODELS_DIR))
        env.setdefault("U2NET_HOME", str(MODELS_DIR / "rembg"))
        env.setdefault("REMBG_HOME", str(MODELS_DIR / "rembg"))
        env.setdefault("ONNXRUNTIME_HOME", str(MODELS_DIR / "onnx"))
    return env


@app.post("/pipeline/run")
async def run_pipeline(cfg: PipelineConfig):
    global _pipeline_running
    if _pipeline_running:
        raise HTTPException(status_code=409, detail="Pipeline already running")

    selection_manifest_path: Path | None = None
    cmd = [
        *_pipeline_command(),
        "--non-interactive",
        "--folder-mode", cfg.folder_mode,
        "--scale",       cfg.scale,
    ]
    if not cfg.do_upscale:  cmd.append("--no-upscale")
    if not cfg.do_rembg:    cmd.append("--no-rembg")
    if cfg.input_dir.strip():   cmd += ["--input-dir",  cfg.input_dir.strip()]
    if cfg.output_dir.strip():
        cmd += ["--output-dir", cfg.output_dir.strip()]
    selection_payload = {
        "exclude_rembg": [f.strip() for f in cfg.exclude_rembg if f.strip()],
        "skip_files": [f.strip() for f in cfg.skip_files if f.strip()],
    }
    if selection_payload["exclude_rembg"] or selection_payload["skip_files"]:
        manifest_dir = TEMP_CACHE_DIR / "selection-manifests"
        manifest_dir.mkdir(parents=True, exist_ok=True)
        selection_manifest_path = manifest_dir / f"selection-{uuid.uuid4().hex}.json"
        selection_manifest_path.write_text(
            json.dumps(selection_payload, ensure_ascii=False),
            encoding="utf-8",
        )
        cmd += ["--selection-manifest", str(selection_manifest_path)]
    requested_upscale_max_px = cfg.upscale_max_px
    if not cfg.reuse_exact_duplicates:
        cmd.append("--no-reuse-exact-duplicates")
    if cfg.resume:
        cmd.append("--resume")

    # Read processing settings from settings.json
    try:
        _s = json.loads(SETTINGS_FILE.read_text(encoding="utf-8")) if SETTINGS_FILE.exists() else {}
        rembg_model = (cfg.rembg_model or "").strip() or _s.get("processing", {}).get("rembg_model", "birefnet-general")
        if rembg_model:
            cmd += ["--rembg-model", rembg_model]
        rembg_fallback = _normalize_rembg_fallback(_s.get("processing", {}).get("rembg_fallback", "auto"))
        if rembg_fallback:
            cmd += ["--rembg-fallback", str(rembg_fallback)]
        processing_settings = _s.get("processing", {}) if isinstance(_s.get("processing"), dict) else {}
        bg_device_mode = _normalize_bg_device_mode(cfg.bg_device_mode, processing_settings)
        cmd += ["--bg-device-mode", bg_device_mode]
        if requested_upscale_max_px <= 0:
            try:
                requested_upscale_max_px = int(_s.get("processing", {}).get("upscale_max_px") or 0)
            except Exception:
                requested_upscale_max_px = 0
        if _s.get("processing", {}).get("wipe_input_after_run", False):
            cmd.append("--wipe-input-after-run")
        if bg_device_mode == "cpu":
            cmd.append("--force-cpu")
    except Exception:
        cmd += ["--bg-device-mode", _normalize_bg_device_mode(cfg.bg_device_mode)]
        if cfg.bg_device_mode == "cpu":
            cmd.append("--force-cpu")
        pass
    if requested_upscale_max_px <= 0:
        requested_upscale_max_px = DEFAULT_UPSCALE_MAX_PX
    cmd += ["--upscale-max-px", str(requested_upscale_max_px)]

    pipeline_output_root = (
        Path(cfg.output_dir.strip())
        if cfg.output_dir.strip()
        else OUTPUT_ROOT
    )

    session_src_root = (
        pipeline_output_root / "processed"
        if cfg.do_rembg
        else (
            pipeline_output_root / "upscaled"
            if cfg.do_upscale
            else (
                Path(cfg.input_dir.strip())
                if cfg.input_dir.strip()
                else (BASE_DIR / "input")
            )
        )
    )
    session_output_dir = cfg.output_dir.strip()
    session_input_dir = cfg.input_dir.strip() or str(BASE_DIR / "input")
    session_source_stage = (
        "processed" if cfg.do_rembg else ("upscaled" if cfg.do_upscale else "input")
    )
    session_run_id = f"pipeline-{uuid.uuid4().hex[:10]}"
    session_timestamp = int(time.time())

    async def event_stream():
        global _pipeline_running, _pipeline_proc
        proc: asyncio.subprocess.Process | None = None
        _pipeline_running = True
        progress_index = 0
        done_prefixes = (
            ("__ok_rembg__:", "__skip_rembg__:", "__err_rembg__:")
            if cfg.do_rembg
            else ("__ok_upscale__:", "__skip_upscale__:", "__err_upscale__:")
        )

        # Session checkpoint writer shared by initial save + per-image progress.
        # `template` is editor-owned; pipeline always writes it as empty.
        def _write_pipeline_session(index: int, *, completed: bool = False):
            payload = SessionData(
                src_root=str(session_src_root),
                queue_index=index,
                template="",
                output_dir=session_output_dir,
                input_dir=session_input_dir,
                source_stage=session_source_stage,
                run_id=session_run_id,
                timestamp=session_timestamp,
                completed=completed,
            ).model_dump()
            SESSION_FILE.write_text(
                json.dumps(payload, ensure_ascii=False),
                encoding="utf-8",
            )

        def _update_session_progress(line: str):
            nonlocal progress_index
            if not any(prefix in line for prefix in done_prefixes):
                return
            progress_index += 1
            try:
                _write_pipeline_session(progress_index)
            except Exception:
                pass

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=str(BASE_DIR),
                env=_pipeline_env(),
            )
            _pipeline_proc = proc
            try:
                _write_pipeline_session(0)
            except Exception:
                pass

            pending = b""
            while True:
                chunk = await proc.stdout.read(4096)
                if not chunk:
                    break
                pending += chunk
                lines = pending.split(b"\n")
                pending = lines.pop() if lines else b""
                for raw_line in lines:
                    for line in _clean(raw_line):
                        _update_session_progress(line)
                        yield {"data": line}

            if pending:
                for line in _clean(pending):
                    _update_session_progress(line)
                    yield {"data": line}

            await proc.wait()
            if proc.returncode == 0:
                _write_pipeline_session(0, completed=True)
            yield {"data": f"__done__ exit={proc.returncode}"}
        except Exception as e:
            yield {"data": f"__error__ {e}"}
        finally:
            if proc and proc.returncode is None:
                try:
                    _terminate_process_tree_by_pid(proc.pid)
                    await asyncio.wait_for(proc.wait(), timeout=2)
                except Exception:
                    pass
            _pipeline_running = False
            _pipeline_proc = None
            if selection_manifest_path:
                try:
                    selection_manifest_path.unlink(missing_ok=True)
                except Exception:
                    pass
            _cleanup_app_cache()

    return EventSourceResponse(event_stream())


@app.post("/pipeline/stop")
async def stop_pipeline():
    global _pipeline_proc, _pipeline_running

    proc = _pipeline_proc
    pid = proc.pid if proc else None
    _terminate_process_tree_by_pid(pid)
    if proc and proc.returncode is None:
        try:
            await asyncio.wait_for(proc.wait(), timeout=2)
        except Exception:
            pass

    _pipeline_proc    = None
    _pipeline_running = False
    return {"ok": True}


# ── Entry ─────────────────────────────────────────────────────────────────────

def _run_embedded_pipeline() -> None:
    from pipeline import main as pipeline_main
    sys.argv = [str(BASE_DIR / "pipeline.py"), *sys.argv[2:]]
    pipeline_main()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--pipeline":
        _run_embedded_pipeline()
    else:
        import uvicorn
        uvicorn.run(app, host="127.0.0.1", port=7421, log_level="warning")
