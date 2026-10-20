@echo off
rem NLO TAD Guide - one-time setup. Double-click this file.
rem Re-launches itself in a window that stays open, so any message can be read.
if not "%~1"=="run" (
  start "NLO TAD Guide - setup" cmd /k ""%~f0" run"
  exit /b
)
cd /d "%~dp0"
title NLO TAD Guide - setup
echo.
echo  ===============================================
echo   NLO TAD Guide - one-time setup
echo  ===============================================
echo.

rem ---- 1. A Python version the components support (3.11 - 3.14) -------------
call "%~dp0_findpy.bat"
if not defined PY goto :nopython
echo  [1/3] Python found: %PY%

rem ---- 2. Libraries ------------------------------------------------------
echo  [2/3] Installing the app's components (2-5 minutes, needs internet)...
"%PY%" -m pip install --quiet --disable-pip-version-check --no-warn-script-location -r requirements.txt
if errorlevel 1 goto :pipfail

rem ---- 3. Start at sign-in? -----------------------------------------------
echo  [3/3] Components installed.
echo.
set /p "AUTOSTART=  Start the app automatically every time this PC signs in? (y/n): "
if /i "%AUTOSTART%"=="y" call :autostart
echo.
echo  ===============================================
echo   Setup complete.
echo   To start it now: double-click start_app.bat
echo   Other office computers open it from the NLO apps home page (TAD Guide card),
echo   or at  http://%COMPUTERNAME%:8767
echo   You can close this window.
echo  ===============================================
echo.
goto :eof

:autostart
"%PY%" tools\make_startup_shortcut.py "%~dp0start_app.bat"
echo  Done - the app will start minimised at sign-in.
goto :eof

:nopython
echo  No Python 3.11 - 3.14 found on this PC (the free program the app runs on).
echo  If Tray Maker runs on this PC, Python is already there - take a photo of this window for Dr. Akhavan.
echo  Pythons that are installed, if any:
py --list 2>nul
dir /b /ad "%LOCALAPPDATA%\Programs\Python" 2>nul
dir /b /ad "%ProgramFiles%\Python*" 2>nul
echo.
echo  To install it: the Python 3.13 installer downloads now (python-3.13.16-amd64.exe, in Downloads).
echo    1. Run it and click "Install Now". (The PATH checkbox is not required.)
echo    2. Wait for "Setup was successful", then close that window.
echo    3. Close this window and double-click install.bat again.
echo.
start https://www.python.org/ftp/python/3.13.16/python-3.13.16-amd64.exe
goto :eof

:pipfail
echo.
echo  Something went wrong installing components. Take a photo of this window and send it to Dr. Akhavan.
goto :eof
