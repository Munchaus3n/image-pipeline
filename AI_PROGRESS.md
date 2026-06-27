# AI Progress

## 2026-06-19

### Inspection
- Confirmed target branch is `design/lovable-redesign-clean`.
- Inspected active backend (`api.py`), processing engine (`pipeline.py`), active Vite UI (`editor-ui/src`), existing smoke script, and existing docs.
- Confirmed no Electron packaging files were added or modified.

### Phase 0 - Tracking Docs
- Added AI tracking docs before code changes.
- Documented architecture, issue list, phase plan, test plan, and handoff notes.

### Phase 1 - Path/State Persistence
- Completed.
- Root React state now owns active `inputDir` and `outputDir`.
- Settings seed paths once on startup; Pipeline no longer overwrites active paths when mounted.
- Recent input/output folders are persisted in `settings.json` and exposed in Input/Process path controls.

### Phase 2 - Folder Loading
- Completed.
- Input no longer auto-loads on `inputDir` edits.
- Added explicit Load and Refresh controls.
- Input folder listing defaults to non-recursive and is capped at 500 visible images.
- Added optional Subfolders toggle for intentional recursive loading.
- `/api/images` now supports `recursive`, `limit`, and `truncated` response metadata.

### Phase 3 - Pipeline-To-Editor Handoff
- Completed.
- Successful pipeline runs keep a completed `session.json` handoff instead of deleting it.
- Session metadata includes exact `input_dir`, `output_dir`, `src_root`, `source_stage`, `run_id`, and `completed`.
- Editor consumes completed pipeline sessions automatically and loads exact `src_root` before fallback detection.

### Phase 4 - Editor Output Structure
- Completed.
- Final editor exports now land directly under `<output>/Editor/`.
- Skipped files remain under `<output>/Editor/skipped/`.
- Thumbnails now land under `<output>/Editor/thumbnails/`.

### Phase 5 - Processing Reliability
- Completed.
- Existing double-run guard remains in FastAPI.
- GPU OOM fallback now reports explicit CPU fallback setup failure instead of failing unclearly.

### Phase 6 - Design Cleanup
- Pending.

### Phase 7 - Manual Regression Test
- Static validation completed.
- `python scripts/safe_smoke_test.py` passed.
- `python -m py_compile api.py pipeline.py scripts\safe_smoke_test.py` passed.
- `git diff --check` passed.
- Frontend build/lint not run because `editor-ui/node_modules` is absent in this checkout.
- Manual app/GPU regression remains pending on a local running app session.

## 2026-06-23

### Validation Pass
- Synced `design/lovable-redesign-clean`; branch was current with `origin/design/lovable-redesign-clean`.
- `python scripts\safe_smoke_test.py` passed.
- `python -m py_compile api.py pipeline.py scripts\safe_smoke_test.py` passed.
- `npm.cmd install` passed and installed 151 packages; npm reported 4 audit vulnerabilities (1 low, 2 moderate, 1 high), not fixed in this scoped validation pass.
- `npm.cmd run build` initially failed inside the sandbox with Vite `spawn EPERM`; rerun outside the sandbox passed.
- `npm.cmd run lint` initially failed on unused `Pipeline.jsx` props/state; fixed only those lint failures.
- Final `npm.cmd run lint` passed.

### Live App Workflow Check
- Started `api.py` and Vite dev server; `/config` returned 200 and Vite index returned 200.
- Input folder load passed through `/images` with `recursive=false`, `limit=500`, `count=2`, `truncated=false`.
- Refresh passed by reloading the same selected folder with the same count.
- Recent folder persistence passed through `settings.json` round-trip for input/output recent folder arrays.
- Process path preservation passed using a controlled no-op pipeline run: completed session retained exact `input_dir`, `output_dir`, `src_root`, and `completed=true`.
- Automatic Editor handoff passed by loading the completed session `src_root` and resolving a 2-image queue.
- Final save passed at `<output-a>/Editor/a.png`.
- Skipped save passed at `<output-a>/Editor/skipped/b.png`.
- Second run with a different output folder passed; completed session and save path moved to `<output-b>/Editor/a.png`.
- Test settings/session were restored and temporary validation folders were removed.

## 2026-06-23 Real Processing Validation

### Automated Checks
- `python scripts\safe_smoke_test.py` passed.
- `python -m py_compile api.py pipeline.py scripts\safe_smoke_test.py` first hit sandbox `__pycache__` write denial, then passed with local write approval.
- `cd editor-ui && npm.cmd install` passed; npm still reports 4 audit vulnerabilities (1 low, 2 moderate, 1 high), not fixed in this scoped pass.
- `cd editor-ui && npm.cmd run build` first hit sandbox `spawn EPERM`, then passed with local process/write approval.
- `cd editor-ui && npm.cmd run lint` passed.

