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
13. Trigger/observe GPU OOM fallback if hardware allows; otherwise verify clear fallback logs are emitted by code inspection.

## Current Results
- Passed: `python scripts/safe_smoke_test.py`.
- Passed: `python -m py_compile api.py pipeline.py scripts\safe_smoke_test.py`.
- Passed: `npm.cmd install`.
- Passed after sandbox retry: `npm.cmd run build`.
- Passed after lint-only fix: `npm.cmd run lint`.
- Passed: live API/Vite workflow check for Input Load, Refresh, recent folder persistence, Process path preservation, completed session handoff, final save, skipped save, and second output folder run.
- Note: live workflow check used a controlled no-op pipeline run to validate workflow state and export paths without invoking GPU/model processing.
