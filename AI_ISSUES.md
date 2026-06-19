# AI Issues

## Open Issues
1. Input auto-loads images whenever `inputDir` changes, which is unsafe for large folders and bad while typing.
2. `/api/images` recursively scans the full folder with no limit, pagination, summary, or explicit refresh token.
3. Recent input/output folders are not available in the UI.
4. Refreshing the same selected folder needs explicit UI action instead of relying on path changes.
5. Cross-screen path state is partly root state and partly settings/session state; it needs one reliable active source.
6. Pipeline completion only updates editor settings; it does not pass an explicit completed run handoff to the editor UI.
7. `session.json` is unlinked after successful pipeline completion, which can remove the exact Process-to-Editor handoff metadata.
8. Running multiple batches can preserve stale editor/session path state if output identity changes.
9. Editor final status and path convention still communicate `Editor/final`; the desired final folder convention must be implemented and documented clearly.
10. GPU OOM handling exists for per-image background removal, but CPU fallback setup failures need clearer failure output.
11. UI design cleanup should wait until workflow bugs are stable.

## Already Partly Addressed Before This Pass
- `pipeline.py` has DirectML/CUDA/CPU provider selection.
- `pipeline.py` has GPU OOM detection and per-image CPU retry path.
- `api.py` has pipeline running guard returning HTTP 409.
- `api.py` has `SessionData` fields for `input_dir`, `output_dir`, `src_root`, `source_stage`, and `run_id`.
- `Editor.jsx` can ignore stale sessions by output identity.

## Non-Issues For This Pass
- Electron packaging is intentionally not started.
- Lovable reference app migration is not the first priority.
