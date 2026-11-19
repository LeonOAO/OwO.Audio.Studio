@echo off
rem ========================================================================
rem OwO Audio Studio v1.0.0
rem Launcher\SetupPython.bat
rem ------------------------------------------------------------------------
rem Download the official Windows embeddable Python (no admin rights, no
rem installer, no PowerShell) and extract it into <project>\Python.
rem
rem Tools: curl.exe and tar.exe, built into Windows 10 1803+ and Windows 11.
rem curl on Windows uses Schannel, so certificates trusted by Windows
rem (including corporate SSL inspection) are accepted.
rem
rem Sources are tried in order: python.org first, then public mirrors.
rem Called from Start.bat / FetchEngine.bat; returns errorlevel 0 on success.
rem This file is intentionally pure ASCII.
rem ========================================================================
setlocal
set "ROOT=%~dp0.."
set "MSG=%~dp0Messages"
set "TARGET=%ROOT%\Python"
set "ZIP=%TEMP%\OwOAudioStudio_Python.zip"

type "%MSG%\SetupStart.txt"

rem ---------- Required tools ----------------------------------------------
where curl >nul 2>nul || goto :NoTools
where tar  >nul 2>nul || goto :NoTools

rem ---------- Download (first source that succeeds wins) ------------------
set "GOT="
call :Download "https://www.python.org/ftp/python/3.14.10/python-3.14.10-embed-amd64.zip"
if not defined GOT call :Download "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip"
if not defined GOT call :Download "https://mirrors.huaweicloud.com/python/3.12.10/python-3.12.10-embed-amd64.zip"
if not defined GOT call :Download "https://mirrors.tuna.tsinghua.edu.cn/python/3.12.10/python-3.12.10-embed-amd64.zip"
if not defined GOT goto :DownloadFailed

rem ---------- Extract -----------------------------------------------------
type "%MSG%\SetupExtract.txt"
if exist "%TARGET%" rmdir /s /q "%TARGET%"
mkdir "%TARGET%"
tar -xf "%ZIP%" -C "%TARGET%"
if errorlevel 1 goto :ExtractFailed
del /q "%ZIP%" >nul 2>nul

rem ---------- Verify ------------------------------------------------------
"%TARGET%\python.exe" -c "import sys, ssl, http.server; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>nul
if errorlevel 1 goto :VerifyFailed

type "%MSG%\SetupDone.txt"
"%TARGET%\python.exe" --version
echo.
endlocal
exit /b 0

rem ------------------------------------------------------------------------
rem :Download <url>  Sets GOT=1 when the file downloads and looks like a ZIP.
rem   --ssl-no-revoke : corporate proxies often block revocation checks
rem   --fail          : treat HTTP errors (404, 403) as failures
rem ------------------------------------------------------------------------
:Download
echo %~1
echo.
if exist "%ZIP%" del /q "%ZIP%" >nul 2>nul
curl -L --fail --ssl-no-revoke --retry 2 --connect-timeout 20 -o "%ZIP%" "%~1"
if errorlevel 1 (
    echo.
    exit /b
)
echo.
if not exist "%ZIP%" exit /b
rem A real embeddable package is several MB; reject tiny proxy error pages.
for %%F in ("%ZIP%") do if %%~zF LSS 3000000 exit /b
set "GOT=1"
exit /b

:NoTools
type "%MSG%\SetupNoTools.txt"
endlocal
exit /b 1

:DownloadFailed
if exist "%ZIP%" del /q "%ZIP%" >nul 2>nul
type "%MSG%\SetupDownloadFailed.txt"
endlocal
exit /b 1

:ExtractFailed
type "%MSG%\SetupExtractFailed.txt"
endlocal
exit /b 1

:VerifyFailed
type "%MSG%\SetupVerifyFailed.txt"
endlocal
exit /b 1
