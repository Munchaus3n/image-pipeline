@echo off
setlocal

REM =============================================================
REM  IMAGE PIPELINE - Setup Script
REM  Run once to create the Python venv and install all deps.
REM  Safe to re-run: existing venv is reused, only missing
REM  packages are installed.
REM =============================================================

set "ROOT=%~dp0"
set "VENV=%ROOT%venv311"
set "VENV_PY=%VENV%\Scripts\python.exe"
set "PY=py -3.11"

echo.
echo  Image Pipeline - Setup
echo  ========================
echo.

REM -- Locate Python 3.11 ----------------------------------------
%PY% --version >nul 2>&1
if errorlevel 1 (
    echo  [ERR] Python 3.11 not found via the "py" launcher.
    echo        Install Python 3.11 from https://www.python.org/downloads/
    echo        and keep "Install Python Launcher" checked.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('%PY% --version 2^>^&1') do set "PYVER=%%v"
echo  Found: %PYVER%
echo.

REM -- Create venv if it doesn't exist ---------------------------
if not exist "%VENV_PY%" (
    echo  Creating virtual environment at venv311\ ...
    %PY% -m venv "%VENV%"
    if errorlevel 1 (
        echo  [ERR] Failed to create venv. Aborting.
        pause
        exit /b 1
    )
    echo  Done.
) else (
    echo  Virtual environment already exists - skipping creation.
)
echo.

REM -- Upgrade pip silently --------------------------------------
REM  Always call the venv's own python so nothing lands in the global install.
echo  Upgrading pip ...
"%VENV_PY%" -m pip install --upgrade pip --quiet
echo.

REM -- Install Python dependencies -------------------------------
echo  Installing Python packages from requirements.txt ...
echo  (This may take several minutes on first run)
echo.
"%VENV_PY%" -m pip install -r "%ROOT%requirements.txt"
if errorlevel 1 (
    echo.
    echo  [ERR] pip install failed. Check the error above.
    echo        Common fixes:
    echo          - Check your internet connection
    echo          - Delete the venv311 folder and run setup.bat again
    echo          - For onnxruntime-directml: requires Windows 10 1903+
    pause
    exit /b 1
)
echo.
echo  Python packages installed.
echo.

REM -- Check for BiRefNet model (no copy step - rembg downloads it itself) --
set "MODEL_DST=%USERPROFILE%\.u2net\birefnet-general.onnx"
if not exist "%MODEL_DST%" (
    echo  NOTE: BiRefNet model not found at:
    echo        %MODEL_DST%
    echo.
    echo        On first pipeline run, rembg will download it automatically.
    echo        ^(about 1 GB, requires internet access^)
    echo.
)

REM -- Node.js / npm check ---------------------------------------
where node >nul 2>&1
if errorlevel 1 (
    echo  [WARN] Node.js not found - editor UI will not be available.
    echo         Install from https://nodejs.org/ ^(LTS recommended^)
    echo.
    goto :python_done
)

for /f "tokens=*" %%v in ('node --version 2^>^&1') do set "NODEVER=%%v"
echo  Found Node.js %NODEVER%

REM -- Install editor-ui npm packages ----------------------------
set "NPM_FAILED="
if exist "%ROOT%editor-ui\package.json" (
    echo  Installing editor-ui npm packages ...
    cd /d "%ROOT%editor-ui"
    REM  npm is npm.cmd: without "call" this script would stop here.
    call npm install --prefer-offline
    if errorlevel 1 (
        set "NPM_FAILED=1"
        echo.
        echo  [WARN] npm install failed. Run manually:
        echo         cd editor-ui ^&^& npm install
    ) else (
        echo  npm packages installed.
    )
    cd /d "%ROOT%"
) else (
    echo  [WARN] editor-ui\package.json not found - skipping npm install.
)
echo.

:python_done
echo.
echo  ============================================================
if defined NPM_FAILED (
    echo   Setup finished with warnings - editor UI packages did not install.
) else (
    echo   Setup complete.
)
echo  ============================================================
echo.
echo   Start the app (two terminals):
echo     1^) venv311\Scripts\python api.py
echo     2^) cd editor-ui ^&^& npm run dev -- --host 127.0.0.1 --port 5173
echo   Then open the Vite URL printed by terminal 2 in your browser.
echo.
if defined NPM_FAILED (
    echo   NOTE: terminal 2 will not work until "cd editor-ui ^&^& npm install" succeeds.
    echo.
)
echo   First pipeline run will download model weights ^(about 1 GB^).
echo.
pause
endlocal
