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
- Thumbnails now land under `<output>/Editor/thumbnails/<size>/`.

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
