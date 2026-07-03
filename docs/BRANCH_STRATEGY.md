# Branch Strategy

Cutout Studio will use four long-term branches.

## public/app

Clean production Electron app branch for normal users.

Belongs here:

- Stable packaged app code
- Production app documentation
- Release-ready app configuration
- User-facing app branding

Does not belong here:

- Experimental development changes
- Terminal-only workflows unless required by the packaged app
- Local settings, output, cache, or test data

## public/terminal

Clean production terminal, VS Code, and browser version.

Belongs here:

- Stable `python api.py` workflow
- Stable `editor-ui` browser workflow
- Terminal setup documentation
- Production-ready scripts for local users

Does not belong here:

- Electron packaging experiments
- App installer-only files
- Local settings, output, cache, or test data

## dev/app

Electron app development branch.

Belongs here:

- Packaging work
- Electron shell changes
- App data path migration
- App-specific UI and installer work
- Future bundled Python runtime work

Does not belong here:

- Unrelated terminal-only refactors
- Generated release output unless explicitly required and reviewed

## dev/terminal

Terminal and browser development branch.

Belongs here:

- API development
- Browser UI development
- Pipeline development
- Terminal docs and scripts

Does not belong here:

- Installer-specific changes unless shared code requires them
- Generated output, local settings, cache, or virtual environments

## Current Working Branch

`local/product-foundation-v1` prepares naming, docs, and packaging foundation before final app packaging.
