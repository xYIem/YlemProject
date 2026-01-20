@echo off
REM Ylem Installer Build Script
REM Builds the standalone exe using PyInstaller

echo ========================================
echo   Building Ylem Installer
echo ========================================
echo.

REM Check if pyinstaller is installed
pip show pyinstaller >nul 2>&1
if errorlevel 1 (
    echo Installing PyInstaller...
    pip install pyinstaller
)

echo.
echo Building exe...
echo.

pyinstaller --onefile --windowed ^
    --name "YlemSetup" ^
    --add-data "templates;templates" ^
    ylem_installer.py

echo.
echo ========================================
if exist "dist\YlemSetup.exe" (
    echo   BUILD SUCCESSFUL!
    echo   Output: dist\YlemSetup.exe
) else (
    echo   BUILD FAILED!
)
echo ========================================
echo.
pause
