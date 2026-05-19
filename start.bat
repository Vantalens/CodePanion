@echo off
REM CodePanion 启动脚本
REM 自动启动 daemon 和 GUI

echo ========================================
echo CodePanion v0.2.0 启动脚本
echo ========================================
echo.

REM 检查 Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [错误] 未找到 Node.js，请先安装 Node.js
    pause
    exit /b 1
)

REM 检查 daemon 构建
if not exist "packages\daemon\dist\index.js" (
    echo [错误] Daemon 未构建，请先运行: npm run build
    pause
    exit /b 1
)

REM 检查 GUI 构建
if not exist "packages\gui\bin\Debug\net8.0-windows\CodePanion.Gui.dll" (
    echo [错误] GUI 未构建，请先运行: dotnet build packages/gui/CodePanion.Gui.csproj
    pause
    exit /b 1
)

echo [1/3] 启动 daemon...
start /B node packages\daemon\dist\index.js start

REM 等待 daemon 启动
timeout /t 3 /nobreak >nul

echo [2/3] 检查 daemon 状态...
node packages\daemon\dist\index.js status
if %ERRORLEVEL% NEQ 0 (
    echo [错误] Daemon 启动失败
    pause
    exit /b 1
)

echo [3/3] 启动 GUI...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\run-gui.ps1
if %ERRORLEVEL% NEQ 0 (
    echo [错误] GUI 启动失败
    pause
    exit /b 1
)

echo.
echo ========================================
echo CodePanion 已启动！
echo ========================================
echo.
echo 提示:
echo - GUI 窗口应该已经打开
echo - 可以最小化到系统托盘
echo - 使用 stop.bat 停止服务
echo.
pause
