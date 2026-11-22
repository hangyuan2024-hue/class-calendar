@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist tools\grid.js.new move /y tools\grid.js.new tools\grid.js >nul
where node >nul 2>nul
if errorlevel 1 goto nonode
node tools\grid.js sign
echo.
pause
exit /b
:nonode
echo Node.js is not installed. Please install the LTS version from https://nodejs.org and run this again.
pause
