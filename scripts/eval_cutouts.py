"""Compare background-removal settings on a folder of photos.

Run the model once per image, apply several post-processing variants to the
same mask, and write cutouts, contact sheets and CSV tables so a setting can be
judged on your own products instead of guessed.

    .\\venv311\\Scripts\\python scripts\\eval_cutouts.py --images D:\\samples
    .\\venv311\\Scripts\\python scripts\\eval_cutouts.py --images D:\\samples --masks D:\\samples_gt ^
        --variant default --variant hard --variant "soft3:edge_blur=3,contrast_boost=0"

Keep the sample folder outside the repo (about 40-60 photos, including the hard
cases: glass, chrome, white-on-white, grouped capsules). With --masks, a
ground-truth mask named like each photo (same stem, any image extension, white
= product) adds IoU and MAE columns. Without it you get timings, the width of
the soft edge, and contact sheets to judge by eye.

Variant syntax: a preset name (see PRESETS) or  name:option=value,option=value
using any CutoutOptions field.
"""

from __future__ import annotations

import argparse
import csv
import sys
import tempfile
import time
from dataclasses import fields
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

import pipeline as pl  # noqa: E402

PRESETS: dict[str, dict] = {
    "default": {},
    "hard": {"edge_mode": "hard"},
    "no-fringe-cleanup": {"decontaminate": False},
    "raw-mask": {"mask_stretch": False, "contrast_boost": 0.0},
}

TILE = 360


def _coerce(name: str, raw: str):
    default = getattr(pl.CutoutOptions(), name)
    if isinstance(default, bool):
        return raw.strip().lower() in {"1", "true", "yes", "on"}
    return type(default)(raw)


def parse_variant(text: str) -> tuple[str, pl.CutoutOptions]:
    name, _, spec = text.partition(":")
    name = name.strip()
    if not spec:
        if name not in PRESETS:
            raise SystemExit(f"Unknown preset '{name}'. Presets: {', '.join(PRESETS)}")
        return name, pl.CutoutOptions(**PRESETS[name])
    valid = {f.name for f in fields(pl.CutoutOptions)}
    values: dict = {}
    for part in spec.split(","):
        key, _, raw = part.partition("=")
        key = key.strip()
        if key not in valid:
            raise SystemExit(f"Unknown option '{key}'. Options: {', '.join(sorted(valid))}")
        values[key] = _coerce(key, raw)
    return name, pl.CutoutOptions(**values)


def find_images(folder: Path, limit: int) -> list[Path]:
    images = sorted(p for p in folder.rglob("*") if p.is_file() and p.suffix.lower() in pl.SUPPORTED_EXTS)
    return images[:limit] if limit > 0 else images


def load_ground_truth(masks_dir: Path | None, image: Path, size: tuple[int, int]) -> np.ndarray | None:
    if masks_dir is None:
        return None
    for candidate in masks_dir.glob(f"{image.stem}.*"):
        if candidate.suffix.lower() in pl.SUPPORTED_EXTS:
            mask = Image.open(candidate).convert("L")
            if mask.size != size:
                mask = mask.resize(size, Image.LANCZOS)
            return np.asarray(mask, dtype=np.float32) / 255.0
    return None


def edge_metrics(alpha: np.ndarray, gt: np.ndarray | None) -> dict:
    out = {"softpx": int(((alpha > 0.02) & (alpha < 0.98)).sum())}
    if gt is not None:
        out["iou"] = float(np.minimum(alpha, gt).sum() / max(np.maximum(alpha, gt).sum(), 1e-6))
        out["mae"] = float(np.abs(alpha - gt).mean())
    return out


