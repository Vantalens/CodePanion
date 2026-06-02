@echo off
setlocal EnableExtensions
chcp 65001 >nul
REM CodePanion 停止脚本

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo ========================================
echo CodePanion 停止脚本
echo ========================================
echo.

set "DAEMON_ENTRY=%ROOT%\packages\daemon\dist\index.js"
if exist "%DAEMON_ENTRY%" (
    echo [1/2] 停止 daemon...
    node "%DAEMON_ENTRY%" stop
) else (
    echo [1/2] 跳过 daemon：未找到 %DAEMON_ENTRY%
)

echo [2/2] 关闭 GUI...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\stop-gui.ps1"

echo.
echo ========================================
echo CodePanion 已停止
echo ========================================
pause
endlocal
