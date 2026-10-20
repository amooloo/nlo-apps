@echo off
rem NLO X-Ray Reader - one-time setup. Double-click this file.
rem Re-launches itself in a window that stays open, so any message can be read.
if not "%~1"=="run" (
  start "NLO X-Ray Reader - setup" cmd /k ""%~f0" run"
  exit /b
)
cd /d "%~dp0"
title NLO X-Ray Reader - setup
echo.
echo  ===============================================
echo   NLO X-Ray Reader - one-time setup
echo  ===============================================
echo.

rem ---- 1. A Python version the components support (3.11 - 3.14) -------------
call "%~dp0_findpy.bat"
if not defined PY goto :nopython
echo  [1/4] Python found: %PY%

rem ---- 2. Libraries ------------------------------------------------------
echo  [2/4] Installing the app's components (a few minutes, needs internet)...
"%PY%" -m pip install --quiet --disable-pip-version-check --no-warn-script-location -r requirements.txt
if errorlevel 1 goto :pipfail

rem ---- 3. The learning engine (PyTorch, the CPU version: about 125 MB) -----
echo  [3/4] Installing the learning engine (PyTorch, about 125 MB - this is the long one)...
"%PY%" -c "import torch" >nul 2>&1
if not errorlevel 1 (
  echo        Already installed.
  goto :autostartq
)
"%PY%" -m pip install --quiet --disable-pip-version-check --no-warn-script-location torch --index-url https://download.pytorch.org/whl/cpu
if errorlevel 1 "%PY%" -m pip install --quiet --disable-pip-version-check --no-warn-script-location torch
if errorlevel 1 goto :pipfail

:autostartq
echo  [4/4] Done installing.
echo.
set /p "AUTOSTART=  Start the app automatically every time this PC signs in? (y/n): "
if /i "%AUTOSTART%"=="y" call :autostart
echo.
echo  ===============================================
echo   Setup complete.
echo   To start it now: double-click start_app.bat
echo   Then, from any office computer:  http://%COMPUTERNAME%:8766
echo   You can close this window.
echo  ===============================================
echo.
goto :eof

:autostart
"%PY%" tools\make_startup_shortcut.py "%~dp0start_app.bat"
echo  Done - the app will start minimised at sign-in.
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