### Real Local Workflow
- Started local FastAPI with `python api.py` and Vite with `npm.cmd run dev -- --host 127.0.0.1`; both responded on `127.0.0.1`.
- Used isolated real PNG inputs under `%TEMP%\image-pipeline-real-validation-20260623-134905\input`, including one nested image.
- Input explicit Load/Refresh passed through `/images`: non-recursive count `2`, refresh count `2`, recursive/Subfolders count `3`.
- Recent input/output folder persistence passed through `/settings` round-trip.
- Real upscale-only run passed with Real-ESRGAN NCNN: session kept exact `input_dir`, `output_dir`, `src_root=<output-a>\upscaled`, `source_stage=upscaled`, `completed=true`, `total=3`.
- Editor source handoff passed by loading the exact completed `src_root` with 3 images.
- Editor final save passed at `%TEMP%\image-pipeline-real-validation-20260623-134905\output-a\Editor\alpha.png`.
- Editor skipped save passed at `%TEMP%\image-pipeline-real-validation-20260623-134905\output-a\Editor\skipped\beta.png`.
- Editor thumbnail passed under the then-current thumbnail convention; Batch 2 later flattened thumbnails to `<output>/Editor/thumbnails/`.
- Second real upscale-only run with a different output folder passed; session moved to `<output-b>\upscaled` and save moved to `<output-b>\Editor\alpha.png`.
- Real rembg-only run passed on CPU-forced `bria-rmbg`; model loaded and wrote `<output-rembg>\processed\alpha.png`.
- Real both-stages run passed on one image; session handoff used `<output-both>\processed`.
- No GPU/DirectML/CUDA OOM occurred during this run, so OOM fallback was not triggered live.
- Test servers were stopped and original `settings.json` / `session.json` state was restored.

### Fixes From Validation
- Fixed `pipeline.py` completion output for upscale-only runs so it reports `<output>\upscaled` instead of misleading users toward `<output>\processed`.
- Re-ran `python -m py_compile api.py pipeline.py scripts\safe_smoke_test.py` and `python scripts\safe_smoke_test.py`; both passed after the fix.

## User Feedback 2026-06-26

### Planning Update
- Added user-feedback bug/design planning only; no fixes were implemented.
- Classified new feedback as behavior bugs, UX cleanup, design cleanup, and product decisions.
- Reordered next phases so behavior bugs come before Process design implementation.
- Defined implementation batches:
  - Batch 1: stale Input thumbnails, exclusion selection bug, exact theme persistence.
  - Batch 2: Editor queue ordering/labels, snap/alignment reset, thumbnail convention.
  - Batch 3: Load/Refresh simplification, unified log/error panel, progress/ETA model, Open Editor styling.
  - Batch 4: Editor design cleanup.
- Electron remains explicitly postponed.

## 2026-06-26 Batch 1 Behavior Fixes

### Code Changes
- Fixed stale Input thumbnails after same-folder refresh by cache-busting `/api/preview` URLs on each load/refresh.
- Fixed same-folder refresh state by pruning selected, excluded, removed, and preview state to the latest loaded image IDs.
- Fixed exclusion exactness by deriving one relative image ID helper and only applying exclusions to currently visible selected IDs.
- Fixed duplicate exclusions from the preview sidebar.
- Fixed theme persistence by initializing from `localStorage`, syncing saved API settings back to `localStorage`, and preserving Settings-screen theme changes locally.
- No Electron work, dependency additions, processing logic changes, or broad redesign were made.

### Automated Validation
- `python scripts\safe_smoke_test.py` passed.
- `python -m py_compile api.py pipeline.py scripts\safe_smoke_test.py` passed.
- `cd editor-ui && npm.cmd install` passed; npm reported existing audit warnings: 1 low, 2 moderate, 1 high.
- `cd editor-ui && npm.cmd run build` passed.
- `cd editor-ui && npm.cmd run lint` passed.

### Local App Validation
- Started FastAPI with `python api.py` and Vite with `npm.cmd run dev -- --host 127.0.0.1`; `/settings`, Vite index, and Vite `/api/settings` proxy returned 200.
- Created a real local PNG folder with 4 images, including `nested-a/same.png` and `nested-b/same.png`.
- Reloaded the same folder after deleting `remove.png` and adding `added.png`; `/api/images` returned 4 current images, `removedGone=true`, and `addedPresent=true`.
- Confirmed distinct relative IDs for same-named nested files: `nested-a/same.png` and `nested-b/same.png`.
- Confirmed settings theme round-trip: saved `light`, read back `light`; saved `dark`, read back `dark`.
- Stopped validation servers and removed temporary validation folders/logs.

## 2026-06-27 Batch 2 Editor Queue/Snap/Thumbnail Fixes

