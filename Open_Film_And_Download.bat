@echo off
setlocal EnableExtensions
title The Last 24 Hours - Cinematic Film Player

rem Resolve every path from this script's own folder so the launcher works no
rem matter which directory it is invoked from.
set "ROOT=%~dp0"
set "PORT=8080"
set "FILM=%ROOT%THE_LAST_24_HOURS_CINEMATIC_SHORT_FILM.mp4"
set "INDEX=%ROOT%index.html"
set "TARGET=%USERPROFILE%\Downloads\THE_LAST_24_HOURS_CINEMATIC_SHORT_FILM.mp4"

echo ===================================================
echo   THE LAST 24 HOURS - CINEMATIC SHORT FILM
echo ===================================================
echo.

rem ---------------------------------------------------------------- [1] copy
if not exist "%USERPROFILE%\Downloads" mkdir "%USERPROFILE%\Downloads" >nul 2>&1
if exist "%FILM%" (
    copy /Y "%FILM%" "%TARGET%" >nul 2>&1
    if exist "%TARGET%" (
        echo [1] Film copied to your Downloads folder.
    ) else (
        echo [1] WARNING: could not copy the film to Downloads.
    )
) else (
    echo [1] WARNING: the MP4 was not found next to this script.
)
echo.

rem ------------------------------------------------------- [2] show the file
if exist "%TARGET%" (
    echo [2] Opening your Downloads folder...
    explorer /select,"%TARGET%" >nul 2>&1
) else (
    echo [2] Opening the project folder...
    explorer "%ROOT%" >nul 2>&1
)
echo.

rem ------------------------------------------- [3] serve the studio and open
rem The studio is a single self-contained page. A local HTTP server is used
rem when Python is available because it matches how the app is deployed;
rem otherwise the page is opened straight from disk, which also works.
set "PORTBUSY="
netstat -ano 2>nul | findstr /R /C:":%PORT% .*LISTENING" >nul 2>&1 && set "PORTBUSY=1"

if defined PORTBUSY (
    echo [3] Something is already serving port %PORT% - reusing it.
    goto :open_browser
)

set "PY="
for /f "delims=" %%p in ('where py 2^>nul') do if not defined PY set "PY=%%p"
if not defined PY (
    for /f "delims=" %%p in ('where python 2^>nul') do if not defined PY set "PY=%%p"
)

if not defined PY (
    echo [3] Python was not found, opening the studio directly from disk...
    if exist "%INDEX%" (
        start "" "%INDEX%"
        echo.
        echo Done! The studio is open in your browser.
    ) else (
        echo [3] ERROR: index.html is missing from %ROOT%
        pause
        exit /b 1
    )
    goto :done
)

echo [3] Starting a local web server on port %PORT%...
rem Bound to 127.0.0.1 so the project folder is not exposed to the network.
rem pushd lets the child inherit the project folder, which keeps the quoted
rem command to a single invocation (an "cd /d .. &&" form breaks quoting here).
pushd "%ROOT%"
start "CineVoice Studio Server" /min cmd /k ""%PY%" -m http.server %PORT% --bind 127.0.0.1"
popd

rem Wait for the port to accept connections before opening the browser.
set "READY="
for /l %%i in (1,1,25) do (
    netstat -ano 2>nul | findstr /R /C:":%PORT% .*LISTENING" >nul 2>&1 && set "READY=1" && goto :server_ready
    ping -n 2 127.0.0.1 >nul 2>&1
)

:server_ready
if not defined READY (
    echo [3] WARNING: the server did not start in time.
    echo     Opening the studio directly from disk instead...
    if exist "%INDEX%" start "" "%INDEX%"
    goto :done
)

:open_browser
start "" "http://localhost:%PORT%/index.html"
echo     Server is ready at http://localhost:%PORT%/
echo     Close the "CineVoice Studio Server" window to stop it.
echo.

:done
echo Done! Enjoy the film!
pause
endlocal
