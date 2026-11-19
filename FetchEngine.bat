@echo off
rem ========================================================================
rem OwO Audio Studio v1.0.0
rem FetchEngine.bat: download ffmpeg.wasm core into .\Engine (run once)
rem ------------------------------------------------------------------------
rem This file is intentionally pure ASCII.
rem cmd.exe can misread multi-byte UTF-8 text inside .bat files, so all
rem Chinese messages live in Launcher\Messages\*.txt (shown with "type")
rem or are printed by the Python scripts.
rem ========================================================================
setlocal
chcp 65001 >nul
set "APPDIR=%~dp0"
cd /d "%~dp0"
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

rem ------------------------------------------------------------------------
rem Find Python (no PowerShell):
rem   1. Portable Python in .\Python\python.exe
rem   2. py launcher
rem   3. python on PATH (the Microsoft Store stub is rejected by the check)
rem   4. Not found: download portable Python automatically
rem      (Launcher\SetupPython.bat, uses built-in curl.exe and tar.exe)
rem Each candidate must actually run and be version 3.8 or later.
rem ------------------------------------------------------------------------
set "PYEXE="
set "PYARG="
call :FindPython

if not defined PYEXE (
    call "%~dp0Launcher\SetupPython.bat"
    call :FindPython
)

if not defined PYEXE (
    type "%~dp0Launcher\Messages\NoPython.txt"
    pause
    exit /b 1
)

title OwO Audio Studio v1.0.0 - FetchEngine
"%PYEXE%" %PYARG% "%~dp0Launcher\FetchEngine.py" %*
echo.
pause
endlocal
exit /b

rem ------------------------------------------------------------------------
rem :FindPython  Search all candidates in order.
rem ------------------------------------------------------------------------
:FindPython
rem APPDIR is set at the top; %~dp0 is avoided inside called labels.
if exist "%APPDIR%Python\python.exe" call :TryPython "%APPDIR%Python\python.exe" ""
if defined PYEXE exit /b
where py >nul 2>nul && call :TryPython "py" "-3"
if defined PYEXE exit /b
where python >nul 2>nul && call :TryPython "python" ""
exit /b

rem ------------------------------------------------------------------------
rem :TryPython <exe> <arg>
rem Accept the candidate only if it runs and is Python 3.8 or later.
rem ------------------------------------------------------------------------
:TryPython
"%~1" %~2 -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>nul
if not errorlevel 1 (
    set "PYEXE=%~1"
    set "PYARG=%~2"
)
exit /b
