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

import hashlib
import ctypes
import json
import re
import shutil
import subprocess
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, Future
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path, PurePosixPath
from PIL import Image, ImageFilter, ImageChops, UnidentifiedImageError
import numpy as np
from scipy.ndimage import binary_fill_holes, label

os.environ.setdefault("ORT_LOGGING_LEVEL", "3")
import onnxruntime as ort
try:
    ort.set_default_logger_severity(3)
except Exception:
    pass

from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn
from rich.prompt import Prompt
from rich.rule import Rule

# ── Constants ──────────────────────────────────────────────────────────────────

def _env_path(name: str) -> Path | None:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return None
    try:
        return Path(raw).expanduser().resolve()
    except Exception:
        return Path(raw).expanduser()


BASE_DIR  = _env_path("CUTOUT_STUDIO_RESOURCE_DIR") or Path(__file__).parent
DEFAULT_INPUT_DIR = _env_path("CUTOUT_STUDIO_DEFAULT_INPUT_DIR") or BASE_DIR / "input"
DEFAULT_OUTPUT_DIR = _env_path("CUTOUT_STUDIO_DEFAULT_OUTPUT_DIR") or BASE_DIR / "output"
NCNN_EXE  = BASE_DIR / "realesrgan-ncnn-vulkan" / "realesrgan-ncnn-vulkan.exe"

NCNN_MODELS = {
    "2": {"model": "realesr-animevideov3-x2", "scale": "2"},
    "4": {"model": "realesrgan-x4plus",        "scale": "4"},
}

REMBG_MODEL    = "birefnet-general"
SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".avif"}
AVIF_DECODE_ERROR = "AVIF is listed but Pillow cannot decode this file. Install Pillow with AVIF support or convert to PNG/JPEG."
_AVIF_DECODE_SUPPORTED = Image.registered_extensions().get(".avif") is not None
_ALLOWED_REMBG_FALLBACKS = {"auto"}
DEFAULT_UPSCALE_MAX_PX = 3600
DEFAULT_REMBG_MAX_PX = 4096

console = Console()

_rembg_remove_fn = None
_new_session_fn = None


def _ensure_rembg_loaded():
    global _rembg_remove_fn, _new_session_fn
    if _rembg_remove_fn is None or _new_session_fn is None:
        from rembg import remove as remove_fn, new_session as session_fn
        _rembg_remove_fn = remove_fn
        _new_session_fn = session_fn
    return _rembg_remove_fn, _new_session_fn


def rembg_remove(*args, **kwargs):
    remove_fn, _ = _ensure_rembg_loaded()
    return remove_fn(*args, **kwargs)


def new_session(*args, **kwargs):
    _, session_fn = _ensure_rembg_loaded()
    return session_fn(*args, **kwargs)

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
    """Collect images. Any file inside a folder named 'no_rembg' at any depth is
    added to no_rembg_set (upscale + crop only, no BG removal)."""
    no_rembg_set: set[Path] = set()

    if recursive:
        all_images = sorted(p for p in root.rglob("*") if p.suffix.lower() in SUPPORTED_EXTS)
    else:
        all_images = sorted(p for p in root.iterdir()
                            if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS)
        no_rembg_root = root / "no_rembg"
        if no_rembg_root.exists():
            extras = sorted(p for p in no_rembg_root.iterdir()
                            if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS)
            all_images = sorted(all_images + extras)

    for p in all_images:
        if "no_rembg" in (part.lower() for part in p.parts):
            no_rembg_set.add(p)

    return all_images, no_rembg_set


def mirror_path(src: Path, src_root: Path, dst_root: Path, suffix: str = ".png") -> Path:
    return dst_root / src.relative_to(src_root).with_suffix(suffix)


@dataclass
class DuplicateReusePlan:
    representatives: list[Path]
    duplicate_to_representative: dict[Path, Path] = field(default_factory=dict)
    hash_failed: list[Path] = field(default_factory=list)

    @property
    def duplicate_count(self) -> int:
        return len(self.duplicate_to_representative)

    @property
    def unique_count(self) -> int:
        return len(self.representatives)


def _sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _duplicate_policy_key(src: Path, do_rembg: bool, no_rembg_set: set[Path], excluded_paths: set[Path]) -> tuple[bool, bool, bool]:
    return (
        do_rembg,
        src in no_rembg_set,
        src in excluded_paths,
    )


def build_duplicate_reuse_plan(
    images: list[Path],
    input_root: Path,
    do_rembg: bool,
    no_rembg_set: set[Path],
    exclude_tokens: set[str],
    enabled: bool,
) -> DuplicateReusePlan:
    if not enabled:
        return DuplicateReusePlan(representatives=images)

    excluded_paths = _resolve_paths_from_tokens(images, input_root, exclude_tokens)
    by_hash: dict[tuple[str, tuple[bool, bool]], Path] = {}
    representatives: list[Path] = []
    duplicate_to_representative: dict[Path, Path] = {}
    hash_failed: list[Path] = []

    for src in images:
        try:
            digest = _sha256_file(src)
        except Exception as e:
            warn(f"Could not hash {src.name}; processing normally: {e}")
            representatives.append(src)
            hash_failed.append(src)
            continue

        key = (digest, _duplicate_policy_key(src, do_rembg, no_rembg_set, excluded_paths))
        representative = by_hash.get(key)
        if representative is None:
            by_hash[key] = src
            representatives.append(src)
        else:
            duplicate_to_representative[src] = representative

    return DuplicateReusePlan(
        representatives=representatives,
        duplicate_to_representative=duplicate_to_representative,
        hash_failed=hash_failed,
    )


def _expected_final_output(src: Path, input_root: Path, final_root: Path) -> Path:
    return mirror_path(src, input_root, final_root, suffix=".png")


