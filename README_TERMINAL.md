# Cutout Studio Terminal / VS Code Workflow

Use this workflow when running from a local checkout in VS Code, PowerShell, or a browser.

## Requirements

- Windows with PowerShell
- Python 3.11
- Node.js and npm
- Python dependencies from `requirements.txt`
- Frontend dependencies under `editor-ui/node_modules`
- `realesrgan-ncnn-vulkan/` beside `pipeline.py` for upscale runs

## Start The API

From the repository root:

```powershell
python api.py
```

The API listens on:

`http://127.0.0.1:7421`

## Start The Browser UI

In another terminal:

```powershell
cd editor-ui
npm run dev
```

Open the Vite URL shown in the terminal. Browser mode should use the same API and settings endpoints as Electron dev mode.

## Electron Dev Mode

From the repository root:

```powershell
npm run electron:dev
```

This starts Vite on fixed port `5173` and launches Electron. If the port is already in use, stop the old Vite/Electron process before retrying.

## Local Development Data

In terminal/browser development, data currently lives in this checkout:

- `settings.json`
- `session.json`
- `.cache/`
- `input/`
- `output/`
- `templates_custom.json`
- downloaded model caches managed by the Python libraries

Do not commit local data folders, generated output, virtual environments, or dependency folders.

## Troubleshooting

- API unavailable: run `python api.py` and check port `7421`.
- Browser UI unavailable: run `npm run dev` in `editor-ui`.
- Electron dev fails on port `5173`: stop old Vite/Electron processes and retry.
- Background removal is slow: CPU / Stable is the default; GPU modes are opt-in.
- GPU OOM: use CPU / Stable or GPU + CPU fallback.
- Model download appears slow on first use: models may need to download or warm the local cache.
