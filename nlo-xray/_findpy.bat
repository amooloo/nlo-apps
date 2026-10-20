@echo off
rem Finds a Python 3.11-3.14 on this PC and sets PY (quoted full path or launcher command).
rem Does not rely on PATH: checks the folders the python.org installer uses, then the py launcher.
set "PY="
for %%V in (313 312 314 311) do call :tryfile "%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe"
for %%V in (313 312 314 311) do call :tryfile "%ProgramFiles%\Python%%V\python.exe"
for %%V in (313 312 314 311) do call :tryfile "C:\Python%%V\python.exe"
for %%V in (313 312 314 311) do call :tryfile "%ProgramFiles(x86)%\Python%%V-32\python.exe"
for %%V in (3.13 3.12 3.14 3.11) do call :trylauncher %%V
if not defined PY python -c "import sys; sys.exit(0 if (3,11)<=sys.version_info[:2]<=(3,14) else 1)" >nul 2>&1 && set "PY=python"
goto :eof

:tryfile
if defined PY goto :eof
if exist "%~1" set "PY=%~1"
goto :eof

:trylauncher
if defined PY goto :eof
py -%~1 -c "import sys" >nul 2>&1 && set "PY=py -%~1"
goto :eof
