# =============================================================
# IMAGE PIPELINE — Local API Server
# Version : v1.2
# Copyright (c) 2026 Liudas. Licensed under AGPL-3.0. See LICENSE.
# =============================================================

import asyncio
import json
import os
import platform
import re
import shutil
import string
import subprocess
import sys
import configparser
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator
from PIL import Image
from sse_starlette.sse import EventSourceResponse
from contextlib import asynccontextmanager
import threading
from concurrent.futures import ThreadPoolExecutor

# Thumbnail writes are CPU+disk bound — run them on a thread pool so they
# never block the save response. The editor advances immediately; thumb
# writes finish in the background a few hundred ms later.
_thumb_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="thumb")

# ── Model warm-up ─────────────────────────────────────────────────────────────
# Runs once in a background thread when api.py starts.
# Ensures model weights are downloaded + in OS file cache before the first
# pipeline run, eliminating the 5-15s "first run stall".

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
    t = threading.Thread(target=_warmup_worker, daemon=True, name="model-warmup")
    t.start()
    yield

# ── Config ────────────────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).parent

_cfg = configparser.ConfigParser()
_cfg.read(BASE_DIR / "config.ini")

CANVAS_SIZE   = _cfg.getint("canvas", "canvas_size",  fallback=1440)
OUTPUT_ROOT   = BASE_DIR / _cfg.get("paths", "output_root",   fallback="output")
TEMPLATES_DIR = BASE_DIR / _cfg.get("paths", "templates_dir", fallback="templates")
SESSION_FILE  = BASE_DIR / "session.json"
SETTINGS_FILE = BASE_DIR / "settings.json"

SUPPORTED_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".tiff"}

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
_CTRL_RE = re.compile(r'[\r\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')

def _clean(raw: bytes) -> list[str]:
    text = raw.decode("utf-8", errors="replace")
    text = _ANSI_RE.sub("", text)
    text = _CTRL_RE.sub("", text)
    return [ln.strip() for ln in text.splitlines() if ln.strip()]

# ── Helpers ───────────────────────────────────────────────────────────────────

def images_in_folder(folder: Path) -> list[Path]:
    return sorted(
        p for p in folder.rglob("*")
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS
    )

def detect_source_folder(output_root: Path | None = None) -> tuple[Path, str]:
    root = output_root or OUTPUT_ROOT
    for folder, label in [
        (root     / "processed", f"{root.name}/processed"),
        (root     / "upscaled",  f"{root.name}/upscaled"),
        (BASE_DIR / "input",     "input"),
    ]:
        if folder.exists() and any(
            p.suffix.lower() in SUPPORTED_EXTS
            for p in folder.rglob("*") if p.is_file()
        ):
            return folder, label
    return BASE_DIR / "input", "input"

# BUG-13 FIX: derive output base from src_root instead of using hardcoded OUTPUT_ROOT.
# If src_root ends with a known pipeline output stage name (processed/upscaled/bg_removed),
# go up one level to get the actual output folder. This means a custom output dir set by
# the user (e.g. D:/project/output/processed) correctly resolves to D:/project/output/editor.
# Default case (src_root = ./output/processed) is unchanged: parent = ./output = OUTPUT_ROOT.
def _output_base_from_src_root(src_root: Path) -> Path:
    if src_root.name in ("processed", "upscaled", "bg_removed"):
        return src_root.parent
    return OUTPUT_ROOT

def mirror_save_path(src: Path, src_root: Path) -> Path:
    try:
        rel = src.relative_to(src_root)
    except ValueError:
        rel = Path(src.name)
    return _output_base_from_src_root(src_root) / "Editor" / "final" / rel

# Allow any path on any local drive — this is a local-only app with no remote access.
# On Windows: add every mounted drive root (C:\, D:\, ...).
# On all platforms: also allow the user's home directory.
_drive_roots: set[Path] = set()
if platform.system() == "Windows":
    _drive_roots = {Path(f"{d}:\\") for d in string.ascii_uppercase if Path(f"{d}:\\").exists()}
_drive_roots.add(Path.home())

_ALLOWED_ROOTS = tuple(p.resolve() for p in (
    {BASE_DIR, OUTPUT_ROOT, TEMPLATES_DIR, BASE_DIR / "input"} | _drive_roots
))

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

# ── Template helpers ──────────────────────────────────────────────────────────

