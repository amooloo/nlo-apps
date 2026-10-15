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

rem ---- 1. A Python version the components support (3.11 - 3.14) -------------
call "%~dp0_findpy.bat"
if not defined PY goto :nopython
echo  [1/4] Python found: %PY%

rem ---- 2. Libraries ------------------------------------------------------
echo  [2/4] Installing the app's components (2-5 minutes, needs internet)...
"%PY%" -m pip install --quiet --disable-pip-version-check --no-warn-script-location -r requirements.txt
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
"%PY%" tools\import_base.py "%TITAN%"
if errorlevel 1 goto :nobase

rem ---- 4. Inbox + settings ----------------------------------------------
for %%I in ("%TITAN%\..") do set "PARENT=%%~fI"
set "INBOX=%PARENT%\BleachTray"
if not exist "%INBOX%" mkdir "%INBOX%"
"%PY%" tools\write_config.py "%INBOX%" "%TITAN%"
echo  [4/4] Drop folder created: %INBOX%
echo.
set /p "AUTOSTART=  Start the watcher automatically every time this PC signs in? (y/n): "
if /i "%AUTOSTART%"=="y" call :autostart
echo.
echo  ===============================================
echo   Setup complete.
echo   Daily use: drop the scan file into   %INBOX%
echo   To start it now: double-click start_app.bat
echo   You can close this window.
echo  ===============================================
echo.
goto :eof

:checkdrive
if defined TITAN goto :eof
if exist "%~1:\clinical\3D printing\Titan\." set "TITAN=%~1:\clinical\3D printing\Titan"
goto :eof

:autostart
"%PY%" tools\make_startup_shortcut.py "%~dp0start_app.bat"
echo  Done - the app (watcher + browser app) will start minimised at sign-in.
goto :eof

:nopython
echo  No Python 3.13 found on this PC (the free program the app runs on).
echo  I looked in:
echo     %LOCALAPPDATA%\Programs\Python\Python313
echo     %ProgramFiles%\Python313
echo     C:\Python313
echo  and the "py" launcher. Pythons that are installed, if any:
py --list 2>nul
dir /b /ad "%LOCALAPPDATA%\Programs\Python" 2>nul
dir /b /ad "%ProgramFiles%\Python*" 2>nul
echo.
echo  To install it: the Python 3.13 installer downloads now (python-3.13.16-amd64.exe, in Downloads).
echo    1. Run it and click "Install Now". (The PATH checkbox is not required.)
echo    2. Wait for "Setup was successful", then close that window.
echo    3. Close this window and double-click install.bat again.
echo  A newer Python already installed is fine; both can stay.
echo.
start https://www.python.org/ftp/python/3.13.16/python-3.13.16-amd64.exe
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
