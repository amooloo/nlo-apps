@echo off
rem NLO Bleach Tray - stop this PC from starting the app at sign-in (use before moving the app to another PC).
rem Leaves the folder, Python and all files in place.
if not "%~1"=="run" (
  start "NLO Bleach Tray - remove autostart" cmd /k ""%~f0" run"
  exit /b
)
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "NLO Bleach Tray" /f >nul 2>&1
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\NLO Bleach Tray.lnk" >nul 2>&1
echo.
echo  This PC will no longer start NLO Bleach Tray at sign-in.
echo  If the app is running right now, close its black window too.
echo  You can close this window.
echo.
