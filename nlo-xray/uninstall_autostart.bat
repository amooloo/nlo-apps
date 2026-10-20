@echo off
rem NLO X-Ray Reader - stop this PC from starting the app at sign-in (before moving the app to another PC).
rem Leaves the folder, the x-rays, the tracings, Python and all files in place.
if not "%~1"=="run" (
  start "NLO X-Ray Reader - remove autostart" cmd /k ""%~f0" run"
  exit /b
)
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "NLO X-Ray Reader" /f >nul 2>&1
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\NLO X-Ray Reader.lnk" >nul 2>&1
echo.
echo  This PC will no longer start NLO X-Ray Reader at sign-in.
echo  If the app is running right now, close its black window too.
echo  You can close this window.
echo.
