from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageChops, ImageEnhance, ImageFilter
from scipy.ndimage import binary_fill_holes


@dataclass(slots=True)
class BgQualityConfig:
    crop_padding: float = 0.04
    edge_blur: float = 1.2
    contrast_gain: float = 1.4
    hole_fill_threshold: int = 30
    max_infer_size: int = 1024


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
    if blur_radius <= 0:
        return img
    r, g, b, alpha = img.split()
    inner = alpha.point(lambda p: 255 if p >= 240 else 0)
    blurred = alpha.filter(ImageFilter.GaussianBlur(radius=blur_radius))
    return Image.merge("RGBA", (r, g, b, ImageChops.lighter(blurred, inner)))


def fill_mask_holes(mask: Image.Image, threshold: int = 30) -> Image.Image:
    mask_np = np.array(mask)
    binary = mask_np > threshold
    filled = binary_fill_holes(binary)
    result = np.where(filled & ~binary, 255, mask_np).astype(np.uint8)
    return Image.fromarray(result, mode="L")


def preprocess_for_inference(img: Image.Image, cfg: BgQualityConfig) -> Image.Image:
    infer_img = img
    w, h = img.size
    if max(w, h) > cfg.max_infer_size:
        scale = cfg.max_infer_size / max(w, h)
        infer_img = img.resize(
            (max(1, int(w * scale)), max(1, int(h * scale))),
            Image.LANCZOS,
        )
    infer_rgb = infer_img.convert("RGB")
    if cfg.contrast_gain > 0:
        infer_rgb = ImageEnhance.Contrast(infer_rgb).enhance(cfg.contrast_gain)
    return infer_rgb


def postprocess_mask(mask: Image.Image, output_size: tuple[int, int], cfg: BgQualityConfig) -> Image.Image:
    if mask.size != output_size:
        mask = mask.resize(output_size, Image.BICUBIC)
    return fill_mask_holes(mask, threshold=cfg.hole_fill_threshold)
