@echo off
rem GameSystems headset test lab: starts serve.mjs in this console window (README.md). If the lab is already running,
rem serve.mjs says so and exits. Close the window or press Ctrl+C to stop the lab.
chcp 65001 >nul
title GameSystems testlab (Quest 3)
cd /d "%~dp0"
set "NODE=node"
where node >nul 2>nul || set "NODE=%ProgramFiles%\nodejs\node.exe"
"%NODE%" serve.mjs %*
echo.
echo Testlab er stoppet. Tryk en tast for at lukke vinduet.
pause >nul
