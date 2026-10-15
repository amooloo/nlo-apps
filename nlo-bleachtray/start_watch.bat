@echo off
rem NLO Bleach Tray - zero-click mode. Leave this window open (minimised is fine).
rem Drop scan files into the BleachTray folder; finished orders appear in OrthoFactory.
if not "%~1"=="run" (
  start "NLO Bleach Tray watcher" cmd /k ""%~f0" run"
  exit /b
)
cd /d "%~dp0"
title NLO Bleach Tray watcher
set "PY="
for %%V in (3.13 3.12 3.14 3.11) do if not defined PY py -%%V --version >nul 2>&1 && set "PY=py -%%V"
if not defined PY set "PY=python"
if not exist watch_config.json (
  echo  Setup has not been run yet. Close this window and double-click install.bat first.
  goto :eof
)
%PY% run_watch.py
echo.
echo  The watcher stopped. Close this window and double-click start_watch.bat to start it again.
