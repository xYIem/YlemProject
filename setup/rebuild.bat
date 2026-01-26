@echo off
echo ========================================
echo   Ylem Installer Build Script
echo ========================================
echo.

:: Stop any running installer
echo Stopping any running YlemSetup.exe...
taskkill /f /im YlemSetup.exe 2>nul

:: Stop test Docker containers
echo.
echo Stopping test Docker containers...
docker stop ylem-npm ylem-epg-server ylem-game-server 2>nul
docker rm ylem-npm ylem-epg-server ylem-game-server 2>nul

:: Navigate to repo root
cd /d "%~dp0.."

:: Prompt for commit message
echo.
echo ========================================
echo   What changed in this update?
echo ========================================
echo.
set /p COMMIT_MSG="Commit message: "

:: Check if message was provided
if "%COMMIT_MSG%"=="" (
    set COMMIT_MSG=Update installer
)

:: Git add, commit, push
echo.
echo Committing: %COMMIT_MSG%
echo.
git add .
git commit -m "%COMMIT_MSG%"
git push

:: Build the exe
echo.
echo Building YlemSetup.exe...
cd setup
python -m PyInstaller --onefile --windowed --name "YlemSetup" ylem_installer.py

echo.
echo ========================================
echo   Build Complete!
echo ========================================
echo.
echo Commit: %COMMIT_MSG%
echo EXE location: %~dp0dist\YlemSetup.exe
echo.
pause
