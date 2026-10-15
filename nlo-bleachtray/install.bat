@echo off
rem NLO Bleach Tray - one-time setup. Double-click this file.
rem Re-launches itself in a window that stays open, so any message can be read.
if not "%~1"=="run" (
  start "NLO Bleach Tray - setup" cmd /k ""%~f0" run"
  exit /b
)
cd /d "%~dp0"
title NLO Bleach Tray - setup
echo.
echo  ===============================================
echo   NLO Bleach Tray - one-time setup
echo  ===============================================
echo.

rem ---- 1. Python present? --------------------------------------------------
set "PY="
py -3 --version >nul 2>&1 && set "PY=py -3"
if not defined PY python --version >nul 2>&1 && set "PY=python"
if not defined PY goto :nopython
echo  [1/4] Python found.

rem ---- 2. Libraries ------------------------------------------------------
echo  [2/4] Installing the app's components (2-5 minutes, needs internet)...
%PY% -m pip install --quiet --disable-pip-version-check -r requirements.txt
if errorlevel 1 goto :pipfail

rem ---- 3. Find the Titan folder and the Trimlign base --------------------
set "TITAN="
for %%D in (S O T U V W X Y Z N M L K J I H G F E D) do call :checkdrive %%D
if not defined TITAN (
  echo.
  echo  Could not find the "clinical\3D printing\Titan" folder on any drive.
  set /p "TITAN=  Type the full path of the Titan folder (where Titan exports go) and press Enter: "
)
echo  [3/4] Titan folder: %TITAN%
echo        Learning the Trimlign base from an existing Titan export (about a minute)...
%PY% tools\import_base.py "%TITAN%"
if errorlevel 1 goto :nobase

rem ---- 4. Inbox + settings ----------------------------------------------
for %%I in ("%TITAN%\..") do set "PARENT=%%~fI"
set "INBOX=%PARENT%\BleachTray"
if not exist "%INBOX%" mkdir "%INBOX%"
%PY% tools\write_config.py "%INBOX%" "%TITAN%"
echo  [4/4] Drop folder created: %INBOX%
echo.
set /p "AUTOSTART=  Start the watcher automatically every time this PC signs in? (y/n): "
if /i "%AUTOSTART%"=="y" call :autostart
echo.
echo  ===============================================
echo   Setup complete.
echo   Daily use: drop the scan file into   %INBOX%
echo   To start the watcher now: double-click start_watch.bat
echo   You can close this window.
echo  ===============================================
echo.
goto :eof

:checkdrive
if defined TITAN goto :eof
if exist "%~1:\clinical\3D printing\Titan\." set "TITAN=%~1:\clinical\3D printing\Titan"
goto :eof

:autostart
%PY% tools\make_startup_shortcut.py "%~dp0start_watch.bat"
echo  Done - the watcher will start minimised at sign-in.
goto :eof

:nopython
echo  Python is not installed yet. Python is the free program this app runs on.
echo.
echo  A download page will open. On it:
echo    1. Click the yellow "Download Python" button and run the file it downloads.
echo    2. IMPORTANT: on the first screen tick the box "Add python.exe to PATH".
echo    3. Click "Install Now" and wait for "Setup was successful".
echo  Then close this window and double-click install.bat again.
echo.
start https://www.python.org/downloads/windows/
goto :eof

:pipfail
echo.
echo  Something went wrong installing components. Take a photo of this window and send it to Dr. Akhavan.
goto :eof

:nobase
echo.
echo  Could not find a Titan export with the base in "%TITAN%".
echo  Export any case from Titan with the base, then double-click install.bat again.
goto :eof