def copy_duplicate_outputs(
    plan: DuplicateReusePlan,
    representative_outputs: dict[Path, Path],
    input_root: Path,
    final_root: Path,
    max_examples: int = 5,
) -> int:
    if not plan.duplicate_to_representative:
        return 0

    section("Exact Duplicate Reuse")
    copied = 0
    examples = 0
    for duplicate, representative in plan.duplicate_to_representative.items():
        representative_output = representative_outputs.get(representative)
        duplicate_output = _expected_final_output(duplicate, input_root, final_root)

        if not representative_output or not representative_output.exists() or not _is_valid_existing_output(representative_output):
            warn(f"Could not reuse duplicate {duplicate.name}; representative output missing or invalid.")
            continue

        try:
            duplicate_output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(representative_output, duplicate_output)
            copied += 1
            if examples < max_examples:
                try:
                    duplicate_label = duplicate.relative_to(input_root)
                except ValueError:
                    duplicate_label = Path(duplicate.name)
                try:
                    representative_label = representative.relative_to(input_root)
                except ValueError:
                    representative_label = Path(representative.name)
                ok(f"Reused result: {duplicate_label} ← {representative_label}")
                examples += 1
        except Exception as e:
            warn(f"Could not copy duplicate output for {duplicate.name}: {e}")

    remaining = copied - examples
    if remaining > 0:
        info(f"Reused {remaining} additional duplicate output(s).")
    return copied


def _normalize_image_token(value: str) -> str:
    token = str(value or "").strip().replace("\\", "/")
    token = token.rstrip("/")
    while token.startswith("./"):
        token = token[2:]
    while token.startswith("/"):
        token = token[1:]
    return token.lower()


def _split_selection_arg(value: str) -> list[str]:
    return [item.strip() for item in str(value or "").split(",") if item.strip()]


def _load_selection_manifest(path_value: str) -> dict[str, list[str]]:
    result = {"exclude_rembg": [], "skip_files": []}
    if not str(path_value or "").strip():
        return result

    manifest_path = Path(path_value)
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as e:
        warn(f"Could not read selection manifest {manifest_path}: {e}")
        return result

    if not isinstance(data, dict):
        warn(f"Selection manifest {manifest_path} is not an object; ignoring.")
        return result

    for key in result:
        values = data.get(key, [])
        if not isinstance(values, list):
            warn(f"Selection manifest field {key} is not a list; ignoring.")
            continue
        result[key] = [str(item).strip() for item in values if str(item).strip()]

    return result


def _relative_path_from_root(src: Path, root: Path | None) -> Path | None:
    if root is None:
        return None

    try:
        return src.relative_to(root)
    except ValueError:
        pass

    src_text = str(src).replace("\\", "/")
    root_text = str(root).replace("\\", "/").rstrip("/")
    if root_text and src_text.lower().startswith(f"{root_text.lower()}/"):
        return Path(src_text[len(root_text) + 1:])

    try:
        src_resolved = str(src.resolve(strict=False)).replace("\\", "/")
        root_resolved = str(root.resolve(strict=False)).replace("\\", "/").rstrip("/")
        if root_resolved and src_resolved.lower().startswith(f"{root_resolved.lower()}/"):
            return Path(src_resolved[len(root_resolved) + 1:])
    except Exception:
        pass

    return None


def _relative_token_from_root(src: Path, root: Path | None) -> str:
    rel = _relative_path_from_root(src, root)
    return _normalize_image_token(rel.as_posix()) if rel is not None else ""


def _relative_image_id(src: Path, root: Path, fallback_root: Path | None = None) -> str:
    rel = _relative_token_from_root(src, root)
    if not rel and fallback_root is not None:
        rel = _relative_token_from_root(src, fallback_root)
    return rel or _normalize_image_token(Path(src.name).as_posix())


def _token_without_ext(token: str) -> str:
    norm = _normalize_image_token(token)
    if not norm:
        return norm
    return str(PurePosixPath(norm).with_suffix("")).lower()


def _resolve_paths_from_tokens(
    images: list[Path],
    root: Path,
    tokens: set[str] | list[str] | tuple[str, ...],
    fallback_root: Path | None = None,
) -> set[Path]:
    matched, _ = _match_paths_from_tokens(images, root, tokens, fallback_root=fallback_root)
    return matched


def _match_paths_from_tokens(
    images: list[Path],
    root: Path,
    tokens: set[str] | list[str] | tuple[str, ...],
    fallback_root: Path | None = None,
) -> tuple[set[Path], list[str]]:
    by_rel: dict[str, set[Path]] = defaultdict(set)
    by_rel_no_ext: dict[str, set[Path]] = defaultdict(set)
    by_abs: dict[str, set[Path]] = defaultdict(set)
    by_abs_no_ext: dict[str, set[Path]] = defaultdict(set)
    by_name: dict[str, set[Path]] = defaultdict(set)
    by_stem: dict[str, set[Path]] = defaultdict(set)

    for image in images:
        rel_id = _relative_image_id(image, root, fallback_root=fallback_root)
        if rel_id:
            by_rel[rel_id].add(image)
            by_rel_no_ext[_token_without_ext(rel_id)].add(image)

        abs_tokens = {_normalize_image_token(str(image))}
        try:
            abs_tokens.add(_normalize_image_token(str(image.resolve(strict=False))))
        except Exception:
            pass
        for abs_id in abs_tokens:
            if not abs_id:
                continue
            by_abs[abs_id].add(image)
            by_abs_no_ext[_token_without_ext(abs_id)].add(image)

        by_name[image.name.lower()].add(image)
        by_stem[image.stem.lower()].add(image)

    normalized_tokens: list[str] = []
    seen_tokens: set[str] = set()
    for raw in tokens:
        token = _normalize_image_token(raw)
        if token and token not in seen_tokens:
            normalized_tokens.append(token)
            seen_tokens.add(token)

    matched: set[Path] = set()
    unmatched: list[str] = []
    for token in normalized_tokens:
        token_no_ext = _token_without_ext(token)
        exact_matches = set()
        exact_matches.update(by_rel.get(token, set()))
        exact_matches.update(by_rel_no_ext.get(token_no_ext, set()))
        exact_matches.update(by_abs.get(token, set()))
        exact_matches.update(by_abs_no_ext.get(token_no_ext, set()))

        if exact_matches:
            matched.update(exact_matches)
            continue

        # Legacy fallback: broad basename/stem matching when no exact path ID matches.
        fallback_matches = set()
        fallback_matches.update(by_name.get(token, set()))
        fallback_matches.update(by_stem.get(token, set()))
        if fallback_matches:
            matched.update(fallback_matches)
        else:
            unmatched.append(token)

    return matched, unmatched