CUSTOM_TEMPLATES_FILE = BASE_DIR / "templates_custom.json"

def _load_custom_templates() -> dict:
    if CUSTOM_TEMPLATES_FILE.exists():
        try:
            return json.loads(CUSTOM_TEMPLATES_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return dict(BUILTIN_TEMPLATES)

def _seed_templates():
    """Write builtin templates if file missing. If file exists, backfill any missing ref_image fields."""
    if not CUSTOM_TEMPLATES_FILE.exists():
        CUSTOM_TEMPLATES_FILE.write_text(
            json.dumps(BUILTIN_TEMPLATES, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return
    # File exists — backfill ref_image for any builtin template that lacks it
    try:
        data = json.loads(CUSTOM_TEMPLATES_FILE.read_text(encoding="utf-8"))
        changed = False
        for name, tpl in BUILTIN_TEMPLATES.items():
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
    template:    str

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
    resume:         bool = False
    upscale_max_px: int = 0

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

# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/config")
def get_config():
    return {
        "canvas_size": CANVAS_SIZE,
        "guides":      GUIDES,
        "templates":   _load_custom_templates(),
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
            [("Images", "*.png *.jpg *.jpeg *.webp *.tiff"), ("All files", "*.*")]
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
    base = _resolve_safe_path(output_dir, must_exist=True, allow_file=False, allow_dir=True) if output_dir.strip() else OUTPUT_ROOT
    folder, label = detect_source_folder(base)
    images = images_in_folder(folder)
    return {"folder": str(folder), "label": label, "count": len(images)}


@app.get("/images")
def list_images(folder: str = Query(...)):
    path = _resolve_safe_path(folder, must_exist=True, allow_file=False, allow_dir=True)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Folder not found: {folder}")
    images = images_in_folder(path)
    return {"folder": str(path), "images": [str(p) for p in images], "count": len(images)}


@app.get("/image")
def serve_image(path: str = Query(...)):
    p = _resolve_safe_path(path, must_exist=True, allow_file=True, allow_dir=False)
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"Not found: {path}")
    if p.suffix.lower() not in SUPPORTED_EXTS:
        raise HTTPException(status_code=400, detail="Unsupported file type")
    return FileResponse(str(p))


@app.get("/preview")
def serve_preview(path: str = Query(...), size: int = Query(default=800)):
    """Serve a downscaled preview image — much faster than loading full-res for sidebar display.
    size: max dimension in pixels (default 800). Original returned if already smaller."""
    p = _resolve_safe_path(path, must_exist=True, allow_file=True, allow_dir=False)
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"Not found: {path}")
    if p.suffix.lower() not in SUPPORTED_EXTS:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    size = max(64, min(1600, size))

    try:
        with Image.open(p) as opened:
            img = opened.copy()
        # If image is already small enough, serve directly
        if max(img.width, img.height) <= size:
            return FileResponse(str(p))

        # Downscale preserving aspect ratio
        img.thumbnail((size, size), Image.LANCZOS)

        import io
        buf = io.BytesIO()
        fmt = "PNG" if p.suffix.lower() == ".png" else "JPEG"
        
        # JPEG cannot encode alpha or many palette/extended modes.
        if fmt == "JPEG" and img.mode not in {"RGB", "L"}:
            has_alpha = (
                img.mode in {"RGBA", "LA"}
                or (img.mode == "P" and "transparency" in img.info)
            )
            if has_alpha:
                alpha_img = img.convert("RGBA")
                flat = Image.new("RGBA", alpha_img.size, (255, 255, 255, 255))
                flat.alpha_composite(alpha_img)
                img = flat.convert("RGB")
            else:
                img = img.convert("RGB")

        quality_kwargs = {} if fmt == "PNG" else {"quality": 85, "optimize": True}
        img.save(buf, format=fmt, **quality_kwargs)
        buf.seek(0)

        from fastapi.responses import Response
        mime = "image/png" if fmt == "PNG" else "image/jpeg"
        return Response(content=buf.getvalue(), media_type=mime,
                        headers={"Cache-Control": "public, max-age=60"})
    except Exception as e:
        detail = f"Preview generation failed (mode={getattr(img, 'mode', 'unknown')}, fmt={locals().get('fmt', 'unknown')}): {e}"
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
        with Image.open(p) as opened:
            img = opened.convert("RGBA")
        w   = max(1, int(img.width  * item.scale))
        h   = max(1, int(img.height * item.scale))
        resized = img.resize((w, h), Image.LANCZOS)
        x = item.canvas_x - w // 2
        y = item.canvas_y - h // 2
        canvas.paste(resized, (x, y), resized)

    ref_path  = Path(req.items[0].image_path)
    src_root  = Path(req.src_root)
    if req.output_dir.strip():
        output_base = _resolve_safe_path(req.output_dir, must_exist=False, allow_file=False, allow_dir=True)
        try:
            rel = ref_path.relative_to(src_root)
        except ValueError:
            rel = Path(ref_path.name)
        save_path = (output_base / "Editor" / "final" / rel).with_suffix(".png")
    else:
        save_path = mirror_save_path(ref_path, src_root).with_suffix(".png")    
    if req.is_combo:
        save_path = save_path.with_name(save_path.stem + "_combo.png")

    save_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(save_path)

    # Thumbnail: fire-and-forget on thread pool.
    thumb_path = None
    if req.thumbnail:
        thumb_dir  = save_path.parent / str(thumb_size)
        thumb_dir.mkdir(parents=True, exist_ok=True)
        thumb_file = thumb_dir / save_path.name
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
    # BUG-13 FIX: derive skip destination from src_root when provided,
    # so custom output dirs land in the right place.
    if req.output_dir.strip():
        output_base = _resolve_safe_path(req.output_dir, must_exist=False, allow_file=False, allow_dir=True)
    elif req.src_root:
        output_base = _output_base_from_src_root(Path(req.src_root))
    else:
        output_base = OUTPUT_ROOT
    rel = Path(src.name)
    if req.src_root:
        try:
            rel = src.relative_to(Path(req.src_root))
        except ValueError:
            rel = Path(src.name)
    dst = output_base / "Editor" / "skipped" / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return {"skipped": str(dst)}


# ── Session ───────────────────────────────────────────────────────────────────

@app.get("/session")
def get_session():
    if not SESSION_FILE.exists():
        return {"exists": False}
    try:
        data     = json.loads(SESSION_FILE.read_text())
        src_root = Path(data["src_root"])
        if not src_root.exists():
            return {"exists": False}
        images = images_in_folder(src_root)
        idx    = int(data.get("queue_index", 0))
        if idx >= len(images):
            return {"exists": False}
        return {"exists": True, **data, "total": len(images)}
    except Exception:
        return {"exists": False}


@app.post("/session")
def save_session(data: SessionData):
    SESSION_FILE.write_text(json.dumps(data.model_dump()))
    return {"ok": True}


@app.delete("/session")
def clear_session():
    SESSION_FILE.unlink(missing_ok=True)
    return {"ok": True}


# ── Settings ──────────────────────────────────────────────────────────────────

_DEFAULT_SETTINGS = {
    "processing":   {"crop_padding": 0.04, "edge_blur": 1.2,
                                          "rembg_model": "birefnet-general", "rembg_fallback": "auto",
                     "history_keep": 30, "force_cpu": False, "wipe_input_after_run": False,
                     "upscale_max_px": 0},
    "upscaler_api": {"provider": "local", "url": "", "key": "", "model": ""},
    "rembg_api":    {"provider": "local", "url": "", "key": ""},
    "output":       {"canvas_size": 1440, "thumbnail": True,
                     "thumbnail_size": 400, "folder_mode": "bulk", "input_dir": "", "output_dir": "",
                     "do_upscale": True, "upscale_scale": "2"},
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

@app.get("/settings")
def get_settings():
    if SETTINGS_FILE.exists():
        try:
            data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            # Merge with defaults so new keys are always present
            merged = {**_DEFAULT_SETTINGS}
            for section, vals in data.items():
                merged[section] = {**_DEFAULT_SETTINGS.get(section, {}), **vals}
            return {"settings": merged}
        except Exception:
            pass
    return {"settings": _DEFAULT_SETTINGS}

@app.post("/settings")
def save_settings(payload: SettingsPayload):
    try:
        SETTINGS_FILE.write_text(
            json.dumps(payload.settings, indent=2, ensure_ascii=False),
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
    return {"path": str(BASE_DIR / "history")}


# ── Pipeline ──────────────────────────────────────────────────────────────────

@app.get("/pipeline/status")
def pipeline_status():
    return {"running": _pipeline_running}


@app.post("/pipeline/run")
async def run_pipeline(cfg: PipelineConfig):
    global _pipeline_running
    if _pipeline_running:
        raise HTTPException(status_code=409, detail="Pipeline already running")

    cmd = [
        sys.executable, str(BASE_DIR / "pipeline.py"),
        "--non-interactive",
        "--folder-mode", cfg.folder_mode,
        "--scale",       cfg.scale,
    ]
    if not cfg.do_upscale:  cmd.append("--no-upscale")
    if not cfg.do_rembg:    cmd.append("--no-rembg")
    if cfg.input_dir.strip():   cmd += ["--input-dir",  cfg.input_dir.strip()]
    if cfg.output_dir.strip():
        cmd += ["--output-dir", cfg.output_dir.strip()]
    if cfg.exclude_rembg:
        cmd += ["--exclude-rembg", ",".join(f.strip() for f in cfg.exclude_rembg if f.strip())]
    if cfg.skip_files:
        cmd += ["--skip-files", ",".join(f.strip() for f in cfg.skip_files if f.strip())]
    if cfg.upscale_max_px > 0:
        cmd += ["--upscale-max-px", str(cfg.upscale_max_px)]
    if cfg.resume:
        cmd.append("--resume")

    # Read processing settings from settings.json
    try:
        _s = json.loads(SETTINGS_FILE.read_text(encoding="utf-8")) if SETTINGS_FILE.exists() else {}
        rembg_model = (cfg.rembg_model or "").strip() or _s.get("processing", {}).get("rembg_model", "birefnet-general")
        if rembg_model:
            cmd += ["--rembg-model", rembg_model]
        rembg_fallback = _s.get("processing", {}).get("rembg_fallback", "auto")
        if rembg_fallback:
            cmd += ["--rembg-fallback", str(rembg_fallback)]
        if _s.get("processing", {}).get("wipe_input_after_run", False):
            cmd.append("--wipe-input-after-run")
        if _s.get("processing", {}).get("force_cpu", False):
            cmd.append("--force-cpu")
    except Exception:
        pass

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

        # BUG-14 FIX: the pipeline session tracks which image to resume from.
        # The `template` field stores the editor's active template (e.g. "Machine"),
        # NOT the pipeline's folder_mode. Storing folder_mode here caused the
        # editor's template restore condition to always fail silently because
        # "bulk"/"clean" are never valid template names.
        # We store "" here — the editor will set its own template in its session saves.
        def _update_session_progress(line: str):
            nonlocal progress_index
            if not line.startswith(done_prefixes):
                return
            progress_index += 1
            try:
                    SESSION_FILE.write_text(json.dumps(
                    SessionData(
                        src_root=str(session_src_root),
                        queue_index=progress_index,
                        template="",
                    ).model_dump()
                ))
            except Exception:
                pass

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=str(BASE_DIR),
            )
            _pipeline_proc = proc
            try:
                SESSION_FILE.write_text(json.dumps(
                    SessionData(
                        src_root=str(session_src_root),
                        queue_index=0,
                        template="",  # BUG-14 FIX: was cfg.folder_mode — wrong field
                    ).model_dump()
                ))
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
                SESSION_FILE.unlink(missing_ok=True)
            yield {"data": f"__done__ exit={proc.returncode}"}
        except Exception as e:
            yield {"data": f"__error__ {e}"}
        finally:
            if proc and proc.returncode is None:
                try:
                    if platform.system() == "Windows":
                        subprocess.call(
                            ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL,
                        )
                    else:
                        proc.terminate()
                        try:
                            await asyncio.wait_for(proc.wait(), timeout=2)
                        except asyncio.TimeoutError:
                            proc.kill()
                except Exception:
                    pass
            _pipeline_running = False
            _pipeline_proc = None

    return EventSourceResponse(event_stream())


@app.post("/pipeline/stop")
async def stop_pipeline():
    global _pipeline_proc, _pipeline_running

    pid = _pipeline_proc.pid if _pipeline_proc else None

    if platform.system() == "Windows":
        if pid:
            subprocess.call(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        subprocess.call(
            ["taskkill", "/F", "/IM", "realesrgan-ncnn-vulkan.exe"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    else:
        if pid:
            try:
                import signal
                os.killpg(os.getpgid(pid), signal.SIGTERM)
            except ProcessLookupError:
                pass

    _pipeline_proc    = None
    _pipeline_running = False
    return {"ok": True}


# ── Entry ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=7421, log_level="warning")
