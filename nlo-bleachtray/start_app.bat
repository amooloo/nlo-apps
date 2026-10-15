@echo off
rem NLO Bleach Tray - browser app (check a case in 3D, fix a tooth, re-run). The browser opens by itself.
if not "%~1"=="run" (
  start "NLO Bleach Tray app" cmd /k ""%~f0" run"
  exit /b
)
cd /d "%~dp0"
title NLO Bleach Tray app
set "PY="
for %%V in (3.13 3.12 3.14 3.11) do if not defined PY py -%%V --version >nul 2>&1 && set "PY=py -%%V"
if not defined PY set "PY=python"
%PY% run_app.py
echo.
echo  The app stopped. Close this window and double-click start_app.bat to start it again.
