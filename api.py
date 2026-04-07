# =============================================================
# IMAGE PIPELINE — Local API Server
# Version : v1.1
# Copyright (c) 2026 Liudas. Licensed under AGPL-3.0. See LICENSE.
# =============================================================
#
# Runs on http://127.0.0.1:7421
# React frontend talks to this. Nothing leaves your machine.
#
# Install:  pip install fastapi uvicorn sse-starlette pillow
# Run:      python api.py

import asyncio
import json
import platform
import re
import shutil
import subprocess
import sys
import configparser
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from PIL import Image
from sse_starlette.sse import EventSourceResponse

# ── Config ────────────────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).parent

_cfg = configparser.ConfigParser()
_cfg.read(BASE_DIR / "config.ini")

CANVAS_SIZE   = _cfg.getint("canvas", "canvas_size",  fallback=1440)
OUTPUT_ROOT   = BASE_DIR / _cfg.get("paths", "output_root",   fallback="output")
TEMPLATES_DIR = BASE_DIR / _cfg.get("paths", "templates_dir", fallback="templates")
SESSION_FILE   = BASE_DIR / "session.json"
SETTINGS_FILE  = BASE_DIR / "settings.json"

# ── Default settings (written on first run) ───────────────────────────────────
DEFAULT_SETTINGS = {
    "processing": {
        "crop_padding":  0.04,
        "edge_blur":     1.2,
        "rembg_model":   "birefnet-general",
        "history_keep":  30,
    },
    "upscaler_api": {
        "provider": "local",
        "url":      "",
        "key":      "",
        "model":    "",
    },
    "rembg_api": {
        "provider": "local",
        "url":      "",
        "key":      "",
    },
    "output": {
        "canvas_size":    1440,
        "thumbnail":      True,
        "thumbnail_size": 400,
        "folder_mode":    "bulk",
        "output_dir":     "",
    },
    "appearance": {
        "guide_opacity":    0.55,
        "ref_img_opacity":  0.20,
    },
}

def _load_settings() -> dict:
    if SETTINGS_FILE.exists():
        try:
            saved = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            # Deep-merge saved over defaults so new keys always exist
            import copy
            merged = copy.deepcopy(DEFAULT_SETTINGS)
            for section, vals in saved.items():
                if section in merged and isinstance(vals, dict):
                    merged[section].update(vals)
                else:
                    merged[section] = vals
            return merged
        except Exception:
            pass
    return dict(DEFAULT_SETTINGS)

def _save_settings(data: dict):
    SETTINGS_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
    )

def _seed_settings():
    if not SETTINGS_FILE.exists():
        _save_settings(DEFAULT_SETTINGS)

_seed_settings()

SUPPORTED_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".tiff"}

def _g(key, fallback):
    return _cfg.getint("guides", key, fallback=fallback)

# Base guide positions from config.ini — colors now come from settings.json
_BASE_GUIDES = {
    "red":     {"top": _g("red_top",140),     "bottom": _g("red_bottom",1300),
                "left": _g("red_left",140),   "right": _g("red_right",1300),   "color": "#FF0000"},
    "green":   {"top": _g("green_top",224),   "bottom": _g("green_bottom",1216),
                "left": _g("green_left",224), "right": _g("green_right",1216), "color": "#00A300"},
    "blue":    {"top": _g("blue_top",284),    "bottom": _g("blue_bottom",1156),
                "left": _g("blue_left",284),  "right": _g("blue_right",1156),  "color": "#2E2EFF"},
    "magenta": {"top": _g("magenta_top",434), "bottom": _g("magenta_bottom",1006),
                "left": _g("magenta_left",434),"right": _g("magenta_right",1006),"color": "#FF2EFF"},
}

def _get_guides() -> dict:
    """Return guides merged with any overrides from settings.json."""
    import copy
    guides = copy.deepcopy(_BASE_GUIDES)
    s = _load_settings()
    for zone, overrides in s.get("guides", {}).items():
        if zone in guides and isinstance(overrides, dict):
            guides[zone].update(overrides)
    return guides

GUIDES = _get_guides()

