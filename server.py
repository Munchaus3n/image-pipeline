# =============================================================
# IMAGE PIPELINE — HTTP SERVER (Tauri sidecar)
# Version : v1.0
# Copyright (c) 2026 Liudas. Licensed under AGPL-3.0. See LICENSE.
#
# Runs as a local FastAPI server on port 8765.
# Tauri spawns this as a sidecar process on app start.
# All endpoints called from the frontend via fetch.
# =============================================================

import os
import sys
import base64
import asyncio
import configparser
import subprocess
import threading
from pathlib import Path

from typing import AsyncGenerator
from typing import Literal

os.environ.setdefault("ORT_LOGGING_LEVEL", "3")

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
import uvicorn

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).parent
CONFIG_INI = BASE_DIR / "config.ini"
PIPELINE   = BASE_DIR / "pipeline.py"
PYTHON_EXE = sys.executable

app = FastAPI(title="Image Pipeline API")

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

# ── State ──────────────────────────────────────────────────────────────────────
_pipeline_process: subprocess.Popen | None = None
_cancel_flag = threading.Event()

SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".tiff"}
_ALLOWED_ROOTS = tuple(p.resolve() for p in {BASE_DIR, BASE_DIR / "output", BASE_DIR / "input", BASE_DIR / "templates"})


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


# ── Models ─────────────────────────────────────────────────────────────────────

class PipelineConfig(BaseModel):
    input_folder:       str
    output_folder:      str
    folder_mode:        Literal["bulk", "clean"]
    upscaling_enabled:  bool
    upscale_factor:     Literal["2x", "4x"]
    bg_removal_enabled: bool

class PlacementSave(BaseModel):
    image_path: str
    x:          int
    y:          int
    scale:      float

class ConfigPayload(BaseModel):
    data: dict


# ── Helpers ────────────────────────────────────────────────────────────────────

def read_config() -> dict:
    cfg = configparser.ConfigParser()
    if CONFIG_INI.exists():
        cfg.read(CONFIG_INI)
    return {s: dict(cfg[s]) for s in cfg.sections()}


def write_config(data: dict):
    cfg = configparser.ConfigParser()
    for section, values in data.items():
        cfg[section] = values
    with open(CONFIG_INI, "w") as f:
        cfg.write(f)


def image_to_base64(path: Path) -> str:
    suffix = path.suffix.lower()
    mime = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".webp": "image/webp",
        ".tiff": "image/tiff",
    }.get(suffix, "image/png")
    data = base64.b64encode(path.read_bytes()).decode()
    return f"data:{mime};base64,{data}"


# ── Endpoints ──────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/images")
def list_images(folder: str, recursive: bool = False):
    """List all supported images in a folder. Returns paths + count by type."""
    root = _resolve_safe_path(folder, must_exist=True, allow_file=False, allow_dir=True)
    if not root.exists():
        raise HTTPException(404, f"Folder not found: {folder}")

    no_rembg_dir = root / "no_rembg"

    if recursive:
        files = sorted(p for p in root.rglob("*") if p.suffix.lower() in SUPPORTED_EXTS)
    else:
        files = sorted(p for p in root.iterdir()
                       if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS)
        if no_rembg_dir.exists():
            extras = sorted(p for p in no_rembg_dir.iterdir()
                            if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS)
            files = sorted(files + extras)

    png = sum(1 for p in files if p.suffix.lower() == ".png")
    jpg = sum(1 for p in files if p.suffix.lower() in {".jpg", ".jpeg"})
    no_rembg = sum(1 for p in files if no_rembg_dir in p.parents)

    return {
        "total":     len(files),
        "png":       png,
        "jpg":       jpg,
        "no_rembg":  no_rembg,
        "paths":     [str(p) for p in files],
    }


@app.get("/image")
def get_image(path: str):
    """Return a single image as base64 data URL."""
    p = _resolve_safe_path(path, must_exist=True, allow_file=True, allow_dir=False)
    if not p.exists():
        raise HTTPException(404, f"Image not found: {path}")
    return {"data_url": image_to_base64(p)}


@app.post("/run_pipeline")
async def run_pipeline(config: PipelineConfig):
    """
    Run the pipeline. Streams log lines as SSE.
    Frontend reads via EventSource or fetch with ReadableStream.
    """
    global _pipeline_process
    _cancel_flag.clear()

    async def generate() -> AsyncGenerator[str, None]:
        global _pipeline_process

        args = [
            PYTHON_EXE, str(PIPELINE),
            "--input",          config.input_folder,
            "--output",         config.output_folder,
            "--folder-mode",    config.folder_mode,
            "--upscale",        str(config.upscaling_enabled).lower(),
            "--upscale-factor", config.upscale_factor.replace("x", ""),
            "--rembg",          str(config.bg_removal_enabled).lower(),
            "--server-mode",    # flag tells pipeline.py to output JSON log lines
        ]

        _pipeline_process = subprocess.Popen(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )

        for line in _pipeline_process.stdout:
            if _cancel_flag.is_set():
                _pipeline_process.terminate()
                yield f"data: {{\"type\":\"cancelled\"}}\n\n"
                return
            yield f"data: {line.rstrip()}\n\n"
            await asyncio.sleep(0)

        _pipeline_process.wait()
        rc = _pipeline_process.returncode
        yield f"data: {{\"type\":\"done\",\"returncode\":{rc}}}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/cancel_pipeline")
def cancel_pipeline():
    global _pipeline_process
    _cancel_flag.set()
    if _pipeline_process and _pipeline_process.poll() is None:
        _pipeline_process.terminate()
    return {"status": "cancelled"}


@app.get("/config")
def get_config():
    return read_config()


@app.post("/config")
def save_config(payload: ConfigPayload):
    write_config(payload.data)
    return {"status": "saved"}


@app.post("/save_placement")
def save_placement(data: PlacementSave):
    """
    Receives final x/y/scale for an image and saves it.
    Actual canvas compositing is done by placement_editor.py —
    this endpoint records the decision for batch export.
    """
    placements_file = BASE_DIR / "output" / "placements.json"
    placements_file.parent.mkdir(parents=True, exist_ok=True)

    import json
    existing = {}
    if placements_file.exists():
        existing = json.loads(placements_file.read_text())

    existing[data.image_path] = {"x": data.x, "y": data.y, "scale": data.scale}
    placements_file.write_text(json.dumps(existing, indent=2))
    return {"status": "saved"}


@app.get("/open_folder")
def open_folder(path: str):
    """Open folder in system file explorer."""
    import platform
    p = _resolve_safe_path(path, must_exist=True, allow_file=False, allow_dir=True)
    if not p.exists():
        raise HTTPException(404, f"Folder not found: {path}")
    system = platform.system()
    if system == "Windows":
        subprocess.Popen(["explorer", str(p)])
    elif system == "Darwin":
        subprocess.Popen(["open", str(p)])
    else:
        subprocess.Popen(["xdg-open", str(p)])
    return {"status": "opened"}


# ── Entry ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="error")
