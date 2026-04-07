# =============================================================
# IMAGE PIPELINE
# Version : v3.2
# Copyright (c) 2026 Liudas. Licensed under AGPL-3.0. See LICENSE.
# =============================================================

import sys, io, os

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
if sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
if sys.stderr.encoding.lower() != "utf-8":
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from PIL import Image, ImageFilter, ImageChops

os.environ.setdefault("ORT_LOGGING_LEVEL", "3")

import onnxruntime as ort
from rembg import remove as rembg_remove, new_session
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn
from rich.prompt import Prompt
from rich.rule import Rule

# ── Constants ──────────────────────────────────────────────────────────────────

BASE_DIR  = Path(__file__).parent
NCNN_EXE  = BASE_DIR / "realesrgan-ncnn-vulkan" / "realesrgan-ncnn-vulkan.exe"

def _load_pipeline_settings() -> dict:
    """Load settings.json at runtime. Returns empty dict on any error."""
    p = BASE_DIR / "settings.json"
    try:
        if p.exists():
            import json as _j
            return _j.loads(p.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}

NCNN_MODELS = {
    "2": {"model": "realesr-animevideov3-x2", "scale": "2"},
    "4": {"model": "realesrgan-x4plus",        "scale": "4"},
}

REMBG_MODEL    = "birefnet-general"
SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".tiff"}

console = Console()

# ── UI helpers ─────────────────────────────────────────────────────────────────

def header():
    console.print()
    console.print(Panel.fit(
        "[bold cyan]IMAGE PIPELINE[/bold cyan]  [dim]v3.2[/dim]\n"
        "[dim]Upscale → Remove BG  |  NCNN Vulkan + BiRefNet[/dim]",
        border_style="cyan"
    ))
    console.print()

def section(title: str): console.print(Rule(f"[bold white]{title}[/bold white]", style="dim"))
def ok(msg: str):        console.print(f"  [green]✓[/green] {msg}")
def err(msg: str):       console.print(f"  [red]✗[/red] {msg}")
def warn(msg: str):      console.print(f"  [yellow]⚠[/yellow] {msg}")
def skip(msg: str):      console.print(f"  [dim]↷ skip: {msg}[/dim]")
def info(msg: str):      console.print(f"  [dim]{msg}[/dim]")

def ask(title: str, options: list):
    console.print()
    console.print(f"[bold yellow]{title}[/bold yellow]")
    for i, (label, _) in enumerate(options, 1):
        console.print(f"  [cyan]{i}[/cyan]  {label}")
    valid = [str(i) for i in range(1, len(options) + 1)]
    while True:
        choice = Prompt.ask(f"  [dim]Enter {'/'.join(valid)}[/dim]").strip()
        if choice in valid:
            return options[int(choice) - 1][1]
        console.print("  [red]Invalid[/red]")


# ── File helpers ───────────────────────────────────────────────────────────────

def collect_images(root: Path, recursive: bool) -> tuple[list[Path], set[Path]]:
    no_rembg_dir = root / "no_rembg"
    no_rembg_set: set[Path] = set()

    if recursive:
        all_images = sorted(p for p in root.rglob("*") if p.suffix.lower() in SUPPORTED_EXTS)
    else:
        all_images = sorted(p for p in root.iterdir()
                            if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS)
        if no_rembg_dir.exists():
            extras = sorted(p for p in no_rembg_dir.iterdir()
                            if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS)
            all_images = sorted(all_images + extras)

    for p in all_images:
        try:
            p.relative_to(no_rembg_dir)
            no_rembg_set.add(p)
        except ValueError:
            pass

    return all_images, no_rembg_set


def mirror_path(src: Path, src_root: Path, dst_root: Path, suffix: str = ".png") -> Path:
    return dst_root / src.relative_to(src_root).with_suffix(suffix)


# ── Image processing ───────────────────────────────────────────────────────────

