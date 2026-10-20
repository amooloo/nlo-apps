@echo off
rem NLO X-Ray Reader - starts the app (the browser opens by itself). Other office computers use http://THIS-PC:8766
if "%~1"=="autostart" (
  start "NLO X-Ray Reader" /min cmd /k ""%~f0" run --no-browser"
  exit /b
)
if not "%~1"=="run" (
  start "NLO X-Ray Reader" cmd /k ""%~f0" run"
  exit /b
)
cd /d "%~dp0"
title NLO X-Ray Reader
call "%~dp0_findpy.bat"
if not defined PY (
  echo  Python 3.13 was not found on this PC. Close this window and double-click install.bat.
  goto :eof
)
echo  Other office computers can open this app in their browser at:   http://%COMPUTERNAME%:8766
echo  (If Windows asks whether to allow Python through the firewall, tick Private networks and click Allow.)
echo.
"%PY%" run_app.py --lan %2
echo.
echo  The app stopped. Close this window and double-click start_app.bat to start it again.
