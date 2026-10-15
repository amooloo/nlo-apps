@echo off
rem NLO Bleach Tray - zero-click mode. Leave this window open (minimised is fine).
rem Drop scan files into the BleachTray folder; finished orders appear in OrthoFactory.
cd /d "%~dp0"
title NLO Bleach Tray watcher
set PY=
py -3 --version >nul 2>&1 && set PY=py -3
if not defined PY set PY=python
if not exist watch_config.json (
  echo Setup has not been run yet. Double-click install.bat first.
  pause
  exit /b 1
)
%PY% run_watch.py
pause
