# Evaluation-build plan — Cutout Studio

Goal: produce a separate, time-limited **evaluation build** of the app to share
with colleagues, distinct from the normal **full build**. This is standard
trial-software licensing of the author's own application. Work happens on a
dedicated branch so it never affects full builds.

Base: current `main` at v0.2.0.

---

## 1. Remove the Bria / RMBG model

- Default model is already `birefnet-general` (`pipeline.py:84`); Bria is a
  secondary option.
- Drop the Bria ONNX weight(s) from the bundled models.
- Remove the Bria-specific branch in `predict_mask` (`pipeline.py` ~888) and the
  Bria note in the hole-fill helper (`pipeline.py` ~846).
- Remove Bria from the selectable model list in the UI and in `api.py`.
- Verify `birefnet-general` still runs end to end after removal.

## 2. Time-limited evaluation period

- Evaluation length: 365 days from first launch.
- First launch records a start timestamp under `HKCU\Software\CutoutStudio`
  so it persists across reinstall / app-data deletion.
- Mirror the timestamp in one file under `%LOCALAPPDATA%`. On launch, if either
  the registry value or the file is missing, restore it from the other; when
  both exist, use the earliest recorded start. (Two fixed locations only — no
  scattered or self-recreating files.)
- Monotonic check: also store the latest timestamp ever observed; if the system
  clock is earlier than that, treat elapsed time as not decreasing. This is a
  soft limit against casual clock changes, not tamper-proof — documented as such
  in a code comment.

## 3. Keep evaluation, renewal, and full builds from colliding

- Every build carries a `channel` and, for evaluation builds, a unique `grantId`.
  - `channel = "full"`: no evaluation code path runs at all. A full build is
    never affected by any value an evaluation build wrote.
  - `channel = "eval"`: timestamp stored under
    `HKCU\Software\CutoutStudio\Grants\<grantId>`.
- A newly issued evaluation build uses a new `grantId`, so it reads a fresh
  subkey and starts a new period — the previous (expired) grant is ignored.
- Result: expired eval → full works; expired eval → renewed eval works; no
  cross-contamination, because each grant only reads its own key.

## 4. Behavior when the period ends

- Reuse the app's existing generic "couldn't start" startup-error screen.
  No new UI, no extra diagnostic text — a plain, honest generic failure.

## Scope boundaries (agreed)

- No self-replicating files and no code written specifically to resist
  inspection. Reasons: a purely local check is a soft limit regardless (the app
  is unpacked JavaScript), and self-recreating files get builds flagged as
  malware on colleagues' machines.
- If a check that actually resists a determined user is wanted later, the
  mechanism is server-side activation (the app validates the license against a
  server). That can be designed separately; it is not part of this plan.

## Branch / build

- Branch: `eval-build` off `main`.
- Produce an evaluation `channel=eval` build with a `grantId`; keep the full
  build on its normal channel.
- Do not merge this branch into `main` or the full-build pipeline.
