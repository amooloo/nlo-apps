@echo off
rem NLO Bleach Tray - browser app (check a case in 3D, fix a tooth, re-run). The browser opens by itself.
if not "%~1"=="run" (
  start "NLO Bleach Tray app" cmd /k ""%~f0" run"
  exit /b
)
cd /d "%~dp0"
title NLO Bleach Tray app
call "%~dp0_findpy.bat"
if not defined PY (
  echo  Python 3.13 was not found on this PC. Close this window and double-click install.bat.
  goto :eof
)
"%PY%" run_app.py
echo.
echo  The app stopped. Close this window and double-click start_app.bat to start it again.
