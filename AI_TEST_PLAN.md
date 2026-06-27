# AI Test Plan

## Smoke Test Modes

### Static Mode
Run:
`python scripts\safe_smoke_test.py`

Static mode is the safe default. It does not call the API, run the pipeline, stop processes, or modify real input/output folders.

It checks:
- Required source files exist.
- Removed preflight routes and broad process-kill patterns are absent.
- Electron remains postponed in frontend package metadata.
- Supported image extensions stay aligned between `api.py` and `pipeline.py`.
- Generated local files such as `session.json` and `.cache/` remain ignored.
- Input loading remains explicit/bounded and still uses relative image IDs.
- Editor queue sorting/relative labels remain present.
- Old output conventions are not reintroduced: no `<output>/Editor/final` and no `thumbnails/400`.
- Completed pipeline session handoff markers remain present.
- Settings POST still uses patch/merge behavior.
- Theme persistence hooks remain present.

### API Mode
Run with local API already running:
`python scripts\safe_smoke_test.py --api-url http://127.0.0.1:7421 --cleanup`

API mode creates sandbox fixtures under `.smoke-test-sandbox` by default and removes them when `--cleanup` is used.

It checks:
- `/images` returns deterministic folder-by-folder natural order for `a/001.png`, `a/002.png`, `b/001.png`, `b/002.png`, `nested-a/same.png`, and `nested-b/same.png`.
- Same-named nested files remain present and distinguishable.
- `/images` honors `limit` and reports `truncated=true`.
- `/preview` can render a valid sandbox PNG.
- `/save` writes final output to `<output>/Editor/<relative image>.png`.
- `/save` writes thumbnails to `<output>/Editor/thumbnails/<relative image>.png` and does not create `thumbnails/400`.
- `/skip` writes skipped output to `<output>/Editor/skipped/<relative image>`.
- `/settings` theme patches round-trip for `light` and `dark` while preserving top-level settings sections.
- `settings.json` is restored after settings API checks.

### Frontend Build Checks
Run from `editor-ui`:
- `npm install`
- `npm run build`
- `npm run lint`

Use `npm.cmd` on PowerShell if `npm.ps1` is blocked by execution policy.

## Manual/Browser Checks
These remain manual because no browser automation dependency is allowed:
1. Start `api.py` and the Vite dev server.
2. Select an input folder and confirm no images load until Load is clicked.
3. Click Load; confirm list appears and count is bounded/clear.
4. Click Refresh after folder contents change; confirm stale thumbnails disappear.
5. Use recent input/output dropdowns after browsing or typing paths.
6. Confirm Process preserves selected input/output paths.
7. Run custom output batches and confirm Editor loads exact completed `src_root`.
8. Confirm Editor queue labels are compact and source-relative.
9. Snap/align an image, save, and confirm the next image has no stale snap highlight.
10. Repeat snap reset check with Skip.
11. Run two batches with different output folders; confirm Editor does not reuse the first output.

## Dangerous/Real Pipeline Checks
These are intentionally not automated by `safe_smoke_test.py`:
- Real Real-ESRGAN upscale runs.
- Real rembg/model loading runs.
- GPU/DirectML/CUDA OOM fallback.
- Pipeline cancellation/stop behavior.
- Wipe-input behavior.

Run these only during explicit real local workflow validation with disposable input/output folders.

## Current Results
- Passed: Batch 1 real workflow validation for stale Input thumbnails, exclusion identity, and theme persistence.
- Passed: Batch 2 validation for Editor queue order/labels, snap reset code path, final/skipped output paths, and flattened thumbnail path.
- Passed 2026-06-27 smoke-test review: updated static smoke, Python compile, sandboxed API smoke with `--api-url`, frontend build, and frontend lint.
- Existing npm audit warnings remain: 1 low, 2 moderate, 1 high.
- Remaining smoke-test gaps are intentional: no browser automation, no real pipeline/model runs, no GPU OOM trigger, and no cancellation/stop automation.
