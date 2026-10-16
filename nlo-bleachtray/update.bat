@echo off
rem NLO Bleach Tray - get the latest version from GitHub and restart the app. Keeps your settings and the base.
rem Works from inside the app folder, or from anywhere (Downloads, Desktop): it finds the app folder.
if "%~1"=="run" goto :run
set "NLO_APPDIR=%~dp0"
if not exist "%NLO_APPDIR%run_app.py" call :findapp
if not exist "%NLO_APPDIR%run_app.py" (
  echo  Could not find the NLO Bleach Tray app folder on this PC.
  set /p "NLO_APPDIR=  Type the app folder path (e.g. C:\nlo-bleachtray\nlo-bleachtray) and press Enter: "
)
if not "%NLO_APPDIR:~-1%"=="\" set "NLO_APPDIR=%NLO_APPDIR%\"
rem Run a copy of this file from TEMP, so the copy in the app folder can be replaced while it runs.
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
if errorlevel 8 goto :copyfail
call "%NLO_APPDIR%_findpy.bat"
if defined PY "%PY%" -m pip install --quiet --disable-pip-version-check --no-warn-script-location -r requirements.txt
echo  [4/4] Restarting the app...
rem Stop only the app itself: the python process on port 8765 and the cmd window it runs in - never
rem anything picked by window title (that once killed explorer.exe and left a black desktop).
powershell -NoProfile -ExecutionPolicy Bypass -Command "$o=@(); try{$o=Get-NetTCPConnection -LocalPort 8765 -State Listen -EA SilentlyContinue|Select -Expand OwningProcess -Unique}catch{}; foreach($p in $o){ if(-not $p -or $p -le 4){continue}; $pr=Get-Process -Id $p -EA SilentlyContinue; if(-not $pr -or $pr.ProcessName -notmatch '^python'){continue}; $par=$null; try{$par=(Get-CimInstance Win32_Process -Filter ('ProcessId=' + $p) -EA SilentlyContinue).ParentProcessId}catch{}; Stop-Process -Id $p -Force -EA SilentlyContinue; if($par -and $par -gt 4){ $pp=Get-Process -Id $par -EA SilentlyContinue; if($pp -and $pp.ProcessName -eq 'cmd'){Stop-Process -Id $par -Force -EA SilentlyContinue} } }" >nul 2>&1
timeout /t 2 /nobreak >nul
start "" "%NLO_APPDIR%start_app.bat" autostart
rmdir /s /q "%TMPD%" >nul 2>&1
echo.
echo  Updated. The app is running again (minimised window "NLO Bleach Tray").
echo  You can close this window.
echo.
goto :eof

:findapp
for %%D in ("C:\nlo-bleachtray\nlo-bleachtray" "C:\nlo-bleachtray" "C:\NLO\nlo-bleachtray" "%USERPROFILE%\nlo-bleachtray\nlo-bleachtray" "%USERPROFILE%\nlo-bleachtray" "%USERPROFILE%\Desktop\nlo-bleachtray\nlo-bleachtray" "%USERPROFILE%\Desktop\nlo-bleachtray" "%USERPROFILE%\Downloads\nlo-bleachtray\nlo-bleachtray" "D:\nlo-bleachtray\nlo-bleachtray") do (
  if exist "%%~D\run_app.py" set "NLO_APPDIR=%%~D\" & goto :eof
)
goto :eof

:copyfail
echo.
echo  Windows did not allow writing into %NLO_APPDIR%
echo  Right-click update.bat and choose "Run as administrator", then try again.
echo.
goto :eof

:fail
echo.
echo  The update could not be downloaded or unpacked (is the internet on?).
echo  Nothing was changed. Try again later, or take a photo of this window and send it to Dr. Akhavan.
echo.
