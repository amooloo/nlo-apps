@echo off
rem NLO Bleach Tray - get the latest version from GitHub and restart the app. Keeps your settings and the base.
if "%~1"=="run" goto :run
rem Run a copy of this file from TEMP, so the copy in the app folder can be replaced while it runs.
set "NLO_APPDIR=%~dp0"
copy /y "%~f0" "%TEMP%\nlo-bleachtray-update.bat" >nul
start "Updating NLO Bleach Tray" cmd /k ""%TEMP%\nlo-bleachtray-update.bat" run"
exit /b

:run
cd /d "%NLO_APPDIR%"
title Updating NLO Bleach Tray
echo.
echo  ===============================================
echo   NLO Bleach Tray - update
echo  ===============================================
echo.
echo  App folder: %NLO_APPDIR%
set "TMPD=%TEMP%\nlo-bleachtray-update"
rmdir /s /q "%TMPD%" >nul 2>&1
mkdir "%TMPD%"
echo  [1/4] Downloading the latest version...
curl -L -s -o "%TMPD%\main.zip" "https://github.com/amooloo/nlo-apps/archive/refs/heads/main.zip"
if errorlevel 1 goto :fail
echo  [2/4] Unpacking...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Force '%TMPD%\main.zip' '%TMPD%'"
if errorlevel 1 goto :fail
if not exist "%TMPD%\nlo-apps-main\nlo-bleachtray\run_app.py" goto :fail
echo  [3/4] Copying the new files in (settings, the base and finished cases are kept)...
robocopy "%TMPD%\nlo-apps-main\nlo-bleachtray" "%NLO_APPDIR%." /E /XF watch_config.json /XD jobs out samples /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :fail
call "%NLO_APPDIR%_findpy.bat"
if defined PY "%PY%" -m pip install --quiet --disable-pip-version-check --no-warn-script-location -r requirements.txt
echo  [4/4] Restarting the app...
taskkill /F /T /FI "WINDOWTITLE eq NLO Bleach Tray" >nul 2>&1
taskkill /F /T /FI "WINDOWTITLE eq NLO Bleach Tray - *" >nul 2>&1
timeout /t 2 /nobreak >nul
start "" "%NLO_APPDIR%start_app.bat" autostart
rmdir /s /q "%TMPD%" >nul 2>&1
echo.
echo  Updated. The app is running again (minimised window "NLO Bleach Tray").
echo  You can close this window.
echo.
goto :eof

:fail
echo.
echo  The update could not be downloaded or unpacked (is the internet on?).
echo  Nothing was changed. Try again later, or take a photo of this window and send it to Dr. Akhavan.
echo.
