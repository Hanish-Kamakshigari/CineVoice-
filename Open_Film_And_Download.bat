@echo off
title The Last 24 Hours - Cinematic Film Player
echo ===================================================
echo   THE LAST 24 HOURS - CINEMATIC SHORT FILM
echo ===================================================
echo.
echo [1] Copying master MP4 to your Downloads folder...
copy /Y "THE_LAST_24_HOURS_CINEMATIC_SHORT_FILM.mp4" "%USERPROFILE%\Downloads\THE_LAST_24_HOURS_CINEMATIC_SHORT_FILM.mp4"
echo.
echo [2] Opening your Downloads folder...
explorer /select,"%USERPROFILE%\Downloads\THE_LAST_24_HOURS_CINEMATIC_SHORT_FILM.mp4"
echo.
echo [3] Opening the Cinematic Web Player in your browser...
start http://localhost:8080/
echo.
echo Done! Enjoy the film!
pause
