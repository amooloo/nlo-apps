@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title NLO Bleach Tray - setup
echo.
echo  ===============================================
echo   NLO Bleach Tray - one-time setup
echo  ===============================================
echo.

rem ---- 1. Python present? --------------------------------------------------
set PY=
py -3 --version >nul 2>&1 && set PY=py -3
if not defined PY ( python --version >nul 2>&1 && set PY=python )
if not defined PY (
  echo  Python is not installed yet. Python is the free program this app runs on.
  echo.
  echo  A download page will open. On it:
  echo    1. Click the yellow "Download Python" button and run the file it downloads.
  echo    2. IMPORTANT: on the first screen tick the box "Add python.exe to PATH".
  echo    3. Click "Install Now" and wait for "Setup was successful".
  echo  Then double-click install.bat again.
  echo.
  start https://www.python.org/downloads/windows/
  pause
  exit /b 1
)
echo  [1/4] Python found.

rem ---- 2. Libraries ------------------------------------------------------
echo  [2/4] Installing the app's components (2-5 minutes, needs internet)...
%PY% -m pip install --quiet --disable-pip-version-check -r requirements.txt
if errorlevel 1 (
  echo.
  echo  Something went wrong installing components. Take a photo of this window and send it to Dr. Akhavan.
  pause
  exit /b 1
)

rem ---- 3. Find the Titan folder and the Trimlign base --------------------
set TITAN=
for %%D in (S O T U V W X Y Z N M L K J I H G F E D) do (
  if not defined TITAN if exist "%%D:\clinical\3D printing\Titan\" set TITAN=%%D:\clinical\3D printing\Titan
)
if not defined TITAN (
  echo.
  echo  Could not find the "clinical\3D printing\Titan" folder on any drive.
  set /p TITAN="  Type the full path of the Titan folder (where Titan exports go) and press Enter: "
)
echo  [3/4] Titan folder: %TITAN%
echo        Learning the Trimlign base from an existing Titan export...
%PY% tools\import_base.py "%TITAN%"
if errorlevel 1 (
  echo.
  echo  Could not find a Titan export with the base in that folder. Export any case from Titan with the base, then run install.bat again.
  pause
  exit /b 1
)

rem ---- 4. Inbox + settings ----------------------------------------------
for %%I in ("%TITAN%\..") do set PARENT=%%~fI
set INBOX=%PARENT%\BleachTray
if not exist "%INBOX%" mkdir "%INBOX%"
%PY% -c "import json; json.dump({'inbox': r'%INBOX%', 'titan': r'%TITAN%', 'preset': 'bleaching', 'kind': 'T', 'stage': 0, 'doctor': 'Dr. Amir Akhavan', 'pair_wait': 90}, open('watch_config.json','w'), indent=2)"
echo  [4/4] Drop folder created: %INBOX%
echo.
set /p AUTOSTART="  Start the watcher automatically every time this PC signs in? (y/n): "
if /i "%AUTOSTART%"=="y" (
  powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\NLO Bleach Tray.lnk'); $s.TargetPath='%~dp0start_watch.bat'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save()"
  echo  Done - it will start minimised at sign-in.
)
echo.
echo  ===============================================
echo   Setup complete.
echo   Daily use: drop the scan file into   %INBOX%
echo   To start the watcher now: double-click start_watch.bat
echo  ===============================================
echo.
pause