def _compact_token_examples(tokens: list[str], limit: int = 5) -> str:
    examples = tokens[:limit]
    if len(tokens) > limit:
        examples.append(f"+{len(tokens) - limit} more")
    return ", ".join(examples)


def _log_token_match(label: str, machine_token: str, tokens: set[str], matched: set[Path], unmatched: list[str]) -> None:
    info(f"{label}: {len(tokens)} token(s) sent; {len(matched)} image(s) matched.")
    print(f"{machine_token}:{len(matched)}/{len(tokens)}", flush=True)
    if unmatched:
        warn(f"{label}: {len(unmatched)} unmatched token(s): {_compact_token_examples(unmatched)}")


def _open_image_checked(path: Path) -> Image.Image:
    if path.suffix.lower() == ".avif" and not _AVIF_DECODE_SUPPORTED:
        raise RuntimeError(AVIF_DECODE_ERROR)
    try:
        with Image.open(path) as opened:
            return opened.copy()
    except (UnidentifiedImageError, OSError) as e:
        if path.suffix.lower() == ".avif":
            raise RuntimeError(AVIF_DECODE_ERROR) from e
        raise


def _copy_corrupted(src: Path, src_root: Path, corrupted_dir: Path) -> None:
    """Copy a failed image to output/corrupted/, mirroring folder structure."""
    try:
        try:
            rel = src.relative_to(src_root)
        except ValueError:
            rel = Path(src.name)
        dst = corrupted_dir / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if not src.exists():
            warn(f"Source file missing, cannot copy to corrupted/: {src.name}")
            return
        shutil.copy2(src, dst)
    except Exception as e:
        warn(f"Could not copy {src.name} to corrupted/: {e}")


def _is_valid_existing_output(path: Path) -> bool:
    if not path.exists() or not path.is_file():
        return False
    try:
        if path.stat().st_size <= 0:
            return False
        with Image.open(path) as chk:
            chk.verify()
        return True
    except Exception:
        return False


def _remove_invalid_output(path: Path, label: str) -> None:
    try:
        path.unlink(missing_ok=True)
    except Exception as e:
        warn(f"Could not remove invalid {label} output {path.name}: {e}")


# ── Image processing ───────────────────────────────────────────────────────────

# Images wider/taller than this get tiled to avoid VRAM OOM on Vulkan
_NCNN_TILE_THRESHOLD = 2000  # px on longest side
_NCNN_TILE_SIZE      = "256"  # tile size passed to -t flag

def upscale_ncnn(src: Path, dst: Path, model: str, scale: str) -> bool:
    dst.parent.mkdir(parents=True, exist_ok=True)

    try:
        src_img = _open_image_checked(src)
    except RuntimeError as e:
        err(f"{src.name}: {e}")
        return False
    except Exception as e:
        err(f"Could not read {src.name}: {e}")
        return False
    has_alpha = src_img.mode in ("RGBA", "LA") or (
        src_img.mode == "P" and "transparency" in src_img.info
    )
    alpha_mask = src_img.convert("RGBA").split()[3] if has_alpha else None

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
            warn(f"{src.name} failed, retrying with tiling…")
            result = _run(tile=True)
        if result.returncode != 0:
            err(f"NCNN failed on {src.name}: {result.stderr.strip()[:120]}")
            return False
    finally:
        if tmp_png and tmp_png.exists():
            tmp_png.unlink(missing_ok=True)

    if alpha_mask is not None:
        with Image.open(dst) as opened:
            upscaled = opened.convert("RGBA")
        upscaled.putalpha(alpha_mask.resize((upscaled.width, upscaled.height), Image.LANCZOS))
        upscaled.save(dst, format="PNG")

    return True


def has_transparency(path: Path) -> bool:
    try:
        img = _open_image_checked(path)
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


def _select_onnx_providers(force_cpu: bool = False) -> tuple[list[str], str]:
    """GPU-first provider selection. DML → CUDA → CPU fallback chain."""
    if force_cpu:
        return ["CPUExecutionProvider"], "CPU / Stable"
    try:
        available = ort.get_available_providers()
        if "DmlExecutionProvider" in available:
            return ["DmlExecutionProvider", "CPUExecutionProvider"], "DirectML (GPU)"
        if "CUDAExecutionProvider" in available:
            return ["CUDAExecutionProvider", "CPUExecutionProvider"], "CUDA (GPU)"
    except Exception:
        pass
    return ["CPUExecutionProvider"], "CPU"


def _normalize_bg_device_mode(value: str) -> str:
    raw = str(value or "").strip().lower()
    return raw if raw in {"cpu", "gpu", "gpu_auto"} else "cpu"


def _available_gpu_provider() -> str | None:
    try:
        available = ort.get_available_providers()
        if "DmlExecutionProvider" in available:
            return "DmlExecutionProvider"
        if "CUDAExecutionProvider" in available:
            return "CUDAExecutionProvider"
    except Exception:
        pass
    return None


def _select_bg_device_providers(bg_device_mode: str = "cpu") -> tuple[list[str], str, bool, bool]:
    mode = _normalize_bg_device_mode(bg_device_mode)
    if mode == "cpu":
        return ["CPUExecutionProvider"], "CPU / Stable", False, False

    gpu_provider = _available_gpu_provider()
    if mode == "gpu":
        if gpu_provider:
            return [gpu_provider], "GPU / Experimental", False, True
        return ["CPUExecutionProvider"], "GPU / Experimental", False, False

    if gpu_provider:
        return [gpu_provider, "CPUExecutionProvider"], "GPU + CPU fallback", True, True
    return ["CPUExecutionProvider"], "GPU + CPU fallback", True, False


GPU_PROVIDER_NAMES = {"DmlExecutionProvider", "CUDAExecutionProvider"}
_ANSI_RE = re.compile(
    r"\x1b"
    r"(?:[@-Z\\-_]"
    r"|\[[0-?]*[ -/]*[@-~]"
    r"|\][^\x07\x1b]*(?:\x07|\x1b\\))"
)


def _strip_ansi(text: str) -> str:
    return _ANSI_RE.sub("", str(text or ""))


def _gpu_provider_from(providers: list[str]) -> str | None:
    for provider in providers:
        if provider in GPU_PROVIDER_NAMES:
            return provider
    return None


def _provider_label(provider: str | None) -> str:
    if provider == "CUDAExecutionProvider":
        return "CUDA"
    if provider == "DmlExecutionProvider":
        return "DirectML"
    return "GPU"