def upscale_ncnn(src: Path, dst: Path, model: str, scale: str) -> bool:
    dst.parent.mkdir(parents=True, exist_ok=True)

    src_img   = Image.open(src)
    has_alpha = src_img.mode in ("RGBA", "LA") or (
        src_img.mode == "P" and "transparency" in src_img.info
    )
    alpha_mask = src_img.convert("RGBA").split()[3] if has_alpha else None

    result = subprocess.run(
        [str(NCNN_EXE), "-i", str(src), "-o", str(dst), "-n", model, "-s", scale, "-f", "png"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        err(f"NCNN failed on {src.name}: {result.stderr.strip()}")
        return False

    if alpha_mask is not None:
        upscaled = Image.open(dst).convert("RGBA")
        upscaled.putalpha(alpha_mask.resize((upscaled.width, upscaled.height), Image.LANCZOS))
        upscaled.save(dst, format="PNG")

    return True


def has_transparency(path: Path) -> bool:
    try:
        img = Image.open(path)
        if img.mode not in ("RGBA", "LA"):
            return False
        return img.split()[-1].getextrema()[0] < 255
    except Exception:
        return False


def tight_crop(img: Image.Image, padding: float = 0.04) -> Image.Image:
    if img.mode != "RGBA":
        return img
    bbox = img.split()[3].getbbox()
    if bbox is None:
        return img
    x1, y1, x2, y2 = bbox
    pad = int(max(x2 - x1, y2 - y1) * padding)
    return img.crop((
        max(0, x1 - pad), max(0, y1 - pad),
        min(img.width, x2 + pad), min(img.height, y2 + pad)
    ))


def refine_edges(img: Image.Image, blur_radius: float = 1.2) -> Image.Image:
    if img.mode != "RGBA":
        return img
    r, g, b, alpha = img.split()
    inner   = alpha.point(lambda p: 255 if p >= 240 else 0)
    blurred = alpha.filter(ImageFilter.GaussianBlur(radius=blur_radius))
    return Image.merge("RGBA", (r, g, b, ImageChops.lighter(blurred, inner)))


def remove_bg(src: Path, dst: Path, session, settings: dict | None = None) -> bool:
    dst.parent.mkdir(parents=True, exist_ok=True)
    proc    = (settings or {}).get("processing", {})
    padding = float(proc.get("crop_padding", 0.04))
    blur_r  = float(proc.get("edge_blur",    1.2))
    rembg_api = (settings or {}).get("rembg_api", {})

    try:
        img = Image.open(src).convert("RGBA")

        # ── External BG removal API ──────────────────────────────────────────
        if rembg_api.get("provider", "local") != "local" and rembg_api.get("url"):
            import requests as _req, io as _io
            headers = {}
            if rembg_api.get("key"):
                headers["Authorization"] = f"Bearer {rembg_api['key']}"
            with open(src, "rb") as f:
                resp = _req.post(rembg_api["url"].rstrip("/"),
                                 files={"file": f}, headers=headers, timeout=60)
            resp.raise_for_status()
            result = Image.open(_io.BytesIO(resp.content)).convert("RGBA")
            result = tight_crop(refine_edges(result, blur_radius=blur_r), padding=padding)
            result.save(dst, format="PNG")
            return True

        # ── Local BiRefNet ───────────────────────────────────────────────────
        if has_transparency(src):
            result = tight_crop(refine_edges(img, blur_radius=blur_r), padding=padding)
        else:
            result = tight_crop(refine_edges(rembg_remove(img, session=session),
                                             blur_radius=blur_r), padding=padding)
        result.save(dst, format="PNG")
        return True
    except Exception as e:
        err(f"BG removal failed on {src.name}: {e}")
        return False


# ── Batch stages ───────────────────────────────────────────────────────────────

def batch_upscale(images: list[Path], src_root: Path, dst_root: Path,
                  model: str, scale: str) -> list[Path]:
    section("Stage 1 / 2 — Upscaling")
    outputs, to_run = [], []

    for src in images:
        dst = mirror_path(src, src_root, dst_root)
        outputs.append(dst)
        if dst.exists():
            skip(f"{src.name} (already upscaled)")
        else:
            to_run.append((src, dst))

    if not to_run:
        ok("All images already upscaled.")
        return outputs

    with Progress(SpinnerColumn(spinner_name="dots"),
                  TextColumn("  [dim]{task.description}[/dim]"),
                  BarColumn(), TaskProgressColumn(), console=console) as progress:
        task = progress.add_task("Upscaling...", total=len(to_run))
        for src, dst in to_run:
            progress.update(task, description=src.name)
            if upscale_ncnn(src, dst, model, scale):
                ok(f"{src.name} → upscaled/{dst.relative_to(dst_root)}")
            else:
                warn(f"{src.name} failed — using original for next stage.")
                outputs[outputs.index(dst)] = src
            progress.advance(task)

    return outputs


def batch_remove_bg(upscaled: list[Path], upscale_root: Path,
                    dst_root: Path, src_root: Path,
                    no_rembg_originals: set | None = None,
                    settings: dict | None = None) -> list[Path]:
    section("Stage 2 / 2 — Background Removal  [dim](BiRefNet)[/dim]")

    no_rembg_names = {p.name for p in (no_rembg_originals or set())}

    info("Using CPU for background removal (BiRefNet).")
    info("Loading BiRefNet — first run downloads ~170MB...")
    console.print()

    proc_s      = (settings or {}).get("processing", {})
    rembg_model = proc_s.get("rembg_model", REMBG_MODEL)
    rembg_api   = (settings or {}).get("rembg_api", {})
    use_local   = rembg_api.get("provider", "local") == "local"
    session     = new_session(rembg_model, providers=["CPUExecutionProvider"]) if use_local else None
    ok("Model loaded.")

    outputs, to_run = [], []

    for src in upscaled:
        try:
            rel = src.relative_to(upscale_root)
        except ValueError:
            rel = Path(src.name)
        dst = (dst_root / rel).with_suffix(".png")
        outputs.append(dst)

        if dst.exists():
            skip(f"{src.name} (already processed)")
        elif src.name in no_rembg_names:
            try:
                dst.parent.mkdir(parents=True, exist_ok=True)
                tight_crop(Image.open(src).convert("RGBA")).save(dst, format="PNG")
                ok(f"{src.name} → bg_removed/{dst.relative_to(dst_root)}  [dim](crop only)[/dim]")
            except Exception as e:
                err(f"Crop failed on {src.name}: {e}")
        else:
            to_run.append((src, dst))

    if not to_run:
        ok("All images already processed.")
        return outputs

    with Progress(SpinnerColumn(spinner_name="dots"),
                  TextColumn("  [dim]{task.description}[/dim]"),
                  BarColumn(), TaskProgressColumn(), console=console) as progress:
        task = progress.add_task("Removing BG...", total=len(to_run))
        for src, dst in to_run:
            progress.update(task, description=src.name)
            if remove_bg(src, dst, session, settings=settings):
                ok(f"{src.name} → bg_removed/{dst.relative_to(dst_root)}")
            progress.advance(task)

    return outputs


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Image Pipeline")
    parser.add_argument("--non-interactive", action="store_true",
                        help="Skip prompts; use CLI flags (called by the API server)")
    parser.add_argument("--input-dir",   default="",
                        help="Input folder  (default: <script dir>/input)")
    parser.add_argument("--output-dir",  default="",
                        help="Output folder (default: <script dir>/output)")
    parser.add_argument("--folder-mode", default="bulk", choices=["bulk", "clean"])
    parser.add_argument("--no-upscale",  action="store_true")
    parser.add_argument("--scale",       default="4", choices=["2", "4"])
    parser.add_argument("--no-rembg",    action="store_true")
    args = parser.parse_args()

    header()

    _settings = _load_pipeline_settings()  # load once per run

    if not NCNN_EXE.exists():
        err(f"NCNN binary not found: {NCNN_EXE}")
        err("Place realesrgan-ncnn-vulkan/ folder next to pipeline.py")
        sys.exit(1)

    section("Configuration")

    if args.non_interactive:
        # ── Driven by API / CLI flags ────────────────────────────────────────
        folder_mode = args.folder_mode
        do_upscale  = not args.no_upscale
        do_rembg    = not args.no_rembg
        ncnn_model  = NCNN_MODELS[args.scale]["model"]
        ncnn_scale  = NCNN_MODELS[args.scale]["scale"]
    else:
        # ── Interactive terminal mode (unchanged) ────────────────────────────
        folder_mode = ask("Folder mode", [
            ("Bulk  — all images in flat input/ folder",          "bulk"),
            ("Clean — input/ has subfolders (category/color/…)",  "clean"),
        ])
        do_upscale = ask("Upscaling", [
            ("Yes — NCNN Vulkan (GPU)", True),
            ("No  — skip",             False),
        ])
        ncnn_model = NCNN_MODELS["4"]["model"]
        ncnn_scale = NCNN_MODELS["4"]["scale"]
        if do_upscale:
            choice     = ask("Upscale factor", [
                ("2x — faster,  realesr-animevideov3-x2", "2"),
                ("4x — quality, realesrgan-x4plus",        "4"),
            ])
            ncnn_model = NCNN_MODELS[choice]["model"]
            ncnn_scale = NCNN_MODELS[choice]["scale"]
        do_rembg = ask("Background removal", [
            ("Yes — BiRefNet", True),
            ("No  — skip",     False),
        ])

    if not do_upscale and not do_rembg:
        warn("Both stages skipped — nothing to do.")
        sys.exit(0)

    # ── Resolve paths (CLI overrides > defaults) ─────────────────────────────
    input_dir   = Path(args.input_dir)  if args.input_dir  else BASE_DIR / "input"
    output_base = Path(args.output_dir) if args.output_dir else BASE_DIR / "output"
    upscale_dir = output_base / "upscaled"
    rembg_dir   = output_base / "bg_removed"

    if not input_dir.exists():
        err(f"Input folder not found: {input_dir}")
        sys.exit(1)

    images, no_rembg_set = collect_images(input_dir, folder_mode == "clean")

    if not images:
        err(f"No images found in: {input_dir}")
        sys.exit(1)

    section("Summary")
    table = Table.grid(padding=(0, 2))
    table.add_column(style="dim")
    table.add_column(style="bold cyan")
    table.add_row("Mode",      folder_mode)
    table.add_row("Images",    str(len(images)))
    if no_rembg_set:
        table.add_row("No-rembg", f"{len(no_rembg_set)} (upscale + crop only)")
    table.add_row("Upscale",   f"NCNN {ncnn_model} ×{ncnn_scale}" if do_upscale else "skip")
    table.add_row("Remove BG", REMBG_MODEL if do_rembg else "skip")
    table.add_row("Input →",   str(input_dir))
    table.add_row("Output →",  str(rembg_dir))
    console.print(table)
    console.print()

    if not args.non_interactive:
        Prompt.ask("  [dim]Press ENTER to start[/dim]")

    # Clear previous output for this output_base only
    if output_base.exists():
        shutil.rmtree(output_base)
    output_base.mkdir(parents=True)
    ok("Previous output cleared.")

    current = images

    if do_upscale:
        current = batch_upscale(current, input_dir, upscale_dir, ncnn_model, ncnn_scale)
    else:
        skip("upscaling")

    if do_rembg:
        src_root = upscale_dir if do_upscale else input_dir
        batch_remove_bg(current, src_root, rembg_dir, input_dir, no_rembg_set, settings=_settings)
    else:
        skip("background removal")

    stamp    = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    hist_dir = BASE_DIR / "history" / stamp
    hist_dir.mkdir(parents=True, exist_ok=True)

    for src in [p for p in input_dir.rglob("*") if p.is_file()]:
        dst = hist_dir / src.relative_to(input_dir)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))

    for p in sorted(input_dir.rglob("*"), reverse=True):
        if p.is_dir():
            try: p.rmdir()
            except OSError: pass

    ok(f"Input archived → history/{stamp}/")

    console.print()
    console.print(Panel(
        f"[green]Done.[/green]  Cutouts ready in [cyan]{rembg_dir}[/cyan]\n"
        "[dim]Open placement editor to compose and export.[/dim]",
        border_style="cyan", title="[bold]Pipeline complete[/bold]"
    ))


if __name__ == "__main__":
    main()