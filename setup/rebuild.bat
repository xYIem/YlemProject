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

:: Git add, commit, push
echo.
echo Committing and pushing to GitHub...
git add .
git commit -m "Update installer"
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
echo EXE location: %~dp0dist\YlemSetup.exe
echo.
pause
