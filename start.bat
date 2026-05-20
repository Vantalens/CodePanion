@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
REM CodePanion 开发环境启动脚本
REM 普通用户请直接使用 dist\CodePanion-win-x64\CodePanion.Gui.exe

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo ========================================
echo CodePanion 启动脚本
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 Node.js，请先安装 Node.js
    pause
    exit /b 1
)

set "DAEMON_ENTRY=%ROOT%\packages\daemon\dist\index.js"
if not exist "%DAEMON_ENTRY%" (
    echo [错误] Daemon 未构建：%DAEMON_ENTRY%
    echo         请先运行：npm run build
    pause
    exit /b 1
)

set "GUI_CFG=Debug"
set "GUI_EXE=%ROOT%\packages\gui\bin\Debug\net8.0-windows\CodePanion.Gui.exe"
if not exist "%GUI_EXE%" (
    set "GUI_CFG=Release"
    set "GUI_EXE=%ROOT%\packages\gui\bin\Release\net8.0-windows\CodePanion.Gui.exe"
)
if not exist "%GUI_EXE%" (
    echo [错误] GUI 未构建：未在 Debug 或 Release 目录找到 CodePanion.Gui.exe
    echo         请先运行：npm run gui:build
    pause
    exit /b 1
)

echo [1/3] 启动 daemon...
start "CodePanion Daemon" /B node "%DAEMON_ENTRY%" start

echo [2/3] 等待 daemon 就绪...
set "READY=0"
for /l %%i in (1,1,10) do (
    if !READY!==0 (
        node "%DAEMON_ENTRY%" status >nul 2>nul
        if not errorlevel 1 (
            set "READY=1"
        ) else (
            timeout /t 1 /nobreak >nul
        )
    )
)
if "%READY%"=="0" (
    echo [错误] Daemon 启动失败或未在 10 秒内就绪
    pause
    exit /b 1
)

echo [3/3] 启动 GUI ^(%GUI_CFG%^)...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\run-gui.ps1" -Configuration %GUI_CFG%
if errorlevel 1 (
    echo [错误] GUI 启动失败
    pause
    exit /b 1
)

echo.
echo ========================================
echo CodePanion 已启动！使用 stop.bat 停止服务。
echo ========================================
pause
endlocal
