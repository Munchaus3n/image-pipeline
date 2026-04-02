@echo off
call venv311\Scripts\activate

:menu
cls
echo ===================================================
echo  Image Pipeline v3.1
echo ===================================================
echo.
echo  [1] Batch pipeline
echo  [2] Placement editor
echo  [3] Exit
echo.
set /p choice="Select: "

if "%choice%"=="1" (
    python pipeline.py
    goto menu
)
if "%choice%"=="2" (
    python placement_editor.py
    goto menu
)
if "%choice%"=="3" exit /b

goto menu