### Code Changes
- Made `/api/images` return a deterministic natural path order for source image lists.
- Added defensive Editor queue sorting by relative path so folders load folder-by-folder and files sort naturally inside each folder.
- Updated Editor item labels to show source-relative context such as `a/001.png` instead of only duplicate filenames.
- Reset transient snap/alignment visual state when loading a source, clearing a source, completing all images, saving/advancing, and skipping/advancing.
- Changed thumbnail output convention to `<output>/Editor/thumbnails/<relative image>.png`; final and skipped output paths are unchanged.
- No Electron work, dependency additions, Process/Input UX cleanup, or broad redesign were made.

### Automated Validation
- `python scripts\safe_smoke_test.py` passed.
- `python -m py_compile api.py pipeline.py scripts\safe_smoke_test.py` passed.
- `cd editor-ui && npm.cmd install` passed; npm reported existing audit warnings: 1 low, 2 moderate, 1 high.
- `cd editor-ui && npm.cmd run build` passed.
- `cd editor-ui && npm.cmd run lint` passed.

### Local App Validation
- Started FastAPI with `python api.py` and Vite with `npm.cmd run dev -- --host 127.0.0.1`; Vite selected port `5174` because `5173` was already in use.
- Confirmed Vite `5174` and proxy `/api/settings` returned 200.
- Created nested real PNGs: `a/001.png`, `a/002.png`, `b/001.png`, `b/002.png`.
- Confirmed `/api/images` returned deterministic folder-by-folder order: `a/001.png`, `a/002.png`, `b/001.png`, `b/002.png`.
- Confirmed final save path remained `<output>/Editor/a/001.png`.
- Confirmed skipped path remained `<output>/Editor/skipped/a/002.png`.
- Confirmed thumbnail path is now `<output>/Editor/thumbnails/a/001.png` and the old `<output>/Editor/thumbnails/400/a/001.png` path was not created.
- Stopped the Batch 2 Vite/API validation processes and removed Batch 2 temporary validation folders/logs.

## 2026-06-27 Safe Smoke Test Review

### Scope
- Reviewed and modernized `scripts/safe_smoke_test.py`.
- Updated `AI_TEST_PLAN.md` to clearly separate static checks, API smoke checks, manual/browser checks, and dangerous real pipeline checks.
- No Electron work, dependency additions, app redesign, or app behavior changes were made.

### Smoke Test Updates
- Static mode remains the safe default and does not call the API, run the pipeline, stop processes, or modify real input/output folders.
- Output is grouped by coverage category so it is clear what was and was not tested.
- API mode now creates sandbox fixtures with nested folders and same-named files.
- API mode verifies deterministic `/images` order, distinct same-name nested files, image limit/truncation, preview rendering, final/skipped/thumbnail output paths, and settings patch/theme round-trips.
- Dangerous pipeline operations remain explicitly not implemented in the smoke test.

### Validation
- Initial updated static smoke run passed with `python scripts\safe_smoke_test.py`.
- Final `python scripts\safe_smoke_test.py` passed in static mode.
- Final `python -m py_compile api.py pipeline.py scripts\safe_smoke_test.py` passed.
- Started local FastAPI with `python api.py` and ran `python scripts\safe_smoke_test.py --api-url http://127.0.0.1:7421 --cleanup`; API mode passed and removed `.smoke-test-sandbox`.
- `cd editor-ui && npm.cmd install` passed; npm reported existing audit warnings: 1 low, 2 moderate, 1 high.
- `cd editor-ui && npm.cmd run build` passed.
- `cd editor-ui && npm.cmd run lint` passed.
- The only issue found during validation was a smoke-test timing bug around asynchronous thumbnail writes; fixed with a bounded wait in the test, with no app behavior change.

## 2026-06-27 Batch 3 Process/Input UX Cleanup

### Code Changes
- Collapsed Input `Load` and `Refresh` into one explicit `Load / Refresh Folder` action; typing or changing folders still does not auto-scan.
- Preserved same-folder refresh behavior by reusing the existing reload path and pruning stale loaded state without resetting the path.
- Replaced the separate Process `Errors` and `Output Log` panels with one `Activity` panel that highlights error lines and keeps expandable context.
- Updated Process progress to report stage steps during two-stage runs, so upscale work is visible before rembg completes.
- Added ETA next to elapsed time in the Process progress metadata.
- Styled the Process `Open Editor` action with the current accent/button language.
- Hid the live preview strip until real preview paths are available, and removed empty filler preview boxes.
- Removed the left-sidebar `Will run` summary block; the existing ready/status card remains the single run summary.
- No Electron work, dependency additions, Editor/output convention changes, processing logic changes, or broad redesign were made.

### Automated Validation
- `python scripts\safe_smoke_test.py` passed.
- `python -m py_compile api.py pipeline.py scripts\safe_smoke_test.py` passed.
- API-mode smoke was skipped because no local API was listening on `127.0.0.1:7421`; the pass did not start a server that would need process termination.
- `cd editor-ui && npm.cmd install` passed; npm reported existing audit warnings: 1 low, 2 moderate, 1 high.
- `cd editor-ui && npm.cmd run build` passed.
- `cd editor-ui && npm.cmd run lint` passed.
