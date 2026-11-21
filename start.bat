@echo off
title MediMate Fullstack Server (SQLite)
cd /d "%~dp0"

echo =======================================================
echo    Starting MediMate Fullstack Application...
echo =======================================================

set "NODE_CMD="

if exist "%APPDATA%\Antigravity\bin\agy-node.cmd" (
    set NODE_CMD="%APPDATA%\Antigravity\bin\agy-node.cmd"
) else (
    where agy-node >nul 2>&1
    if not errorlevel 1 (
        set NODE_CMD=agy-node
    ) else (
        where node >nul 2>&1
        if not errorlevel 1 (
            set NODE_CMD=node
        )
    )
)

if "%NODE_CMD%"=="" (
    echo [ERROR] Neither Node.js nor agy-node was found.
    echo Please ensure Node.js is installed or Antigravity runtime is available.
    pause
    exit /b 1
)

start http://localhost:3000
%NODE_CMD% server.js

pause
