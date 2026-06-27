# AI Test Plan

## Automated Checks
- `python scripts/safe_smoke_test.py`
- `python -m py_compile api.py pipeline.py scripts\safe_smoke_test.py`
- `npm run build` from `editor-ui`
- `npm run lint` from `editor-ui`

## Manual Regression
1. Start `api.py` and `editor-ui` dev server.
2. Select an input folder; confirm no images load until Load is clicked.
3. Click Load; confirm list appears and count is bounded/clear.
4. Click Refresh without changing the folder; confirm list reloads.
5. Use recent input/output dropdowns after browsing or typing paths.
6. Run with custom input and default output; confirm Process uses the selected input.
7. Run with custom input and custom output; confirm Editor loads exact `<output>/processed` when rembg is enabled.
8. Run upscale-only; confirm Editor loads exact `<output>/upscaled`.
9. Run rembg-only; confirm Editor loads exact `<output>/processed`.
10. Run two batches with different output folders; confirm Editor does not load the first run’s source.
11. Save one image; confirm final output lands under `<output>/Editor/`.
12. Skip one image; confirm skipped output lands under `<output>/Editor/skipped`.
13. Save with thumbnails enabled; confirm thumbnail lands under `<output>/Editor/thumbnails/<relative image>.png` with no `thumbnails/400/` nesting.
14. Trigger/observe GPU OOM fallback if hardware allows; otherwise verify clear fallback logs are emitted by code inspection.

## Current Results
- Passed: `python scripts/safe_smoke_test.py`.
- Passed: `python -m py_compile api.py pipeline.py scripts\safe_smoke_test.py`.
- Passed: `npm.cmd install`.
- Passed after sandbox retry: `npm.cmd run build`.
- Passed after lint-only fix: `npm.cmd run lint`.
- Passed: live API/Vite workflow check for Input Load, Refresh, recent folder persistence, Process path preservation, completed session handoff, final save, skipped save, and second output folder run.
- Passed: real local processing validation with isolated PNG inputs, Real-ESRGAN upscale-only, rembg-only on CPU-forced `bria-rmbg`, and one both-stages run.
- Passed: Editor final save to `<output>/Editor/`, skipped save to `<output>/Editor/skipped/`, thumbnail save to `<output>/Editor/thumbnails/`, and second output folder identity.
- Not observed: GPU/DirectML/CUDA OOM. Live run used existing settings with `force_cpu=true` for rembg, so OOM fallback did not trigger.
- Fixed during validation: upscale-only pipeline completion message now points to `<output>/upscaled` instead of `<output>/processed`.

## Batch 1 Results - 2026-06-26
- Passed: `python scripts\safe_smoke_test.py`.
- Passed: `python -m py_compile api.py pipeline.py scripts\safe_smoke_test.py`.
- Passed: `cd editor-ui && npm.cmd install`; npm reported existing audit warnings (1 low, 2 moderate, 1 high), not fixed in this scoped pass.
- Passed: `cd editor-ui && npm.cmd run build`.
- Passed: `cd editor-ui && npm.cmd run lint`.
- Passed: local FastAPI/Vite startup; `/settings`, Vite index, and Vite `/api/settings` proxy returned 200.
- Passed: real same-folder reload after deleting one PNG and adding another PNG; latest `/api/images` omitted the deleted image and included the new image.
- Passed: same-filename nested ID check with `nested-a/same.png` and `nested-b/same.png` as distinct relative IDs.
- Passed: theme settings round-trip for exact `light` and `dark` values.
- Not browser-automated: visual confirmation of thumbnail repaint and localStorage persistence was validated by code path plus build/lint and API settings round-trip; no browser automation dependency was added.

## Batch 2 Results - 2026-06-27
- Passed: `python scripts\safe_smoke_test.py`.
- Passed: `python -m py_compile api.py pipeline.py scripts\safe_smoke_test.py`.
- Passed: `cd editor-ui && npm.cmd install`; npm reported existing audit warnings (1 low, 2 moderate, 1 high), not fixed in this scoped pass.
- Passed: `cd editor-ui && npm.cmd run build`.
- Passed: `cd editor-ui && npm.cmd run lint`.
- Passed: local FastAPI/Vite startup; Vite used `5174` because `5173` was already occupied, and `/api/settings` proxy returned 200.
- Passed: nested queue order probe returned `a/001.png`, `a/002.png`, `b/001.png`, `b/002.png`.
- Passed: final save remained `<output>/Editor/a/001.png`.
- Passed: skipped save remained `<output>/Editor/skipped/a/002.png`.
- Passed: thumbnail save moved to `<output>/Editor/thumbnails/a/001.png`; old `<output>/Editor/thumbnails/400/a/001.png` was not created.
- Not browser-automated: snap highlight reset was validated by code path plus build/lint; no browser automation dependency was added.