def checkerboard(size: tuple[int, int], cell: int = 12) -> Image.Image:
    w, h = size
    yy, xx = np.indices((h, w))
    board = np.where(((yy // cell) + (xx // cell)) % 2 == 0, 204, 244).astype(np.uint8)
    return Image.fromarray(np.dstack([board] * 3), mode="RGB")


def on_background(rgba: Image.Image, kind: str) -> Image.Image:
    bg = checkerboard(rgba.size) if kind == "checker" else Image.new("RGB", rgba.size, (24, 24, 28))
    bg.paste(rgba, mask=rgba.getchannel("A"))
    return bg


def fit_tile(img: Image.Image) -> Image.Image:
    img = img.copy()
    img.thumbnail((TILE, TILE), Image.LANCZOS)
    tile = Image.new("RGB", (TILE, TILE), (255, 255, 255))
    tile.paste(img.convert("RGB"), ((TILE - img.width) // 2, (TILE - img.height) // 2))
    return tile


def contact_sheet(original: Image.Image, results: dict[str, Image.Image]) -> Image.Image:
    cols = 1 + len(results)
    sheet = Image.new("RGB", (cols * TILE, 2 * TILE), (255, 255, 255))
    sheet.paste(fit_tile(original), (0, 0))
    sheet.paste(fit_tile(original), (0, TILE))
    draw = ImageDraw.Draw(sheet)
    draw.text((6, 4), "original", fill=(200, 0, 0))
    for i, (name, rgba) in enumerate(results.items(), start=1):
        sheet.paste(fit_tile(on_background(rgba, "checker")), (i * TILE, 0))
        sheet.paste(fit_tile(on_background(rgba, "dark")), (i * TILE, TILE))
        draw.text((i * TILE + 6, 4), name, fill=(200, 0, 0))
    return sheet


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--images", required=True, type=Path, help="folder of sample photos (outside the repo)")
    parser.add_argument("--masks", type=Path, help="folder of ground-truth masks named like the photos")
    parser.add_argument("--out", type=Path, help="output folder (default: a temp folder)")
    parser.add_argument("--model", default="birefnet-general")
    parser.add_argument("--device", default="cpu", choices=["cpu", "gpu", "gpu_auto"])
    parser.add_argument("--variant", action="append", help="repeatable; default: all presets")
    parser.add_argument("--limit", type=int, default=0, help="only the first N images")
    parser.add_argument("--max-px", type=int, default=pl.DEFAULT_REMBG_MAX_PX, help="same size cap the pipeline uses")
    args = parser.parse_args()

    if not args.images.is_dir():
        raise SystemExit(f"Not a folder: {args.images}")
    images = find_images(args.images, args.limit)
    if not images:
        raise SystemExit(f"No images found in {args.images}")
    variants = [parse_variant(v) for v in (args.variant or list(PRESETS))]
    names = [name for name, _ in variants]
    if len(set(names)) != len(names):
        raise SystemExit("Variant names must be unique.")

    out_dir = args.out or Path(tempfile.gettempdir()) / "cutout-eval" / time.strftime("%Y%m%d-%H%M%S")
    resolved_out = out_dir.resolve()
    if resolved_out == REPO or REPO in resolved_out.parents:
        raise SystemExit("Choose an --out folder outside the repository.")
    for name in names:
        (out_dir / name).mkdir(parents=True, exist_ok=True)

    providers, label, _, _ = pl._select_bg_device_providers(args.device)
    print(f"Model {args.model} on {label}; {len(images)} image(s), variants: {', '.join(names)}")
    t0 = time.perf_counter()
    session = pl.new_session(args.model, providers=providers)
    print(f"Model loaded in {time.perf_counter() - t0:.1f}s (providers: {pl._active_session_providers(session)})")

    rows: list[dict] = []
    for index, path in enumerate(images, start=1):
        try:
            decoded = pl._open_image_checked(path)
            if pl.has_transparency(decoded):
                print(f"[{index}/{len(images)}] {path.name}: already transparent, skipped")
                continue
            img = pl.limit_input_size(decoded.convert("RGBA"), args.max_px)
            gt = load_ground_truth(args.masks, path, img.size)

            # One model pass per distinct (contrast, stretch) pair; variants that only
            # differ in post-processing share it.
            masks: dict[tuple, tuple[np.ndarray, float]] = {}
            results: dict[str, Image.Image] = {}
            for name, opts in variants:
                key = (opts.contrast_boost, opts.mask_stretch)
                if key not in masks:
                    infer = pl.inference_input(img, opts)
                    t = time.perf_counter()
                    mask_lr = pl.predict_mask(infer, session, args.model, stretch=opts.mask_stretch)
                    masks[key] = (mask_lr, time.perf_counter() - t)
                mask_lr, infer_s = masks[key]

                t = time.perf_counter()
                cutout = pl.cutout_image(img, session, args.model, opts, crop=False, mask_lr=mask_lr)
                post_s = time.perf_counter() - t
                cutout.save(out_dir / name / f"{path.stem}.png", format="PNG")
                results[name] = cutout

                alpha = np.asarray(cutout.getchannel("A"), dtype=np.float32) / 255.0
                rows.append({"image": path.name, "variant": name, "infer_s": round(infer_s, 2),
                             "post_s": round(post_s, 2), **edge_metrics(alpha, gt)})

            contact_sheet(img, results).save(out_dir / f"sheet_{path.stem}.png")
            print(f"[{index}/{len(images)}] {path.name}: ok")
        except Exception as exc:  # keep going; one bad file should not end a long run
            print(f"[{index}/{len(images)}] {path.name}: FAILED ({exc})")

    if not rows:
        print("Nothing was processed.")
        return 1

    columns = ["image", "variant", "infer_s", "post_s", "softpx", "iou", "mae"]
    with (out_dir / "metrics.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, restval="")
        writer.writeheader()
        writer.writerows(rows)

    print(f"\n{'variant':22s} {'infer s':>8s} {'post s':>7s} {'soft px':>9s} {'IoU':>8s} {'MAE':>8s}")
    for name in names:
        mine = [r for r in rows if r["variant"] == name]
        if not mine:
            continue
        mean = lambda key: float(np.mean([r[key] for r in mine if key in r])) if any(key in r for r in mine) else None
        iou, mae = mean("iou"), mean("mae")
        print(f"{name:22s} {mean('infer_s'):8.2f} {mean('post_s'):7.2f} {mean('softpx'):9.0f} "
              f"{'-' if iou is None else f'{iou:8.4f}':>8s} {'-' if mae is None else f'{mae:8.5f}':>8s}")
    print(f"\nCutouts, contact sheets and metrics.csv are in: {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
