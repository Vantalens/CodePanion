@echo off
REM RemindAI 停止脚本

echo ========================================
echo RemindAI v0.2.0 停止脚本
echo ========================================
echo.

echo [1/2] 停止 daemon...
node packages\daemon\dist\index.js stop

echo [2/2] 关闭 GUI...
echo 请手动关闭 GUI 窗口（右键托盘图标 -> 退出）

echo.
echo ========================================
echo RemindAI 已停止
echo ========================================
echo.
pause
