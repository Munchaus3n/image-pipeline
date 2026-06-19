# AI Handoff

## Current Branch
- `design/lovable-redesign-clean`

## Current State
- Docs created before code changes.
- Workflow stabilization phases 1-5 are implemented.
- Validation is pending.
- No Electron packaging work has been started.

## Next Agent Instructions
- Continue phases in `AI_FIX_PLAN.md`.
- Update `AI_PROGRESS.md` after each phase.
- Keep changes small and commit by phase.
- Do not add Electron files or dependencies.
- Prefer deleting/adjusting existing workflow code over adding abstractions.

## Watchpoints
- Do not let Settings overwrite active path state after mount.
- Do not auto-scan large folders on input typing.
- Do not delete the successful pipeline session before Editor consumes it.
- Do not reintroduce `<output>/Editor/final`; final exports go directly under `<output>/Editor/`.
- Do not let Editor fall back to stale default output when a custom output was just processed.
- Keep browser/Vite dev mode compatible.
