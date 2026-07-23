@echo off
chcp 65001 >nul
title VPN Manager
cd /d "%~dp0"

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3456.*LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)

echo.
echo   =========================================
echo     VPN Manager - Starting...
echo   =========================================
echo.
echo   Panel : http://localhost:3456
echo   Sub   : http://localhost:3456/sub
echo.
echo   Press Ctrl+C to stop
echo.

start "" http://localhost:3456
node server.js
pause