def _active_session_providers(session) -> list[str]:
    inner_session = getattr(session, "inner_session", None)
    get_providers = getattr(inner_session, "get_providers", None)
    if not callable(get_providers):
        return []
    try:
        return list(get_providers())
    except Exception:
        return []


def _gpu_provider_is_active(session) -> bool:
    return _gpu_provider_from(_active_session_providers(session)) is not None


def _is_gpu_runtime_error(msg: str) -> bool:
    m = _strip_ansi(msg).lower()
    return any(token in m for token in (
        "cudaexecutionprovider",
        "dmlexecutionprovider",
        "cuda",
        "directml",
        "cublas",
        "cublaslt",
        "cudart",
        "cufft",
        "cudnn",
        "onnxruntime",
        "provider_bridge",
        "loadlibrary",
        "failed to create session",
    ))


def _clean_gpu_error_message(message: str, provider: str | None = None) -> str:
    text = _strip_ansi(message)
    provider_label = _provider_label(provider)
    if provider == "CUDAExecutionProvider":
        return "CUDA provider unavailable: missing cublasLt64_12.dll. Use CPU / Stable or GPU + CPU fallback."
    if provider == "DmlExecutionProvider":
        return "DirectML provider unavailable. Use CPU / Stable or GPU + CPU fallback."
    return f"{provider_label} provider unavailable. Use CPU / Stable or GPU + CPU fallback."


def _provider_dependency_error(provider: str | None) -> str:
    if provider != "CUDAExecutionProvider":
        return ""
    required_dlls = ["cublasLt64_12.dll"]
    for dll_name in required_dlls:
        try:
            ctypes.WinDLL(dll_name)
        except Exception:
            return f"CUDA provider unavailable: missing {dll_name}. Use CPU / Stable or GPU + CPU fallback."
    return ""


def _is_oom_error(msg: str) -> bool:
    m = _strip_ansi(msg).lower()
    return any(token in m for token in (
        "out of memory",
        "not enough memory",
        "insufficient memory",
        "8007000e",
        "cuda_error_out_of_memory",
        "failed to allocate memory",
        "bad alloc",
    ))


def _normalize_rembg_fallback(value: str) -> str:
    raw = str(value or "").strip().lower()
    return raw if raw in _ALLOWED_REMBG_FALLBACKS else "auto"


_GPU_MEM_FRACTION = 0.80

def _ort_session_options() -> ort.SessionOptions:
    opts = ort.SessionOptions()
    opts.enable_mem_pattern = False
    return opts

