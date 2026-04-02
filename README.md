# Image Pipeline

Automated product photo preprocessing and AI upscaling tool.  
Built for batch processing e-commerce product images.

> Copyright (c) 2026 Liudas. Licensed under AGPL-3.0. See LICENSE.

---

## Tools

| Tool | Purpose |
|---|---|
| `pipeline.py` | Automated batch processing |
| `placement_editor.py` | Manual product placement via GUI |

---

## Pipeline flow

1. Reads images from `input/`
2. Removes background using BiRefNet (via rembg)
3. Tight-crops to subject with 4% padding
4. Upscales using Real-ESRGAN NCNN Vulkan binary (GPU-agnostic)
5. Outputs 1440×1440 transparent PNGs
6. Generates 400×400 white-background thumbnails

---

## Output

| File | Description |
|---|---|
| `output/*.png` | 1440×1440 transparent PNG |
| `output/thumbnails/*.png` | 400×400 white background thumbnail |

---

## Requirements

- Python 3.11
- Any GPU with Vulkan support (AMD, NVIDIA, Intel) or CPU fallback
- ~2GB disk space

---

## Setup

```bat
setup.bat
```

Creates venv, installs dependencies, checks for NCNN binary.

---

## Running

```bat
run.bat
```

Menu to choose between batch pipeline or placement editor.

---

## Configuration

Settings at the top of `pipeline.py`:

| Setting | Default | Description |
|---|---|---|
| `FINAL_SIZE` | `1440` | Output image size in pixels |
| `PADDING` | `0.04` | Padding around tight-cropped subject |
| `THUMB_SIZE` | `400` | Thumbnail size in pixels |
| `UPSCALE_FACTOR` | `x4` | Upscale factor — `x2` or `x4` |

---

## AI models used

| Model | Purpose |
|---|---|
| `BiRefNet` (via rembg) | Background removal |
| `realesrgan-ncnn-vulkan` | GPU-agnostic upscaling (x2 or x4) |

Models download automatically on first run.

---

## Portability

Works on any Windows machine with Vulkan-capable GPU. No CUDA required.  
Copy the entire folder and run `setup.bat` on the target machine.

---

## Project structure

```
image-pipeline/
├── pipeline.py                    # batch processing
├── placement_editor.py            # manual placement GUI
├── realesrgan-ncnn-vulkan/        # NCNN binary + models (not committed)
├── weights/                       # model weights (not committed)
├── input/                         # drop images here (not committed)
├── output/                        # results (not committed)
├── venv311/                       # Python venv (not committed)
├── .env                           # local config (not committed)
├── requirements.txt
├── setup.bat
├── run.bat
└── README.md
```

---

## Version history

| Version | Changes |
|---|---|
| v1.0 | Initial script — crop, resize, Real-ESRGAN upscale |
| v1.1 | Rich terminal UI, progress spinners |
| v1.2 | GrabCut interactive background removal (experimental) |
| v1.3 | rembg background removal, `#f5f5f1` fill output |
| v1.4 | BiRefNet model, pad/crop square mode, webp support |
| v1.5 | Cache auto-cleanup, portable `.bat` launcher |
| v2.0 | Placement editor GUI added |
| v3.0 | Switched to NCNN Vulkan binary, dropped PyTorch dependency |
| v3.1 | Pure Pillow I/O, tight-crop normalization, 1440×1440 output, thumbnail generation, x2/x4 upscale option |

---

## Credits

- [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) by Xintao Wang et al. — upscaling model
- [BiRefNet](https://github.com/ZhengPeng7/BiRefNet) by Zheng Peng et al. — background removal model
- [rembg](https://github.com/danielgatis/rembg) by Daniel Gatis — background removal library