# Branch Strategy

Cutout Studio uses one long-term branch: `main`.

- `main` holds the full source: Python API and pipeline, the editor UI, and the Electron desktop shell. The terminal/browser workflow and the desktop app are two ways to run the same code (see the README).
- Work happens on short-lived feature branches cut from `main` and merged back by pull request.
- Releases are marked with tags (for example `v0.2.0`) and published as GitHub Releases with the built installer attached, instead of separate release branches.

Never commit generated output, local settings, cache, virtual environments, `node_modules/`, or build folders.

The earlier `dev/app`, `dev/terminal`, `public/app` and `public/terminal` branches were split copies of the same code. `main` was created from `dev/app` merged with `dev/terminal`, and the old branches were removed in November 2026. Everything from `dev/app`, `dev/terminal`, `design/lovable-redesign-clean` and `local/release-candidate-v1` is part of `main`'s history. The July public releases are kept as the tags `archive/public-app` and `archive/public-terminal`.
