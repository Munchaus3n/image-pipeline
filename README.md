# Cutout Studio Terminal Workflow

Cutout Studio is a local product image workflow for preparing, reviewing, and exporting product photos. This branch runs the Python API and Vite browser UI directly from a checkout.

## Requirements

- Windows with PowerShell
- Python 3.11
- Node.js and npm
- `realesrgan-ncnn-vulkan/` beside `pipeline.py` for upscale runs

## Setup

Create and activate a Python virtual environment:

```powershell
python -m venv venv311
.\venv311\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Install frontend dependencies:

```powershell
cd editor-ui
npm install
cd ..
```

## Run

Start the API from the repository root:

```powershell
python api.py
```

Start the browser UI in another terminal:

```powershell
cd editor-ui
npm run dev -- --host 127.0.0.1 --port 5173
```

Open the Vite URL in your browser. The API listens on `http://127.0.0.1:7421`.

## Local Data

Terminal/browser mode stores development data in this checkout:

- `settings.json`
- `session.json`
- `.cache/`
- `input/`
- `output/`
- `templates_custom.json`
- model caches managed by the Python libraries

Do not commit generated output, cache, local settings, virtual environments, or dependency folders.

## CPU And GPU Modes

Background removal defaults to CPU / Stable. GPU modes are optional:

- CPU / Stable: safest default.
- GPU / Experimental: fastest when GPU dependencies are available.
- GPU + CPU fallback: tries GPU first, then continues on CPU / Stable if GPU cannot run.

First use may download model weights if they are missing from the local model cache.
