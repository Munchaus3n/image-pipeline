# AI Issues

## Open Issues
1. UI design cleanup should wait until workflow bugs are stable.

## User Feedback 2026-06-26

### Behavior Bug
1. Stale Input thumbnails can remain when photos change inside the same selected folder.
2. Exclude-from-background-removal selection can exclude more than selected or miss selected images.
3. Light/dark mode can flip between app launches; theme must persist exactly.
4. Editor item queue should be stable and folder-by-folder, not random.
5. Editor item labels should include folder/context, not filename only.
6. Snap/alignment color/state does not reset after completing an image.

### UX Cleanup
1. Load and Refresh are effectively the same; keep one clear action or define the difference.
2. Buttons should match the current design language.
3. Open Editor button does not match the Process design.
4. Errors and Output Log duplicate each other; keep one unified activity/log panel with errors highlighted.
5. Live preview boxes should either fill with actual previews or be removed.
6. Processing count appears wrong because completed can stay zero until rembg stage.
7. Add ETA under percent, opposite elapsed time.
8. “Wipe input after run” needs safer wording/location and should remain disabled by default.

### Design Cleanup
1. Editor does not yet match the design language.
2. Editor right sidebar/cards/buttons need cleanup.
3. Editor queue item should show folder/context.
4. Snap/alignment controls need clearer selected/reset state.
5. Editor Output panel should be cleaner.

### Product Decision Needed
1. Thumbnail output convention should avoid unnecessary folder-in-folder nesting; confirm desired convention before implementation.
2. Decide whether Load/Refresh remain separate or collapse into one reload action.
3. Decide whether Process live preview is reliable enough to keep.

## Validation Notes
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
- Electron packaging is intentionally not started.
- Lovable reference app migration is not the first priority.
