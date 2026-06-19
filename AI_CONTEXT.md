# AI Context

## Project
- Repository: `Munchaus3n/image-pipeline`
- Branch: `design/lovable-redesign-clean`
- Current target: stabilize the browser/Vite + FastAPI workflow before any Electron work.
- Explicit non-goal: no Electron main process, preload script, builder config, installer, or packaging implementation in this pass.

## Active app
- Backend entry: `api.py` (`FastAPI`, local-only API on `127.0.0.1:7421`).
- Processing engine: `pipeline.py` (batch upscale/background-removal CLI launched by the API).
- Frontend entry: `editor-ui/src/main.jsx` (Vite/React browser app).
- Active screens: `Input.jsx`, `Pipeline.jsx`, `Editor.jsx`, `Templates.jsx`, `Settings.jsx`.
- Design reference: `lovable-contex/` is a Lovable/shadcn-style reference app, not the active runtime.

## Workflow To Stabilize
1. Input: pick input folder, explicitly load/refresh image list, select exclusions/removals.
2. Process: run `pipeline.py` from FastAPI with reliable `input_dir` and `output_dir`.
3. Editor: load the exact source folder emitted by the completed pipeline session.
4. Export: write final editor output under `<output>/Editor/<final images>` and skipped files under a clear skipped convention.

## Constraints
- Keep FastAPI as the processing source of truth.
- Keep Vite/browser dev mode working.
- `tkinter` browse dialogs are acceptable only as an API boundary that can later be replaced by Electron native dialogs.
- Preserve existing functionality and prior safety fixes.
- Defer UI redesign until workflow bugs are patched.
