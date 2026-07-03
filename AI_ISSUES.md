# AI Issues

## Open Issues
1. UI design cleanup should wait until workflow bugs are stable.
2. Resume live previews may remain absent when a resumed run produces no new `__processing__` preview paths; the UI now collapses the empty live preview area instead of showing large empty placeholders.
3. Electron v1 shell does not yet bundle a Python runtime for external users. The Electron process starts `api.py` with `venv311/Scripts/python.exe` when present, otherwise `python` from PATH, so packaged builds are still internal/local-Python builds until portable Python bundling is added.

## User Feedback 2026-06-26

### Behavior Bug
1. Fixed 2026-06-26: stale Input thumbnails can remain when photos change inside the same selected folder.
2. Fixed 2026-06-26: exclude-from-background-removal selection can exclude more than selected or miss selected images.
3. Fixed 2026-06-26: light/dark mode can flip between app launches; theme must persist exactly.
4. Fixed 2026-06-27: Editor item queue should be stable and folder-by-folder, not random.
5. Fixed 2026-06-27: Editor item labels should include folder/context, not filename only.
6. Fixed 2026-06-27: snap/alignment color/state does not reset after completing an image.

### UX Cleanup
1. Fixed 2026-06-27: Load and Refresh are now one explicit `Load / Refresh Folder` action.
2. Fixed 2026-06-27: Process `Open Editor` button now uses the current Process button language.
3. Fixed 2026-06-27: Errors and Output Log are unified into one Activity panel with highlighted errors and context.
4. Fixed 2026-06-27: Live preview no longer shows empty filler boxes before real preview paths exist.
5. Fixed 2026-06-27: Processing count now reports stage steps so upscale progress is visible before rembg completes.
6. Fixed 2026-06-27: ETA is shown next to elapsed time in the Process progress metadata.
7. Fixed 2026-06-27: the duplicate left-sidebar `Will run` summary block was removed.
8. “Wipe input after run” needs safer wording/location and should remain disabled by default.

### Design Cleanup
1. Fixed 2026-06-28: Editor now uses the current design language with compact top command bar, centered canvas viewport, and flat accordion tools.
2. Fixed 2026-06-28: Editor right sidebar/cards/buttons were cleaned up into slim accordion rows and compact controls.
3. Fixed 2026-06-27 and preserved 2026-06-28: Editor queue item labels show folder/context.
4. Fixed 2026-06-27 and preserved 2026-06-28: snap/alignment state resets after completed images and active snap state remains clear.
5. Fixed 2026-06-28: Editor Output panel was simplified into the compact accordion style.

### Product Decision Needed
1. Fixed 2026-06-27: thumbnail output convention now avoids unnecessary `thumbnails/400/` nesting.
2. Fixed 2026-06-27: Load/Refresh collapsed into one reload action.
3. Fixed 2026-06-27: Process live preview remains, but only renders when real preview paths exist.

## Validation Notes
- Batch 1 behavior fixes were completed on 2026-06-26 on `local/batch1-input-exclude-theme`.
- Batch 1 validation passed safe smoke, Python compile, `npm.cmd install`, frontend build, frontend lint, same-folder image mutation probe, nested same-filename ID probe, and theme settings round-trip.
- Batch 2 behavior fixes were completed on 2026-06-27 on `local/batch2-editor-queue-snap-thumbs`.
- Batch 2 validation passed safe smoke, Python compile, `npm.cmd install`, frontend build, frontend lint, nested queue order probe, final/skipped path probe, and flattened thumbnail path probe.
- Batch 3 UX fixes were completed on 2026-06-27 on `local/batch3-process-input-ux`.
- Batch 3 validation passed safe smoke, Python compile, `npm.cmd install`, frontend build, and frontend lint; API-mode smoke was skipped because no local API server was already running.
- Real local workflow regression completed on 2026-06-23 with isolated PNG inputs.
- Real-ESRGAN upscale-only, rembg-only on CPU-forced `bria-rmbg`, and one both-stages run passed.
- No stale output folder reuse, `<output>/Editor/final` regression, or completed-session handoff failure was found.
- GPU/DirectML/CUDA OOM was not observed during validation, so live fallback behavior remains untriggered in this pass.

## Already Partly Addressed Before This Pass
- `pipeline.py` has DirectML/CUDA/CPU provider selection.
- `pipeline.py` has GPU OOM detection and per-image CPU retry path.
- `api.py` has pipeline running guard returning HTTP 409.
- `api.py` has `SessionData` fields for `input_dir`, `output_dir`, `src_root`, `source_stage`, and `run_id`.
- `Editor.jsx` can ignore stale sessions by output identity.
- Input loading is explicit and bounded.
- Recent input/output folders are persisted.
- Completed pipeline sessions are kept for Editor handoff.
- Editor final exports now write directly under `<output>/Editor/`.

## Non-Issues For This Pass
- Electron packaging v1 has started as a minimal local shell; full portable Python bundling remains out of scope for this pass.
- Electron dev uses fixed Vite port `5173`; if `electron:dev` reports the port is already in use, stop the old Vite process first instead of letting Vite auto-increment to another port.
- API model warmup can download/cache rembg weights ahead of time, but it cannot keep the model loaded for actual processing because Electron runs `pipeline.py` as a subprocess with its own Python process. True instant model reuse requires a future persistent worker process.
- Lovable reference app migration is not the first priority.
