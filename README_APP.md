# Cutout Studio

![License](https://img.shields.io/badge/license-see%20LICENSE-blue)
![Windows](https://img.shields.io/badge/platform-Windows-0078D6)
![Python 3.11](https://img.shields.io/badge/python-3.11-3776AB)
![Electron app](https://img.shields.io/badge/app-Electron-47848F)
![Local first](https://img.shields.io/badge/local--first-yes-2E7D32)
![Status](https://img.shields.io/badge/status-beta-yellow)

Local-first Windows app for preparing product photos:

- batch input
- background removal
- optional upscaling
- review/editor workflow
- export-ready product images

## What It Does

- Imports product images from files or folders.
- Removes backgrounds with local model-backed processing.
- Places products into a consistent crop, padding, and canvas workflow.
- Optionally upscales images when the local upscaler is available.
- Provides review and editor screens before export.
- Keeps project data local to your Windows machine.

## App Workflow

1. Add images or a folder.
2. Review input.
3. Choose processing settings.
4. Run the pipeline.
5. Review results in the editor.
6. Save or export final product images.

## Processing Features

- Background removal.
- Crop, padding, and placement workflow.
- Thumbnails and previews where available.
- CPU / Stable mode as the safest default.
- GPU / Experimental mode as an optional faster path when dependencies work.
- GPU + CPU fallback mode as an optional recovery path.

## Models And Credits

| Project | Purpose | Creator | License note |
|---|---|---|---|
| [BiRefNet](https://github.com/ZhengPeng7/BiRefNet) | Background removal | Peng Zheng et al. | MIT/source license note. Check the upstream project for current terms. |
| [rembg](https://github.com/danielgatis/rembg) | Background removal wrapper | Daniel Gatis | MIT. |
| [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) / [realesrgan-ncnn-vulkan](https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan) | Upscaling | Xintao Wang et al. | BSD-3-Clause. |
| [BRIA RMBG-2.0](https://huggingface.co/briaai/RMBG-2.0) | Optional background removal | BRIA AI | Source-available/non-commercial unless you have a commercial agreement from BRIA. |

## License Notes

- Cutout Studio source license is in [LICENSE](LICENSE).
- Third-party models and tools keep their own licenses.
- Users are responsible for complying with third-party model and tool licenses.
- Cutout Studio does not grant extra rights to third-party models or tools.
- See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party project links and license notes.

## Setup And Build

```powershell
npm install
cd editor-ui
npm install
cd ..
npm run backend:build
npm run electron:dist:win
```

## Local Data

The packaged app stores writable data under:

```text
%LOCALAPPDATA%\Cutout Studio\
```

Expected data areas:

- `config/`
- `session/`
- `cache/`
- `models/`
- `logs/`
- `exports/`

## Cache And Models

Cache files can be deleted and regenerated.

Downloaded models are stored separately and are not auto-deleted, because re-downloads can be large and slow.

## Support / Donation

<a href="YOUR_BUY_ME_A_COFFEE_LINK">
  <img src="https://img.shields.io/badge/Buy%20me%20a%20coffee-support-yellow?style=for-the-badge" alt="Buy me a coffee">
</a>

Donations are optional and do not unlock extra features.

## Project Status

Cutout Studio is a beta, local-first Windows app. Expect rough edges, especially around optional GPU processing and first-run model setup.
