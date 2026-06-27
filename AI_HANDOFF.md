# AI Handoff

## Current Source Branch
- `design/lovable-redesign-clean`
- Local work should happen on task branches; Batch 1 behavior fixes were completed on `local/batch1-input-exclude-theme`.

## Current State
- Docs created before code changes.
- Workflow stabilization phases 1-5 are implemented.
- Real local workflow validation completed on 2026-06-23 with FastAPI, Vite, Real-ESRGAN upscale-only, rembg-only, and one both-stages run.
- One validation issue was fixed: upscale-only completion logs now point to `<output>/upscaled`.
- User feedback from 2026-06-26 is documented in `AI_ISSUES.md`, `AI_DESIGN_PLAN.md`, `AI_FIX_PLAN.md`, and `AI_PROGRESS.md`.
- Batch 1 behavior bugs are fixed and validated: stale Input thumbnails, exclusion selection exactness, and exact theme persistence.
- Batch 2 behavior bugs are fixed and validated: Editor queue ordering/labels, snap/alignment reset, and flattened thumbnail output convention.
- Batch 3 Process/Input UX cleanup is fixed and validated: single explicit reload action, unified Activity panel, stage-step progress/ETA, Open Editor styling, hidden empty previews, and removed duplicate `Will run` block.
- Visual foundation shell is implemented: compact Lovable-style sidebar, light/dark tokens, workflow step cards, secondary tabs, and styled theme toggle.
- Input visual pass is implemented: `Input · Review` header, path/search controls, image grid cards, selection toolbar, and preview/details panel now match the shell direction.
- Next implementation should be the Process visual pass only.
- No Electron packaging work has been started.

## Next Agent Instructions
- Continue phases in `AI_FIX_PLAN.md`.
- Update `AI_PROGRESS.md` after each phase.
- Keep changes small; do not commit unless explicitly asked.
- Do not add Electron files or dependencies.
- Prefer deleting/adjusting existing workflow code over adding abstractions.
- Do not start Editor, Templates, or Settings visual redesign before the Process visual pass is completed or explicitly deferred.

## Watchpoints
- Do not let Settings overwrite active path state after mount.
- Do not auto-scan large folders on input typing.
- Do not delete the successful pipeline session before Editor consumes it.
- Do not reintroduce `<output>/Editor/final`; final exports go directly under `<output>/Editor/`.
- Do not reintroduce `<output>/Editor/thumbnails/400`; thumbnails go directly under `<output>/Editor/thumbnails/`.
- Do not let Editor fall back to stale default output when a custom output was just processed.
- Keep browser/Vite dev mode compatible.
