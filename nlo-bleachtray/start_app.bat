@echo off
rem NLO Tray Maker - browser app (check a case in 3D, fix a tooth, re-run). The browser opens by itself.
if "%~1"=="autostart" (
  start "NLO Tray Maker" /min cmd /k ""%~f0" run --no-browser"
  exit /b
)
if not "%~1"=="run" (
  start "NLO Tray Maker" cmd /k ""%~f0" run"
  exit /b
)
cd /d "%~dp0"
title NLO Tray Maker
call "%~dp0_findpy.bat"
if not defined PY (
  echo  Python 3.13 was not found on this PC. Close this window and double-click install.bat.
  goto :eof
)
echo  Other office computers can open this app in their browser at:   http://%COMPUTERNAME%:8765
echo  (If Windows asks whether to allow Python through the firewall, click Allow.)
echo.
"%PY%" run_app.py --lan %2
echo.
echo  The app stopped. Close this window and double-click start_app.bat to start it again.
