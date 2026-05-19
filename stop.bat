@echo off
REM RemindAI 停止脚本

echo ========================================
echo RemindAI v0.2.0 停止脚本
echo ========================================
echo.

echo [1/2] 停止 daemon...
node packages\daemon\dist\index.js stop

echo [2/2] 关闭 GUI...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\stop-gui.ps1

echo.
echo ========================================
echo RemindAI 已停止
echo ========================================
echo.
pause
