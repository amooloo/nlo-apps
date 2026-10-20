@echo off
rem NLO TAD Guide - stop this PC from starting the app at sign-in (use before moving the app to another PC).
rem Leaves the folder, Python and all files in place.
if not "%~1"=="run" (
  start "NLO TAD Guide - remove autostart" cmd /k ""%~f0" run"
  exit /b
)
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "NLO TAD Guide" /f >nul 2>&1
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\NLO TAD Guide.lnk" >nul 2>&1
echo.
echo  This PC will no longer start NLO TAD Guide at sign-in.
echo  If the app is running right now, close its black window too.
echo  You can close this window.
echo.