BUILTIN_TEMPLATES = {
    "— none —":           {"zone": None,      "hint": "",                                   "ref_image": ""},
    "Machine":            {"zone": "green",   "hint": "Top + bottom touch green lines",     "ref_image": ""},
    "Bottle 1–1.5L":      {"zone": "green",   "hint": "Top + bottom touch green lines",     "ref_image": ""},
    "Bottle 0.5L":        {"zone": "blue",    "hint": "Top + bottom touch blue lines",      "ref_image": ""},
    "Coffee bag large":   {"zone": "blue",    "hint": "Fill blue zone",                     "ref_image": ""},
    "Coffee bag small":   {"zone": "blue",    "hint": "Fill blue zone",                     "ref_image": ""},
    "Box large":          {"zone": "green",   "hint": "Fill green zone",                    "ref_image": ""},
    "Box small":          {"zone": "magenta", "hint": "Fill magenta zone",                  "ref_image": ""},
    "Capsules / small":   {"zone": "magenta", "hint": "Fill magenta zone",                  "ref_image": ""},
    "Combo / multipack":  {"zone": "green",   "hint": "Group fills green zone",             "ref_image": ""},
}

# ── Terminal output cleaning ──────────────────────────────────────────────────
# Rich's Progress bar uses \r (carriage return) to overwrite lines in-place
# AND emits cursor-movement CSI sequences. The old regex only stripped colour
# codes, leaving \r and cursor codes that corrupted log lines and broke all
# counter regexes in the frontend.  This handles everything.

_ANSI_RE = re.compile(
    r'\x1b'                                          # ESC
    r'(?:[@-Z\\-_]'                                  # Fe two-char sequences
    r'|\[[0-?]*[ -/]*[@-~]'                          # CSI (colours, cursor, erase…)
    r'|\][^\x07\x1b]*(?:\x07|\x1b\\))'              # OSC sequences
)
_CTRL_RE = re.compile(r'[\r\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')

def _clean(raw: bytes) -> list[str]:
    """Decode, strip ALL terminal control codes, return non-empty lines."""
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
    """Auto-detect the best available source folder under output_root."""
    root = output_root or OUTPUT_ROOT
    for folder, label in [
        (root     / "bg_removed", f"{root.name}/bg_removed"),
        (root     / "upscaled",   f"{root.name}/upscaled"),
        (BASE_DIR / "input",      "input"),
    ]:
        if folder.exists() and any(
            p.suffix.lower() in SUPPORTED_EXTS
            for p in folder.rglob("*") if p.is_file()
        ):
            return folder, label
    return BASE_DIR / "input", "input"

def mirror_save_path(src: Path, src_root: Path) -> Path:
    """Replicate the source subfolder structure inside output/final/."""
    try:
        rel = src.relative_to(src_root)
    except ValueError:
        rel = Path(src.name)
    return OUTPUT_ROOT / "final" / rel

# ── Template helpers ──────────────────────────────────────────────────────────

CUSTOM_TEMPLATES_FILE = BASE_DIR / "templates_custom.json"

