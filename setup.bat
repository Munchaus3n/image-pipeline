@echo off
setlocal EnableDelayedExpansion

REM =============================================================
REM  IMAGE PIPELINE — Setup Script
REM  Run once to create the Python venv and install all deps.
REM  Safe to re-run: existing venv is reused, only missing
REM  packages are installed.
REM =============================================================

set "ROOT=%~dp0"
set "VENV=%ROOT%venv311"
set "PY=py -3.11"

echo.
echo  Image Pipeline ^— Setup
echo  ========================
echo.

REM ── Locate Python 3.11 ────────────────────────────────────────
%PY% --version >nul 2>&1
if errorlevel 1 (
    echo  [ERR] Python 3.11 not found.
    echo        Install from https://www.python.org/downloads/
    echo        and make sure "Add to PATH" is checked.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('%PY% --version 2^>^&1') do set "PYVER=%%v"
echo  Found: !PYVER!
echo.

REM ── Create venv if it doesn't exist ───────────────────────────
if not exist "%VENV%\Scripts\activate.bat" (
    echo  Creating virtual environment at venv311\ ...
    %PY% -m venv "%VENV%"
    if errorlevel 1 (
        echo  [ERR] Failed to create venv. Aborting.
        pause
        exit /b 1
    )
    echo  Done.
) else (
    echo  Virtual environment already exists — skipping creation.
)
echo.

REM ── Activate venv ─────────────────────────────────────────────
call "%VENV%\Scripts\activate.bat"

REM ── Upgrade pip silently ──────────────────────────────────────
echo  Upgrading pip ...
python -m pip install --upgrade pip --quiet
echo.

REM ── Install Python dependencies ───────────────────────────────
echo  Installing Python packages from requirements.txt ...
echo  (This may take several minutes on first run)
echo.
pip install -r "%ROOT%requirements.txt"
if errorlevel 1 (
    echo.
    echo  [ERR] pip install failed. Check the error above.
    echo        Common fixes:
    echo          - Run this script as Administrator
    echo          - Check your internet connection
    echo          - For onnxruntime-directml: requires Windows 10 1903+
    pause
    exit /b 1
)
echo.
echo  Python packages installed.
echo.

REM ── Copy BiRefNet model if needed ─────────────────────────────
set "MODEL_SRC=%USERPROFILE%\.u2net\birefnet-general.onnx"
set "MODEL_DST=%USERPROFILE%\.u2net\birefnet-general.onnx"
if not exist "%MODEL_DST%" (
    echo  NOTE: BiRefNet model not found at:
    echo        %MODEL_DST%
    echo.
    echo        On first pipeline run, rembg will download it automatically.
    echo        (~200MB, requires internet access)
    echo.
)

REM ── Node.js / npm check ───────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo  [WARN] Node.js not found — editor UI will not be available.
    echo         Install from https://nodejs.org/ (LTS recommended)
    echo.
    goto :python_done
)

for /f "tokens=*" %%v in ('node --version 2^>^&1') do set "NODEVER=%%v"
echo  Found Node.js !NODEVER!

REM ── Install editor-ui npm packages ────────────────────────────
if exist "%ROOT%editor-ui\package.json" (
    echo  Installing editor-ui npm packages ...
    cd /d "%ROOT%editor-ui"
    npm install --prefer-offline
    if errorlevel 1 (
        echo.
        echo  [WARN] npm install failed. Run manually:
        echo         cd editor-ui ^&^& npm install
    ) else (
        echo  npm packages installed.
    )
    cd /d "%ROOT%"
) else (
    echo  [WARN] editor-ui\package.json not found — skipping npm install.
)
echo.

:python_done
echo.
echo  ============================================================
echo   Setup complete!
echo  ============================================================
echo.
echo   Start the app:   run.bat
echo   (Starts api.py on :7421 and editor-ui dev server on :5173)
echo.
echo   First pipeline run will download model weights (~200MB).
echo.
pause
endlocal