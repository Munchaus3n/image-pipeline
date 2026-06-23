# AI Issues

## Open Issues
1. UI design cleanup should wait until workflow bugs are stable.

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
