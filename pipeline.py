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
import numpy as np
from scipy.ndimage import binary_fill_holes
import onnxruntime as ort

os.environ.setdefault("ORT_LOGGING_LEVEL", "3")

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


def _copy_corrupted(src: Path, src_root: Path, corrupted_dir: Path) -> None:
    """Copy a failed image to output/corrupted/, mirroring the source folder structure.

    Keeps the original file extension so the file is always openable.
    If two stages both fail on the same file, the second copy silently overwrites.
    """
    try:
        try:
            rel = src.relative_to(src_root)
        except ValueError:
            rel = Path(src.name)
        dst = corrupted_dir / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
    except Exception as e:
        warn(f"Could not copy {src.name} to corrupted/: {e}")


# ── Image processing ───────────────────────────────────────────────────────────

# Images wider/taller than this get tiled to avoid VRAM OOM on Vulkan
_NCNN_TILE_THRESHOLD = 2000  # px on longest side
_NCNN_TILE_SIZE      = "256"  # tile size passed to -t flag

def upscale_ncnn(src: Path, dst: Path, model: str, scale: str) -> bool:
    dst.parent.mkdir(parents=True, exist_ok=True)

    src_img   = Image.open(src)
    has_alpha = src_img.mode in ("RGBA", "LA") or (
        src_img.mode == "P" and "transparency" in src_img.info
    )
    alpha_mask = src_img.convert("RGBA").split()[3] if has_alpha else None

    # Always feed PNG to NCNN — WEBP and unusual JPEGs can trigger "queueC=" /
    # invalid-format Vulkan errors inside NCNN even when the file is valid.
    # We write a temp PNG next to the destination and clean it up afterwards.
    tmp_png: Path | None = None
    if src.suffix.lower() != ".png":
        tmp_png = dst.parent / f"_ncnntmp_{src.stem}.png"
        src_img.convert("RGB").save(tmp_png, format="PNG")
        ncnn_src = tmp_png
    else:
        ncnn_src = src

    w, h = src_img.size
    use_tile = max(w, h) > _NCNN_TILE_THRESHOLD

    def _run(tile: bool) -> subprocess.CompletedProcess:
        cmd = [str(NCNN_EXE), "-i", str(ncnn_src), "-o", str(dst),
               "-n", model, "-s", scale, "-f", "png"]
        if tile:
            cmd += ["-t", _NCNN_TILE_SIZE]
        return subprocess.run(cmd, capture_output=True, text=True)

    try:
        result = _run(use_tile)

        if result.returncode != 0 and not use_tile:
            # First attempt failed without tiling — retry with tiles (VRAM OOM recovery)
            warn(f"{src.name} failed, retrying with tiling…")
            result = _run(tile=True)

        if result.returncode != 0:
            err(f"NCNN failed on {src.name}: {result.stderr.strip()[:120]}")
            return False
    finally:
        if tmp_png and tmp_png.exists():
            tmp_png.unlink(missing_ok=True)

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


def _select_onnx_providers() -> tuple[list[str], str]:
    """Auto-select the best available ONNX Runtime provider.

    Windows:  DmlExecutionProvider covers NVIDIA/AMD/Intel without needing CUDA.
              Install onnxruntime-directml (not onnxruntime) in your venv to enable.
    Linux:    CUDAExecutionProvider if present.
    Fallback: CPUExecutionProvider always available.
    """
    try:
        available = ort.get_available_providers()
        if "DmlExecutionProvider" in available:
            return ["DmlExecutionProvider", "CPUExecutionProvider"], "DirectML (GPU)"
        if "CUDAExecutionProvider" in available:
            return ["CUDAExecutionProvider", "CPUExecutionProvider"], "CUDA (GPU)"
    except Exception:
        pass
    return ["CPUExecutionProvider"], "CPU"


def _fill_mask_holes(mask: Image.Image, threshold: int = 30) -> Image.Image:
    """Fill interior transparent holes in a BiRefNet alpha mask.

    BiRefNet correctly assigns partial transparency to glass, chrome, and
    reflective surfaces. For e-commerce product photography (products always
    opaque against a white background) those interior semi-transparent regions
    look like damage.  This fixes that by:
      1. Thresholding the mask to get a rough foreground binary
      2. Filling any region that is fully enclosed by foreground (scipy)
      3. Clamping those newly-filled pixels to 255 (fully opaque)
      4. Leaving all existing soft edge values untouched

    Result: interior glass/reflection holes → opaque; real product edges stay soft.
    """
    mask_np = np.array(mask)               # L-mode 0-255
    binary  = mask_np > threshold          # rough foreground
    filled  = binary_fill_holes(binary)    # fill enclosed holes
    # Only override pixels that fill added (were bg, now enclosed) → clamp to 255
    result  = np.where(filled & ~binary, 255, mask_np).astype(np.uint8)
    return Image.fromarray(result, mode="L")


