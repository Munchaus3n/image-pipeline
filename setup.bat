@echo off
echo ===================================================
echo  Image Pipeline - Setup
echo ===================================================

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Install Python 3.11 from python.org
    pause
    exit /b 1
)

:: Create venv if missing
if not exist venv311 (
    echo Creating virtual environment...
    python -m venv venv311
)

:: Activate
call venv311\Scripts\activate

:: Upgrade pip without looping
python -m pip install --upgrade pip

:: Install requirements — verbose so errors are visible
pip install -r requirements.txt

:: Check NCNN binary
if not exist realesrgan-ncnn-vulkan\realesrgan-ncnn-vulkan.exe (
    echo.
    echo WARNING: realesrgan-ncnn-vulkan.exe not found.
    echo Download from: https://github.com/xinntao/Real-ESRGAN/releases
    echo Place contents in: realesrgan-ncnn-vulkan\
)

echo.
echo Setup complete. Run run.bat to start.
pause
