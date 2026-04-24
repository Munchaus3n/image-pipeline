# Known limitations (web build) vs. Electron behavior

## Currently requires page refresh / manual action (Electron should automate)

- Settings changes such as canvas size, guide opacity, and canvas background do not fully hot-apply to the currently open editor session; re-opening/reloading editor state is required.
- After pipeline completion, routing to Editor works, but if the user is already on the Editor tab a re-init action is still needed (reload button/tab remount).
- `loadSettings` currently uses a `window.focus` sync path for cross-tab refresh behavior; Electron should replace this with direct IPC events from main to renderer.
- `/api/browse` uses Python tkinter folder dialogs. Electron should use `dialog.showOpenDialog` in the main process.

## Works via reload today but should be fixed regardless of Electron

- BUG-07: input dir persistence has to be restored from settings and should not depend on manual re-entry.
- BUG-15: focus-time settings sync must not overwrite in-progress typed paths.
- Theme change persistence is fixed server-side, but editor canvas appearance can still need session refresh depending on when editor state was initialized.
