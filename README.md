# Cutout Studio

![License](https://img.shields.io/badge/license-see%20LICENSE-blue)
![Windows](https://img.shields.io/badge/platform-Windows-0078D6)
![Python 3.11](https://img.shields.io/badge/python-3.11-3776AB)
![Electron app](https://img.shields.io/badge/app-Electron-47848F)
![Local first](https://img.shields.io/badge/local--first-yes-2E7D32)
![Status](https://img.shields.io/badge/status-beta-yellow)

Local-first Windows tool for preparing product photos: batch input, background removal, optional upscaling, a placement editor, and export-ready images. Everything runs on your machine.

This repository contains the full source: the Python API and pipeline, the React editor UI, and the Electron desktop shell. You can run it either as a desktop app or as a terminal + browser workflow — both use the same code.

## Project Layout

| Path | What it is |
|---|---|
| `api.py` | FastAPI server the UI talks to (`http://127.0.0.1:7421`) |
| `pipeline.py` | Upscale + background-removal batch pipeline (also runnable on its own) |
| `editor-ui/` | React + Vite UI (Input, Process, Editor, Templates, Settings) |
| `electron/` | Desktop shell: window, native dialogs, backend process manager |
| `scripts/` | Backend build (PyInstaller) and a safe smoke test |
| `realesrgan-ncnn-vulkan/` | Bundled upscaler binary and model weights |
| `templates/`, `templates_custom.json` | Built-in placement templates |
| `docs/` | Cache policy, data locations, branding, review notes |

## Setup

Requires Windows, Python 3.11 (with the `py` launcher) and Node.js.

Easiest: double-click `setup.bat` (creates `venv311`, installs Python and npm packages).

Manual equivalent:

```powershell
py -3.11 -m venv venv311
.\venv311\Scripts\python -m pip install -r requirements.txt

npm install
cd editor-ui
npm install
cd ..
```

## Run As A Desktop App (development)

```powershell
npm run electron:dev
```

This starts the Vite UI and Electron together; Electron starts `api.py` from `venv311` for you.

## Run In Terminal + Browser

Terminal 1:

```powershell
.\venv311\Scripts\python api.py
```

Terminal 2:

```powershell
cd editor-ui
npm run dev -- --host 127.0.0.1 --port 5173
```

Open the Vite URL in your browser.

## Build The Windows App

```powershell
.\venv311\Scripts\python -m pip install pyinstaller
npm run electron:dist:win
```

This builds the UI, freezes the Python backend with PyInstaller, and writes the installer to `dist/`.

## Workflow

1. Add images or a folder.
2. Review input.
3. Choose processing settings.
4. Run the pipeline.
5. Review results in the editor.
6. Save or export final product images.

## Checks Before A Pull Request

```powershell
.\venv311\Scripts\python scripts\safe_smoke_test.py
cd editor-ui
npm run lint
npm run build
```

Do not commit generated output, cache, local settings (`settings.json`, `session.json`), virtual environments, `node_modules/`, or build folders (`dist/`, `backend-dist/`, `backend-build/`).

## Local Data

- Terminal/browser and `electron:dev` mode keep data in this checkout: `settings.json`, `session.json`, `.cache/`, `input/`, `output/`, `templates_custom.json`.
- The packaged app stores data under `%LOCALAPPDATA%\Cutout Studio\` (`config/`, `session/`, `cache/`, `models/`, `logs/`, `exports/`). See [docs/DATA_LOCATIONS.md](docs/DATA_LOCATIONS.md).
- Cache files can be deleted and regenerated. Downloaded models are not auto-deleted, because re-downloads are large.

## Models And Credits

| Project | Purpose | Creator | License note |
|---|---|---|---|
| [BiRefNet](https://github.com/ZhengPeng7/BiRefNet) | Background removal | Peng Zheng et al. | MIT/source license note. Check the upstream project for current terms. |
| [rembg](https://github.com/danielgatis/rembg) | Background removal wrapper | Daniel Gatis | MIT. |
| [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) / [realesrgan-ncnn-vulkan](https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan) | Upscaling | Xintao Wang et al. | BSD-3-Clause. |
| BRIA RMBG-2.0 | Optional background removal | BRIA AI | Non-commercial by default; commercial use requires BRIA permission/license |

## License Notes

- Cutout Studio source license is in [LICENSE](LICENSE).
- Third-party models and tools keep their own licenses, and users are responsible for complying with them. Cutout Studio does not grant extra rights to third-party models or tools.
- BRIA RMBG-2.0 is optional and available for non-commercial use under its upstream license terms. Commercial use requires permission or a commercial license from BRIA AI.
- See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party project links and license notes.

## Troubleshooting

- API unavailable: confirm `.\venv311\Scripts\python api.py` is running and open `http://127.0.0.1:7421/config` (it should return JSON).
- Frontend unavailable: run `npm run dev -- --host 127.0.0.1 --port 5173` from `editor-ui`.
- First run model download: first use may download model weights if they are missing from the local model cache.
- GPU mode fails: use CPU / Stable or GPU + CPU fallback. CPU mode is slower but safest.

## Project Status

Cutout Studio is a beta, local-first Windows app. Expect rough edges, especially around optional GPU processing and first-run model setup.
