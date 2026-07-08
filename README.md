# Cutout Studio Terminal Workflow

![License](https://img.shields.io/badge/license-see%20LICENSE-blue)
![Windows](https://img.shields.io/badge/platform-Windows-0078D6)
![Python 3.11](https://img.shields.io/badge/python-3.11-3776AB)
![Browser UI](https://img.shields.io/badge/UI-browser-4B5563)
![Local first](https://img.shields.io/badge/local--first-yes-2E7D32)

Cutout Studio Terminal Workflow is the local terminal/browser version of Cutout Studio for preparing product photos.

## What This Branch Is

- Terminal/browser workflow.
- No Electron desktop shell.
- Runs the Python API manually.
- Runs the Vite browser UI manually.
- Useful for development, debugging, and local workflow testing.

## Setup

```powershell
python -m venv venv311
.\venv311\Scripts\Activate.ps1
python -m pip install -r requirements.txt

cd editor-ui
npm install
cd ..
```

## Run

Terminal 1:

```powershell
python api.py
```

Terminal 2:

```powershell
cd editor-ui
npm run dev -- --host 127.0.0.1 --port 5173
```

Open the Vite URL in your browser. The API listens on `http://127.0.0.1:7421`.

## Workflow

1. Add images or a folder.
2. Review input.
3. Choose processing settings.
4. Run the pipeline.
5. Review results in the editor.
6. Save or export final product images.

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

## Local Data

Terminal/browser mode stores development data in this checkout:

- `settings.json`
- `session.json`
- `.cache/`
- `input/`
- `output/`
- `templates_custom.json`
- model caches managed by Python libraries

Do not commit generated output, cache, local settings, virtual environments, or dependency folders.

## Troubleshooting

- API unavailable: confirm `python api.py` is running and check `http://127.0.0.1:7421`.
- Frontend unavailable: run `npm run dev -- --host 127.0.0.1 --port 5173` from `editor-ui`.
- First run model download: first use may download model weights if they are missing from the local model cache.
- GPU mode fails: use CPU / Stable or GPU + CPU fallback.
- CPU mode is slower but safest.

## Support / Donation

<a href="YOUR_BUY_ME_A_COFFEE_LINK">
  <img src="https://img.shields.io/badge/Buy%20me%20a%20coffee-support-yellow?style=for-the-badge" alt="Buy me a coffee">
</a>

Donations are optional and do not unlock extra features.