def _cuda_mem_limit_bytes() -> int | None:
    try:
        import subprocess as _sp
        r = _sp.run(
            ["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        )
        if r.returncode == 0:
            mb = int(r.stdout.strip().split("\n")[0])
            return int(mb * _GPU_MEM_FRACTION * 1_048_576)
    except Exception:
        pass
    return None


def _fill_mask_holes(mask: Image.Image, threshold: int = 30, max_hole_ratio: float = 0.003) -> Image.Image:
    """Fill only small enclosed holes in a BiRefNet alpha mask.

    NOT applied to Bria — Bria masks are already clean and applying hole-fill
    would corrupt transparent product areas that Bria correctly preserves.
    """
    mask_np = np.array(mask)
    binary  = mask_np > threshold
    filled  = binary_fill_holes(binary)
    new_holes = filled & ~binary
    if not np.any(new_holes):
        return mask

    hole_labels, hole_count = label(new_holes)
    max_hole_px = int(mask_np.size * max_hole_ratio)
    result = mask_np.copy()
    for idx in range(1, hole_count + 1):
        area = int((hole_labels == idx).sum())
        if area <= max_hole_px:
            result[hole_labels == idx] = 255

    return Image.fromarray(result.astype(np.uint8), mode="L")


BIREFNET_MAX = 1024


def _prefetch_image(path: Path) -> None:
    """Pre-decode next image into OS page cache in a background thread."""
    try:
        _open_image_checked(path).load()
    except Exception:
        pass


def remove_bg(
    src: Path,
    dst: Path,
    session,
    model_name: str = "",
    max_input_px: int = DEFAULT_REMBG_MAX_PX,
) -> tuple[bool, str | None]:
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        img = _open_image_checked(src).convert("RGBA")
        original_w, original_h = img.size
        safe_max = int(max_input_px or DEFAULT_REMBG_MAX_PX)
        if safe_max > 0 and max(original_w, original_h) > safe_max:
            scale = safe_max / max(original_w, original_h)
            next_size = (max(1, int(original_w * scale)), max(1, int(original_h * scale)))
            warn(f"{src.name} downscaled for BG safety: {original_w}×{original_h} → {next_size[0]}×{next_size[1]}")
            print(
                f"__bg_downscale__:{src.name}:{original_w}x{original_h}->{next_size[0]}x{next_size[1]}",
                flush=True,
            )
            img = img.resize(next_size, Image.LANCZOS)

        # Already transparent — clean up edges and crop, skip inference entirely
        if has_transparency(src):
            result = tight_crop(refine_edges(img))
            result.save(dst, format="PNG")
            return True, None

        w, h = img.size
        if max(w, h) > BIREFNET_MAX:
            scale = BIREFNET_MAX / max(w, h)
            infer_img = img.resize(
                (max(1, int(w * scale)), max(1, int(h * scale))),
                Image.LANCZOS
            )
        else:
            infer_img = img

        mask = None
        infer_rgb = infer_img.convert("RGB")

        # Contrast boost helps BiRefNet edge quality.
        from PIL import ImageEnhance
        infer_rgb = ImageEnhance.Contrast(infer_rgb).enhance(1.4)

        mask_small = rembg_remove(infer_rgb, session=session, only_mask=True)

        if mask_small.size != img.size:
            mask = mask_small.resize(img.size, Image.BICUBIC)
        else:
            mask = mask_small

        # Hole-fill only for BiRefNet — guarded here, never runs for Bria.
        mask = _fill_mask_holes(mask)

        if mask is None:
            raise RuntimeError("Background mask generation failed (mask is unset).")

        img.putalpha(mask)
        result = tight_crop(refine_edges(img))
        result.save(dst, format="PNG")
        return True, None

    except Exception as e:
        err(f"BG removal failed on {src.name}: {e}")
        return False, str(e)


# ── Batch stages ───────────────────────────────────────────────────────────────

def batch_upscale(images: list[Path], src_root: Path, dst_root: Path,
                  model: str, scale: str,
                  upscale_max_px: int = 0,
                  corrupted_dir: Path | None = None) -> list[Path]:
    section("Stage 1 / 2 — Upscaling")
    print("__stage_start__:upscale", flush=True)
    print(f"__total__:{len(images)}", flush=True)
    outputs, to_run = [], []

    for src in images:
        dst = mirror_path(src, src_root, dst_root)
        outputs.append(dst)

        # 1. Valid file already exists → skip
        already_done = False
        if dst.exists():
            if _is_valid_existing_output(dst):
                already_done = True
            else:
                warn(f"{src.name} has invalid existing upscaled output — regenerating.")
                _remove_invalid_output(dst, "upscaled")

        if already_done:
            skip(f"{src.name} (already upscaled)")
            print(f"__processing_image__:upscale:{src}", flush=True)
            print(f"__skip_upscale__:{src.name}", flush=True)
            continue

        # 2. Image already large enough → skip upscale, use original
        try:
            img = _open_image_checked(src)
            w, h = img.size
            if upscale_max_px > 0 and max(w, h) >= upscale_max_px:
                skip(f"{src.name} ({w}×{h} — already ≥ {upscale_max_px}px)")
                print(f"__processing_image__:upscale:{src}", flush=True)
                print(f"__skip_upscale__:{src.name}", flush=True)
                outputs[-1] = src
                continue
        except RuntimeError as e:
            warn(f"{src.name}: {e}")
            print(f"__processing_image__:upscale:{src}", flush=True)
            print(f"__err_upscale__:{src.name}", flush=True)
            outputs[-1] = src
            if corrupted_dir:
                _copy_corrupted(src, src_root, corrupted_dir)
            continue
        except Exception as e:
            warn(f"Could not read {src.name} dimensions: {e}")

        # 3. Needs upscaling
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
            print(f"__processing_image__:upscale:{src}", flush=True)
            print(f"__processing__:{src}", flush=True)
            if upscale_ncnn(src, dst, model, scale):
                ok(f"{src.name} → upscaled/{dst.relative_to(dst_root)}")
                print(f"__ok_upscale__:{src.name}", flush=True)
            else:
                warn(f"{src.name} failed — using original for next stage.")
                print(f"__err_upscale__:{src.name}", flush=True)
                outputs[outputs.index(dst)] = src
                if corrupted_dir:
                    _copy_corrupted(src, src_root, corrupted_dir)
                    warn(f"  → copied to corrupted/{src.relative_to(src_root)}")
            progress.advance(task)

    return outputs


def batch_remove_bg(
    upscaled: list[Path],
    upscale_root: Path,
    dst_root: Path,
    src_root: Path,
    no_rembg_originals: set | None = None,
    exclude_tokens: set[str] | None = None,
    corrupted_dir: Path | None = None,
    force_cpu: bool = False,
    rembg_fallback: str = "auto",
    bg_device_mode: str = "cpu",
    max_input_px: int = DEFAULT_REMBG_MAX_PX,
) -> list[Path]:
    section("Stage 2 / 2 — Background Removal  [dim](BiRefNet)[/dim]")
    print("__stage_start__:rembg", flush=True)

    no_rembg_tokens = {
        _relative_image_id(p, src_root)
        for p in (no_rembg_originals or set())
    }
    no_rembg_paths = _resolve_paths_from_tokens(
        upscaled,
        upscale_root,
        no_rembg_tokens,
        fallback_root=src_root,
    )
    excluded_paths = _resolve_paths_from_tokens(
        upscaled,
        upscale_root,
        exclude_tokens or set(),
        fallback_root=src_root,
    )
    print(f"__total__:{len(upscaled)}", flush=True)

    if force_cpu:
        bg_device_mode = "cpu"
    bg_device_mode = _normalize_bg_device_mode(bg_device_mode)
    providers, device_label, fallback_enabled, gpu_available = _select_bg_device_providers(bg_device_mode)
    requested_gpu_provider = _gpu_provider_from(providers)
    info(f"BG device: {device_label}.")
    print(f"__bg_device__:{device_label}", flush=True)
    info(f"Using providers: {', '.join(providers)}")
    if bg_device_mode == "gpu" and not gpu_available:
        raise RuntimeError(
            "GPU / Experimental selected, but no DirectML/CUDA provider is available. "
            "Use CPU / Stable or GPU + CPU fallback."
        )
    dependency_error = _provider_dependency_error(requested_gpu_provider)
    if bg_device_mode == "gpu" and dependency_error:
        raise RuntimeError(dependency_error)
    if bg_device_mode == "gpu_auto" and dependency_error:
        warn(f"{dependency_error} Falling back to CPU / Stable for this run.")
        print("__bg_device__:GPU dependency missing -> switched to CPU", flush=True)
        providers = ["CPUExecutionProvider"]
        requested_gpu_provider = None
        device_label = "CPU / Stable"
    if bg_device_mode == "gpu_auto" and not gpu_available:
        warn("No DirectML/CUDA provider available; falling back to CPU / Stable for this run.")
        print("__bg_device__:GPU unavailable -> switched to CPU", flush=True)
        info("  -> install onnxruntime-directml to enable DirectML.")
    info(f"Loading {REMBG_MODEL} model. First use may download weights if missing.")
    print(f"__model_loading__:{REMBG_MODEL}:{device_label}", flush=True)
    console.print()

    sess_opts = _ort_session_options()
    model_load_start = time.perf_counter()

    provider_options = None
    if any("CUDA" in p for p in providers):
        limit = _cuda_mem_limit_bytes()
        if limit:
            provider_options = [{"device_id": 0,
                                 "gpu_mem_limit": limit,
                                 "arena_extend_strategy": "kSameAsRequested"}]
            info(f"CUDA VRAM cap: {limit // 1_048_576} MB ({int(_GPU_MEM_FRACTION * 100)}%)")

    try:
        session = new_session(REMBG_MODEL, providers=providers,
                              sess_options=sess_opts,
                              provider_options=provider_options)
    except Exception as e:
        if (
            fallback_enabled
            and (_is_oom_error(str(e)) or _is_gpu_runtime_error(str(e)))
        ):
            warn(f"{_clean_gpu_error_message(str(e), requested_gpu_provider)} Falling back to CPU / Stable for entire batch.")
            print("__bg_device__:GPU failed -> switched to CPU", flush=True)
            try:
                session = new_session(REMBG_MODEL,
                                      providers=["CPUExecutionProvider"],
                                      sess_options=sess_opts)
                device_label = "CPU / Stable"
                providers = ["CPUExecutionProvider"]
            except Exception as cpu_e:
                raise RuntimeError(f"GPU fallback to CPU failed during model load: {cpu_e}") from cpu_e
        elif bg_device_mode == "gpu" and (_is_oom_error(str(e)) or _is_gpu_runtime_error(str(e))):
            raise RuntimeError(_clean_gpu_error_message(str(e), requested_gpu_provider)) from e
        else:
            raise

    active_providers = _active_session_providers(session)
    active_gpu_provider = _gpu_provider_from(active_providers)
    if bg_device_mode == "gpu" and not active_gpu_provider:
        raise RuntimeError(_clean_gpu_error_message("", requested_gpu_provider))
    if bg_device_mode == "gpu_auto" and requested_gpu_provider and not active_gpu_provider:
        warn(
            f"{_provider_label(requested_gpu_provider)} provider did not stay active; "
            "falling back to CPU / Stable for this run."
        )
        print("__bg_device__:GPU provider inactive -> switched to CPU", flush=True)
        device_label = "CPU / Stable"
        providers = active_providers or ["CPUExecutionProvider"]
    elif active_gpu_provider:
        providers = active_providers

    model_load_elapsed = time.perf_counter() - model_load_start
    ok(f"Model loaded in {model_load_elapsed:.1f}s.")
    print(f"__model_loaded__:{REMBG_MODEL}:{device_label}:{model_load_elapsed:.1f}", flush=True)

    outputs, to_run = [], []

    for src in upscaled:
        rel = (
            _relative_path_from_root(src, upscale_root)
            or _relative_path_from_root(src, src_root)
            or Path(src.name)
        )
        dst = (dst_root / rel).with_suffix(".png")
        outputs.append(dst)

        if dst.exists() and _is_valid_existing_output(dst):
            skip(f"{src.name} (already processed)")
            print(f"__processing_image__:rembg:{src}", flush=True)
            print(f"__skip_rembg__:{src.name}", flush=True)
        elif src in no_rembg_paths or src in excluded_paths:
            if dst.exists():
                warn(f"{src.name} has invalid existing processed output — regenerating.")
                _remove_invalid_output(dst, "processed")
            try:
                dst.parent.mkdir(parents=True, exist_ok=True)
                tight_crop(_open_image_checked(src).convert("RGBA")).save(dst, format="PNG")
                ok(f"{src.name} → processed/{dst.relative_to(dst_root)}  [dim](crop only)[/dim]")
                print(f"__processing_image__:rembg:{src}", flush=True)
                print(f"__skip_rembg__:{src.name}", flush=True)
            except Exception as e:
                err(f"Crop failed on {src.name}: {e}")
                print(f"__processing_image__:rembg:{src}", flush=True)
                print(f"__err_rembg__:{src.name}", flush=True)
        else:
            if dst.exists():
                warn(f"{src.name} has invalid existing processed output — regenerating.")
                _remove_invalid_output(dst, "processed")
            to_run.append((src, dst))

    if not to_run:
        ok("All images already processed.")
        return outputs

    cpu_session = session if providers == ["CPUExecutionProvider"] else None

    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="prefetch") as prefetch_pool:
        prefetch_future: Future | None = None

        with Progress(SpinnerColumn(spinner_name="dots"),
                      TextColumn("  [dim]{task.description}[/dim]"),
                      BarColumn(), TaskProgressColumn(), console=console) as progress:
            task = progress.add_task("Removing BG...", total=len(to_run))
            for i, (src, dst) in enumerate(to_run):
                if i + 1 < len(to_run):
                    next_src = to_run[i + 1][0]
                    prefetch_future = prefetch_pool.submit(_prefetch_image, next_src)

                progress.update(task, description=src.name)
                print(f"__processing_image__:rembg:{src}", flush=True)
                print(f"__processing__:{src}", flush=True)

                if not src.exists():
                    warn(f"{src.name} source missing — skipping.")
                    print(f"__err_rembg__:{src.name}", flush=True)
                    progress.advance(task)
                    continue

                success, error_msg = remove_bg(src, dst, session, model_name=REMBG_MODEL, max_input_px=max_input_px)

                if (
                    (not success)
                    and fallback_enabled
                    and (_is_oom_error(error_msg or "") or _is_gpu_runtime_error(error_msg or ""))
                ):
                    print(f"__err_oom_gpu__:{src.name}", flush=True)
                    print("__bg_device__:GPU failed -> switched to CPU for remainder", flush=True)
                    warn(f"GPU failed on {src.name} - switching to CPU for remainder of batch.")
                    if cpu_session is None:
                        try:
                            cpu_session = new_session(
                                REMBG_MODEL,
                                providers=["CPUExecutionProvider"],
                            )
                        except Exception as cpu_e:
                            err(f"CPU fallback failed after GPU error on {src.name}: {cpu_e}")
                            print(f"__err_rembg__:{src.name}", flush=True)
                            if corrupted_dir:
                                _copy_corrupted(src, upscale_root, corrupted_dir)
                                warn(f"  â†’ copied to corrupted/{src.name}")
                            progress.advance(task)
                            continue
                    session = cpu_session  # permanent switch for all remaining images
                    providers = ["CPUExecutionProvider"]
                    success, error_msg = remove_bg(src, dst, session, model_name=REMBG_MODEL, max_input_px=max_input_px)
                elif (
                    (not success)
                    and bg_device_mode == "gpu"
                    and (_is_oom_error(error_msg or "") or _is_gpu_runtime_error(error_msg or ""))
                ):
                    print(f"__err_rembg__:{src.name}", flush=True)
                    raise RuntimeError(_clean_gpu_error_message(error_msg or "", requested_gpu_provider))

                if success:
                    ok(f"{src.name} → processed/{dst.relative_to(dst_root)}")
                    print(f"__ok_rembg__:{src.name}", flush=True)
                else:
                    print(f"__err_rembg__:{src.name}", flush=True)
                    if corrupted_dir:
                        _copy_corrupted(src, upscale_root, corrupted_dir)
                        warn(f"  → copied to corrupted/{src.name}")
                progress.advance(task)

    return outputs


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Image Pipeline")
    parser.add_argument("--non-interactive", action="store_true")
    parser.add_argument("--input-dir",        default="")
    parser.add_argument("--output-dir",       default="")
    parser.add_argument("--folder-mode",      default="bulk", choices=["bulk", "clean"])
    parser.add_argument("--no-upscale",       action="store_true")
    parser.add_argument("--scale",            default="2", choices=["2", "4"])
    parser.add_argument("--no-rembg",         action="store_true")
    parser.add_argument("--rembg-model",      default="")
    parser.add_argument("--force-cpu",        action="store_true")
    parser.add_argument("--bg-device-mode",   default="cpu", choices=["cpu", "gpu", "gpu_auto"])
    parser.add_argument("--exclude-rembg",    default="")
    parser.add_argument("--skip-files",       default="")
    parser.add_argument("--selection-manifest", default="")
    parser.add_argument("--rembg-fallback",   default="auto")
    parser.add_argument("--wipe-input-after-run", action="store_true")
    parser.add_argument("--upscale-max-px",   type=int, default=DEFAULT_UPSCALE_MAX_PX)
    parser.add_argument("--rembg-max-px",     type=int, default=DEFAULT_REMBG_MAX_PX)
    parser.add_argument("--no-reuse-exact-duplicates", action="store_true")
    parser.add_argument("--resume",           action="store_true")
    args = parser.parse_args()
    args.bg_device_mode = "cpu" if args.force_cpu else _normalize_bg_device_mode(args.bg_device_mode)
    rembg_fallback_raw = args.rembg_fallback
    args.rembg_fallback = _normalize_rembg_fallback(args.rembg_fallback)
    if str(rembg_fallback_raw or "").strip().lower() != args.rembg_fallback:
        warn("Background removal recovery setting normalized to automatic.")

    header()

    if not NCNN_EXE.exists():
        err(f"NCNN binary not found: {NCNN_EXE}")
        err("Place realesrgan-ncnn-vulkan/ folder next to pipeline.py")
        sys.exit(1)

    section("Configuration")

    if args.non_interactive:
        folder_mode = args.folder_mode
        do_upscale  = not args.no_upscale
        do_rembg    = not args.no_rembg
        ncnn_model  = NCNN_MODELS[args.scale]["model"]
        ncnn_scale  = NCNN_MODELS[args.scale]["scale"]
    else:
        folder_mode = ask("Folder mode", [
            ("Bulk  — all images in flat input/ folder",         "bulk"),
            ("Clean — input/ has subfolders (category/color/…)", "clean"),
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

    global REMBG_MODEL
    if args.rembg_model.strip():
        REMBG_MODEL = args.rembg_model.strip()
    info(f"BiRefNet model: {REMBG_MODEL}")

    # ── Resolve paths ────────────────────────────────────────────────────────
    using_default_input  = not bool(args.input_dir)
    using_default_output = not bool(args.output_dir)
    using_default_paths  = using_default_input and using_default_output
    preserve_custom_data = (not using_default_paths) and (not args.wipe_input_after_run)

    input_dir   = Path(args.input_dir)  if args.input_dir  else DEFAULT_INPUT_DIR
    output_base = Path(args.output_dir) if args.output_dir else DEFAULT_OUTPUT_DIR
    upscale_dir   = output_base / "upscaled"
    rembg_dir     = output_base / "processed"
    corrupted_dir = output_base / "corrupted"

    # rembg-only auto-fallback: use upscaled output as source if input is empty
    if not do_upscale and do_rembg:
        input_images = [p for p in input_dir.rglob("*")
                        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS] \
                       if input_dir.exists() else []
        if not input_images and upscale_dir.exists():
            upscale_images = [p for p in upscale_dir.rglob("*")
                              if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS]
            if upscale_images:
                info("Input is empty — using existing upscaled output as source.")
                input_dir = upscale_dir

    if not input_dir.exists():
        err(f"Input folder not found: {input_dir}")
        sys.exit(1)

    images, no_rembg_set = collect_images(input_dir, folder_mode == "clean")

    # Safety: bulk mode with images only in subfolders → auto-switch to recursive
    if not images and folder_mode == "bulk":
        nested_images, nested_no_rembg = collect_images(input_dir, recursive=True)
        if nested_images:
            warn("No top-level images found in Bulk mode — detected images in subfolders. Using recursive scan.")
            images       = nested_images
            no_rembg_set = nested_no_rembg
            folder_mode  = "clean"

    manifest_selection = _load_selection_manifest(args.selection_manifest)
    exclude_values = _split_selection_arg(args.exclude_rembg) + manifest_selection["exclude_rembg"]
    skip_values = _split_selection_arg(args.skip_files) + manifest_selection["skip_files"]
    exclude_tokens = {_normalize_image_token(s) for s in exclude_values if str(s).strip()}
    skip_tokens = {_normalize_image_token(s) for s in skip_values if str(s).strip()}
    skipped_paths, unmatched_skip_tokens = _match_paths_from_tokens(images, input_dir, skip_tokens)
    _log_token_match("Remove from session", "__skip_filter__", skip_tokens, skipped_paths, unmatched_skip_tokens)
    if skipped_paths:
        before = len(images)
        images = [p for p in images if p not in skipped_paths]
        info(f"Skipped {before - len(images)} file(s) (removed from session).")

    if not images:
        err(f"No images found in: {input_dir}")
        sys.exit(1)

    excluded_paths, unmatched_exclude_tokens = _match_paths_from_tokens(images, input_dir, exclude_tokens)
    _log_token_match("Exclude from BG", "__exclude_match__", exclude_tokens, excluded_paths, unmatched_exclude_tokens)
    normal_count = len(images) - len(excluded_paths)
    info(
        f"Selection: {len(skipped_paths)} removed, "
        f"{len(excluded_paths)} excluded from BG, {normal_count} normal."
    )

    duplicate_plan = build_duplicate_reuse_plan(
        images,
        input_dir,
        do_rembg,
        no_rembg_set,
        exclude_tokens,
        enabled=not args.no_reuse_exact_duplicates,
    )
    processing_images = duplicate_plan.representatives

    avif_inputs = [p for p in images if p.suffix.lower() == ".avif"]
    if avif_inputs:
        if not _AVIF_DECODE_SUPPORTED:
            err(AVIF_DECODE_ERROR)
            sys.exit(1)
        try:
            _open_image_checked(avif_inputs[0])
        except RuntimeError as e:
            err(str(e))
            sys.exit(1)
        except Exception as e:
            err(f"Failed to read AVIF input {avif_inputs[0].name}: {e}")
            sys.exit(1)

    section("Summary")
    table = Table.grid(padding=(0, 2))
    table.add_column(style="dim")
    table.add_column(style="bold cyan")
    table.add_row("Mode",      folder_mode)
    table.add_row("Images",    str(len(images)))
    if args.no_reuse_exact_duplicates:
        table.add_row("Exact duplicates", "reuse off")
    else:
        table.add_row(
            "Exact duplicates",
            f"{duplicate_plan.duplicate_count} reused; {duplicate_plan.unique_count} unique",
        )
    if no_rembg_set:
        table.add_row("No-rembg", f"{len(no_rembg_set)} (upscale + crop only)")
    if exclude_tokens:
        table.add_row("Exclude from BG", f"{len(excluded_paths)} image(s)")
    if skip_tokens:
        table.add_row("Removed", f"{len(skipped_paths)} skipped")
    table.add_row("Upscale",   f"NCNN {ncnn_model} ×{ncnn_scale}" if do_upscale else "skip")
    if do_upscale and args.upscale_max_px > 0:
        table.add_row("Upscale skip", f"images already ≥ {args.upscale_max_px}px")
    if do_rembg and args.rembg_max_px > 0:
        table.add_row("BG max input", f"downscale longest edge above {args.rembg_max_px}px")
    table.add_row("Remove BG", REMBG_MODEL if do_rembg else "skip")
    table.add_row("Input →",   str(input_dir))
    table.add_row("Output →",  str(rembg_dir))
    if args.resume:
        wipe_policy = "resume (preserve existing output)"
    elif preserve_custom_data:
        wipe_policy = "custom paths + wipe off (preserve input/output)"
    elif using_default_paths:
        wipe_policy = "default paths workflow (auto-clear output; optional input wipe)"
    else:
        wipe_policy = "custom paths with wipe enabled (clear output + wipe input)"
    table.add_row("Wipe policy", wipe_policy)
    console.print(table)
    console.print()

    if not args.non_interactive:
        Prompt.ask("  [dim]Press ENTER to start[/dim]")

    if not args.no_reuse_exact_duplicates:
        if duplicate_plan.duplicate_count:
            info(
                f"Exact duplicates: {duplicate_plan.duplicate_count} reused across matching processing groups. "
                f"Processing {duplicate_plan.unique_count} unique image(s) out of {len(images)}."
            )
        else:
            info(f"Exact duplicates: 0 reused across matching processing groups. Processing {len(images)} image(s).")
        if duplicate_plan.hash_failed:
            warn(f"Hashing failed for {len(duplicate_plan.hash_failed)} image(s); processing those normally.")

    clear_previous_output = (not args.resume) and (not preserve_custom_data)

    if args.resume:
        output_base.mkdir(parents=True, exist_ok=True)
        info("Resume mode enabled — keeping existing output.")
    elif clear_previous_output:
        if output_base.exists():
            shutil.rmtree(output_base)
        output_base.mkdir(parents=True)
        ok("Previous output cleared.")
    else:
        output_base.mkdir(parents=True, exist_ok=True)
        info("Custom paths + wipe off — preserving existing input/output.")

    current = processing_images

    if do_upscale:
        current = batch_upscale(
            current, input_dir, upscale_dir, ncnn_model, ncnn_scale,
            upscale_max_px=args.upscale_max_px,
            corrupted_dir=corrupted_dir,
        )
    else:
        skip("upscaling")

    final_root = rembg_dir if do_rembg else upscale_dir
    final_outputs: list[Path] = []

    if do_rembg:
        src_root = upscale_dir if do_upscale else input_dir
        final_outputs = batch_remove_bg(
            current, src_root, rembg_dir, input_dir, no_rembg_set,
            exclude_tokens=exclude_tokens,
            corrupted_dir=corrupted_dir,
            force_cpu=args.force_cpu,
            rembg_fallback=args.rembg_fallback,
            bg_device_mode=args.bg_device_mode,
            max_input_px=args.rembg_max_px,
        )
    else:
        skip("background removal")
        final_outputs = current

    representative_outputs = dict(zip(processing_images, final_outputs))
    duplicate_outputs = copy_duplicate_outputs(
        duplicate_plan,
        representative_outputs,
        input_dir,
        final_root,
    )
    if duplicate_outputs:
        ok(f"Reused {duplicate_outputs} exact duplicate output(s).")

    if args.wipe_input_after_run:
        for src in [p for p in input_dir.rglob("*") if p.is_file()]:
            try:
                src.unlink(missing_ok=True)
            except Exception:
                pass
        for p in sorted(input_dir.rglob("*"), reverse=True):
            if p.is_dir():
                try:
                    p.rmdir()
                except OSError:
                    pass
        ok("Input wiped (settings: wipe_input_after_run = true).")

    corrupted_files = list(corrupted_dir.rglob("*")) if corrupted_dir.exists() else []
    corrupted_count = sum(1 for p in corrupted_files if p.is_file())

    console.print()
    ready_dir = rembg_dir if do_rembg else upscale_dir
    ready_label = "Cutouts" if do_rembg else "Images"

    console.print(Panel(
        f"[green]Done.[/green]  {ready_label} ready in [cyan]{ready_dir}[/cyan]\n"
        + (f"[yellow]⚠  {corrupted_count} image(s) failed → [dim]{corrupted_dir}[/dim][/yellow]\n"
           if corrupted_count else "")
        + "[dim]Open placement editor to compose and export.[/dim]",
        border_style="cyan", title="[bold]Pipeline complete[/bold]"
    ))


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as e:
        err(str(e))
        sys.exit(1)