BIREFNET_MAX = 1024   # BiRefNet's internal inference resolution; no benefit going larger

def remove_bg(src: Path, dst: Path, session) -> bool:
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        img = Image.open(src).convert("RGBA")

        # Already transparent — just clean up edges and crop, skip inference
        if has_transparency(src):
            result = tight_crop(refine_edges(img))
            result.save(dst, format="PNG")
            return True

        # Downscale to BIREFNET_MAX for inference only.
        # BiRefNet resizes internally to 1024px anyway; feeding a 4k image wastes
        # RAM with no quality gain. Keep the full-res image separate for compositing.
        w, h = img.size
        if max(w, h) > BIREFNET_MAX:
            scale = BIREFNET_MAX / max(w, h)
            infer_img = img.resize(
                (max(1, int(w * scale)), max(1, int(h * scale))),
                Image.LANCZOS
            )
        else:
            infer_img = img

        # Run inference with only_mask=True to get BiRefNet's raw sigmoid output.
        # DO NOT use post_process_mask=True — it applies a hard binary threshold
        # (np.where(mask < 127, 0, 255)) that destroys BiRefNet's smooth gradient
        # edges and causes pixelated/staircase cutouts.
        #
        # Contrast enhancement: apply 1.4× contrast to the inference image ONLY.
        # This improves segmentation of low-contrast products (white object on white bg,
        # overexposed images, glass) without affecting the output — the mask is always
        # applied back to the original full-res unmodified image.
        from PIL import ImageEnhance
        infer_rgb  = infer_img.convert("RGB")
        infer_rgb  = ImageEnhance.Contrast(infer_rgb).enhance(1.4)
        mask_small = rembg_remove(infer_rgb, session=session, only_mask=True)

        # Scale mask back to full-res.
        # Use BICUBIC — better gradient preservation than LANCZOS for alpha masks.
        if mask_small.size != img.size:
            mask = mask_small.resize(img.size, Image.BICUBIC)
        else:
            mask = mask_small

        # Fill enclosed transparent holes (glass, chrome, blender bowls) → opaque.
        # Only affects fully-enclosed interior regions; real edge gradients untouched.
        mask = _fill_mask_holes(mask)

        img.putalpha(mask)
        result = tight_crop(refine_edges(img))
        result.save(dst, format="PNG")
        return True
    except Exception as e:
        err(f"BG removal failed on {src.name}: {e}")
        return False


# ── Batch stages ───────────────────────────────────────────────────────────────

def batch_upscale(images: list[Path], src_root: Path, dst_root: Path,
                  model: str, scale: str, corrupted_dir: Path | None = None) -> list[Path]:
    section("Stage 1 / 2 — Upscaling")
    # Machine-readable total for the UI (Rich table wraps, so regex is unreliable)
    print(f"__total__:{len(images)}", flush=True)
    outputs, to_run = [], []

    for src in images:
        dst = mirror_path(src, src_root, dst_root)
        outputs.append(dst)
        if dst.exists():
            skip(f"{src.name} (already upscaled)")
            print(f"__skip_upscale__:{src.name}", flush=True)
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
            print(f"__processing__:{src}", flush=True)
            if upscale_ncnn(src, dst, model, scale):
                ok(f"{src.name} → upscaled/{dst.relative_to(dst_root)}")
                print(f"__ok_upscale__:{src.name}", flush=True)
            else:
                warn(f"{src.name} failed — using original for next stage.")
                print(f"__err_upscale__:{src.name}", flush=True)
                outputs[outputs.index(dst)] = src
                # Copy original to corrupted/ so the user can inspect failures
                if corrupted_dir:
                    _copy_corrupted(src, src_root, corrupted_dir)
                    warn(f"  → copied to corrupted/{src.relative_to(src_root)}")
            progress.advance(task)

    return outputs