def _load_custom_templates() -> dict:
    """Load templates from JSON; fall back to built-ins on any error."""
    if CUSTOM_TEMPLATES_FILE.exists():
        try:
            return json.loads(CUSTOM_TEMPLATES_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return dict(BUILTIN_TEMPLATES)

def _seed_templates():
    """Write built-in templates to JSON on first run so the Templates tab can edit them."""
    if not CUSTOM_TEMPLATES_FILE.exists():
        CUSTOM_TEMPLATES_FILE.write_text(
            json.dumps(BUILTIN_TEMPLATES, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

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
    canvas_size: int | None = None

class SkipRequest(BaseModel):
    image_path: str

class SessionData(BaseModel):
    src_root:    str
    queue_index: int
    template:    str

class PipelineConfig(BaseModel):
    folder_mode: str
    do_upscale:  bool
    scale:       str
    do_rembg:    bool
    input_dir:   str = ""
    output_dir:  str = ""

class TemplatesPayload(BaseModel):
    templates: dict

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="Image Pipeline API", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Pipeline state ────────────────────────────────────────────────────────────

_pipeline_running = False
_pipeline_proc: asyncio.subprocess.Process | None = None

# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/config")
def get_config():
    s = _load_settings()
    return {
        "canvas_size": s["output"].get("canvas_size", CANVAS_SIZE),
        "guides":      _get_guides(),
        "templates":   _load_custom_templates(),
        "settings":    s,
    }


@app.get("/browse")
def browse_folder(initial: str = ""):
    """Open a native OS folder-picker dialog."""
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
    """Open a native OS file-picker dialog (used for template reference images)."""
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


# ── Settings ─────────────────────────────────────────────────────────────────

class SettingsPayload(BaseModel):
    settings: dict

@app.get("/settings")
def get_settings():
    return {"settings": _load_settings()}

@app.post("/settings")
def save_settings_endpoint(payload: SettingsPayload):
    _save_settings(payload.settings)
    # Refresh in-memory guides so /config returns updated colors immediately
    global GUIDES
    GUIDES = _get_guides()
    return {"ok": True}

@app.post("/settings/test-rembg")
async def test_rembg_api(body: dict):
    """Ping a custom BG removal API with a tiny blank PNG to verify connectivity."""
    url = body.get("url", "").strip()
    key = body.get("key", "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="No URL provided")
    try:
        import httpx, base64
        # 1x1 transparent PNG
        tiny = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        )
        headers = {}
        if key:
            headers["Authorization"] = f"Bearer {key}"
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(url, files={"file": ("test.png", tiny, "image/png")}, headers=headers)
        return {"ok": r.status_code < 500, "status": r.status_code}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/settings/test-upscaler")
async def test_upscaler_api(body: dict):
    """Ping a custom upscaler API."""
    url = body.get("url", "").strip()
    key = body.get("key", "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="No URL provided")
    try:
        import httpx
        headers = {"Authorization": f"Bearer {key}"} if key else {}
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(url, headers=headers)
        return {"ok": r.status_code < 500, "status": r.status_code}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Templates ─────────────────────────────────────────────────────────────────

@app.get("/templates/list")
def list_templates():
    return {"templates": _load_custom_templates()}


@app.post("/templates/save")
def save_templates(payload: TemplatesPayload):
    """Persist custom templates to templates_custom.json."""
    CUSTOM_TEMPLATES_FILE.write_text(
        json.dumps(payload.templates, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return {"ok": True, "count": len(payload.templates)}


# ── Source / images ───────────────────────────────────────────────────────────

@app.get("/source")
def get_source(output_dir: str = ""):
    """Auto-detect the best source folder, preferring output_dir if supplied."""
    base = Path(output_dir.strip()) if output_dir.strip() else OUTPUT_ROOT
    folder, label = detect_source_folder(base)
    images = images_in_folder(folder)
    return {"folder": str(folder), "label": label, "count": len(images)}


@app.get("/images")
def list_images(folder: str = Query(...)):
    path = Path(folder)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Folder not found: {folder}")
    images = images_in_folder(path)
    return {"folder": str(path), "images": [str(p) for p in images], "count": len(images)}


@app.get("/image")
def serve_image(path: str = Query(...)):
    p = Path(path)
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"Not found: {path}")
    if p.suffix.lower() not in SUPPORTED_EXTS:
        raise HTTPException(status_code=400, detail="Unsupported file type")
    return FileResponse(str(p))


# ── Save composition ──────────────────────────────────────────────────────────

@app.post("/save")
def save_composition(req: SaveRequest):
    """Compose placed items onto a transparent canvas and write PNG + optional thumbnail."""
    if not req.items:
        raise HTTPException(status_code=400, detail="No items to save")

    cs = req.canvas_size if req.canvas_size and req.canvas_size > 0 else CANVAS_SIZE
    canvas = Image.new("RGBA", (cs, cs), (0, 0, 0, 0))

    for item in req.items:
        p = Path(item.image_path)
        if not p.exists():
            raise HTTPException(status_code=404, detail=f"Source image not found: {item.image_path}")
        img = Image.open(p).convert("RGBA")
        w   = max(1, int(img.width  * item.scale))
        h   = max(1, int(img.height * item.scale))
        resized = img.resize((w, h), Image.LANCZOS)
        x = item.canvas_x - w // 2
        y = item.canvas_y - h // 2
        canvas.paste(resized, (x, y), resized)

    ref_path  = Path(req.items[0].image_path)
    src_root  = Path(req.src_root)
    save_path = mirror_save_path(ref_path, src_root).with_suffix(".png")
    if req.is_combo:
        save_path = save_path.with_name(save_path.stem + "_combo.png")

    save_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(save_path)

    thumb_path = None
    if req.thumbnail:
        thumb_dir  = save_path.parent / "400"
        thumb_dir.mkdir(parents=True, exist_ok=True)
        white = Image.new("RGBA", (cs, cs), (255, 255, 255, 255))
        white.paste(canvas, mask=canvas.split()[3])
        thumb_file = thumb_dir / save_path.name
        white.convert("RGB").resize((400, 400), Image.LANCZOS).save(thumb_file, quality=95)
        thumb_path = str(thumb_file)

    return {"saved": str(save_path), "thumb": thumb_path}


# ── Skip ──────────────────────────────────────────────────────────────────────

@app.post("/skip")
def skip_image(req: SkipRequest):
    src = Path(req.image_path)
    if not src.exists():
        raise HTTPException(status_code=404, detail=f"Not found: {req.image_path}")
    dst = OUTPUT_ROOT / "skipped" / src.name
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


# ── Pipeline ──────────────────────────────────────────────────────────────────

@app.get("/pipeline/status")
def pipeline_status():
    return {"running": _pipeline_running}


@app.post("/pipeline/run")
async def run_pipeline(cfg: PipelineConfig):
    """
    Start pipeline.py as a subprocess and stream cleaned stdout back via SSE.
    Uses chunk-based reading so Rich's \\r progress-bar lines are handled
    correctly and all terminal control codes are stripped before forwarding.
    """
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
    if cfg.input_dir.strip():  cmd += ["--input-dir",  cfg.input_dir.strip()]
    if cfg.output_dir.strip(): cmd += ["--output-dir", cfg.output_dir.strip()]

    async def event_stream():
        global _pipeline_running, _pipeline_proc
        _pipeline_running = True
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=str(BASE_DIR),
            )
            _pipeline_proc = proc

            # Read in chunks — readline() misses \r-delimited progress bar lines
            while True:
                chunk = await proc.stdout.read(4096)
                if not chunk:
                    break
                for line in _clean(chunk):
                    yield {"data": line}

            await proc.wait()
            yield {"data": f"__done__ exit={proc.returncode}"}

        except Exception as e:
            yield {"data": f"__error__ {e}"}
        finally:
            _pipeline_running = False
            _pipeline_proc    = None

    return EventSourceResponse(event_stream())


@app.post("/pipeline/stop")
async def stop_pipeline():
    """
    Kill the running pipeline and its ENTIRE process tree.

    On Windows we do two passes:
      1. taskkill /F /T /PID — kills the Python process + all children
      2. taskkill /F /IM realesrgan-ncnn-vulkan.exe — kills any orphan NCNN
         process that survived step 1 (it can outlive the parent on Windows
         if it was started in a separate job object)

    Both calls are best-effort; errors are silently swallowed.
    After stop the machine should feel normal again immediately.
    """
    global _pipeline_proc, _pipeline_running

    pid = _pipeline_proc.pid if _pipeline_proc else None

    if platform.system() == "Windows":
        if pid:
            subprocess.call(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        # Always also kill by image name to catch any orphan
        for exe in ["realesrgan-ncnn-vulkan.exe", "python.exe"]:
            # Only kill python processes that are children of our pipeline —
            # killing all python.exe would be too aggressive, so we skip it
            # and rely on /T above for the Python wrapper.
            pass
        subprocess.call(
            ["taskkill", "/F", "/IM", "realesrgan-ncnn-vulkan.exe"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    else:
        if pid:
            try:
                import os, signal
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