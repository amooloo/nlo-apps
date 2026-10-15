@echo off
rem NLO Bleach Tray - zero-click mode. Put a shortcut to this file in shell:startup to run at sign-in.
cd /d "%~dp0"
title NLO Bleach Tray watcher
python run_watch.py
pause