def batch_remove_bg(upscaled: list[Path], upscale_root: Path,
                    dst_root: Path, src_root: Path,
                    no_rembg_originals: set | None = None,
                    corrupted_dir: Path | None = None) -> list[Path]:
    section("Stage 2 / 2 — Background Removal  [dim](BiRefNet)[/dim]")

    no_rembg_names = {p.name for p in (no_rembg_originals or set())}
    print(f"__total__:{len(upscaled)}", flush=True)

    providers, device_label = _select_onnx_providers()
    info(f"Using {device_label} for background removal (BiRefNet).")
    if device_label == "CPU":
        info("  → To enable GPU: pip uninstall onnxruntime && pip install onnxruntime-directml")
    info("Loading BiRefNet — first run downloads ~973MB...")
    console.print()

    session = new_session(REMBG_MODEL, providers=providers)
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
            print(f"__skip_rembg__:{src.name}", flush=True)
        elif src.name in no_rembg_names:
            try:
                dst.parent.mkdir(parents=True, exist_ok=True)
                tight_crop(Image.open(src).convert("RGBA")).save(dst, format="PNG")
                ok(f"{src.name} → bg_removed/{dst.relative_to(dst_root)}  [dim](crop only)[/dim]")
                print(f"__skip_rembg__:{src.name}", flush=True)
            except Exception as e:
                err(f"Crop failed on {src.name}: {e}")
                print(f"__err_rembg__:{src.name}", flush=True)
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
            print(f"__processing__:{src}", flush=True)
            if remove_bg(src, dst, session):
                ok(f"{src.name} → bg_removed/{dst.relative_to(dst_root)}")
                print(f"__ok_rembg__:{src.name}", flush=True)
            else:
                print(f"__err_rembg__:{src.name}", flush=True)
                # Copy the best available version (upscaled or original) to corrupted/
                if corrupted_dir:
                    _copy_corrupted(src, upscale_root, corrupted_dir)
                    warn(f"  → copied to corrupted/{src.name}")
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
    parser.add_argument("--rembg-model", default="", help="Override BiRefNet model name")
    args = parser.parse_args()

    header()

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
    else:        # ── Interactive terminal mode (unchanged) ────────────────────────────
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

    # Override BiRefNet model if passed via CLI (set from settings.json by api.py)
    global REMBG_MODEL
    if args.rembg_model.strip():
        REMBG_MODEL = args.rembg_model.strip()
    info(f"BiRefNet model: {REMBG_MODEL}")

    # ── Resolve paths (CLI overrides > defaults) ─────────────────────────────
    input_dir   = Path(args.input_dir)  if args.input_dir  else BASE_DIR / "input"
    output_base = Path(args.output_dir) if args.output_dir else BASE_DIR / "output"
    upscale_dir   = output_base / "upscaled"
    rembg_dir     = output_base / "bg_removed"
    corrupted_dir = output_base / "corrupted"

    # rembg-only auto-fallback: if input is empty but upscale_dir has content,
    # use upscale_dir as the source so a two-step workflow (upscale today,
    # rembg tomorrow) works without manually changing the input path.
    if not do_upscale and do_rembg:
        input_images = [p for p in input_dir.rglob("*")
                        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS] \
                       if input_dir.exists() else []
        if not input_images and upscale_dir.exists():
            upscale_images = [p for p in upscale_dir.rglob("*")
                              if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS]
            if upscale_images:
                info(f"Input is empty — using existing upscaled output as source.")
                input_dir = upscale_dir

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
        current = batch_upscale(current, input_dir, upscale_dir, ncnn_model, ncnn_scale,
                                corrupted_dir=corrupted_dir)
    else:
        skip("upscaling")

    if do_rembg:
        src_root = upscale_dir if do_upscale else input_dir
        batch_remove_bg(current, src_root, rembg_dir, input_dir, no_rembg_set,
                        corrupted_dir=corrupted_dir)
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

    corrupted_files = list(corrupted_dir.rglob("*")) if corrupted_dir.exists() else []
    corrupted_count = sum(1 for p in corrupted_files if p.is_file())

    console.print()
    console.print(Panel(
        f"[green]Done.[/green]  Cutouts ready in [cyan]{rembg_dir}[/cyan]\n"
        + (f"[yellow]⚠  {corrupted_count} image(s) failed → [dim]{corrupted_dir}[/dim][/yellow]\n"
           if corrupted_count else "")
        + "[dim]Open placement editor to compose and export.[/dim]",
        border_style="cyan", title="[bold]Pipeline complete[/bold]"
    ))


if __name__ == "__main__":
    main()