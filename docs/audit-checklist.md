# Audit Checklist

Manual verification checklist for path flow, pipeline fallbacks, and editor output routing.

## Preconditions
- Start API server (`api.py`) and frontend (`editor-ui`).
- Ensure test images are available in a known input folder.
- Clear old output/session state if needed.

## 1) Default input + default output
1. Leave both input/output folder fields empty where defaults apply.
2. Run pipeline with both stages enabled.
3. Open Editor.
4. Confirm source is loaded from `./output/processed` or `./output/upscaled` if rembg is off.
5. Save and skip one image each.
6. Confirm files are written under `./output/Editor/final` and `./output/Editor/skipped`.

## 2) Custom input + default output
1. Set a custom input folder, leave output folder empty.
2. Run pipeline.
3. Open Editor.
4. Confirm source comes from default output stages and not stale previous folders.

## 3) Custom input + custom output
1. Set custom input and custom output folders.
2. Run pipeline.
3. Open Editor from Process screen and also by switching to the Editor tab directly.
4. Confirm Editor source resolves to `<customOutput>/processed` when rembg is enabled.
5. Save/skip and confirm writes go to `<customOutput>/Editor/final` and `<customOutput>/Editor/skipped`.

## 4) Upscale only
1. Enable upscale, disable rembg.
2. Run pipeline using a custom output folder.
3. Open Editor.
4. Confirm source resolves to `<customOutput>/upscaled`.

## 5) Remove background only
1. Disable upscale, enable rembg.
2. Run pipeline with populated input.
3. Confirm processed outputs appear in `<output>/processed`.
4. Open Editor and confirm source points to `processed`.

## 6) Both upscale + rembg
1. Enable both stages.
2. Run pipeline.
3. Confirm upscaled files are produced first, then processed files.
4. Confirm Editor loads from `processed`.

## 7) Skip selected image with nested folders
1. In Editor, skip an image from a nested subfolder case.
2. Confirm skipped file is copied into `Editor/skipped` under the same relative path.
3. Confirm no overwrite occurs when two files share the same basename in different subfolders.

## 8) Save final editor image
1. Save one normal item and one combo item.
2. Confirm outputs land in `Editor/final` with expected names.
3. Confirm combo output gets `*_combo.png`.
4. Confirm thumbnails are generated when enabled.

## 9) Restart app / reload UI and restore session
1. Start pipeline, stop partway through.
2. Reload UI and confirm resume prompt appears.
3. Resume and confirm it continues from saved `src_root` and queue index.

## 10) Custom output source routing assertions
1. With custom output and both stages, confirm Editor source is `<customOutput>/processed`.
2. With custom output and upscale-only, confirm Editor source is `<customOutput>/upscaled`.
3. Confirm Editor does not fall back to default `./output` unless no custom output is configured.

## 11) Direct Editor tab before running pipeline
1. Select custom input and custom output folders.
2. Switch directly to Editor before running pipeline.
3. Confirm it either shows a clear empty/no-source state or loads the correct existing custom output.
4. It must not silently load stale default `./output`.

## 12) Change custom output between runs
1. Run once with custom output A.
2. Change output folder to custom output B.
3. Run again.
4. Open Editor.
5. Confirm Editor loads from B, not A or default `./output`.

## 13) Duplicate basenames in nested folders
1. Use two files with the same name in different nested folders.
2. Process them.
3. Save/skip both in Editor.
4. Confirm both outputs exist and neither overwrites the other.

## 14) AVIF Input Support
1. Place at least one `.avif` image in the input folder.
2. Confirm it appears in Input grid and pipeline source/image counts.
3. Run pipeline in `bulk`, then repeat in `clean` (or nested subfolder) mode.
4. Confirm upscale and rembg complete and output files are still written as `.png`.
5. If Pillow lacks AVIF decoding, confirm the user sees:
   `AVIF is listed but Pillow cannot decode this file. Install Pillow with AVIF support or convert to PNG/JPEG.`
