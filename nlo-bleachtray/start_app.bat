@echo off
rem NLO Bleach Tray - browser app (check a case in 3D, fix a tooth, re-run). The browser opens by itself.
cd /d "%~dp0"
title NLO Bleach Tray app
set PY=
py -3 --version >nul 2>&1 && set PY=py -3
if not defined PY set PY=python
%PY% run_app.py
pause
