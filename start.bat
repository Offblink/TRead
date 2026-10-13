@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "PORT=8800"
set "URL=http://127.0.0.1:%PORT%/"

rem If the port is already serving, just open the UI.
netstat -ano -p tcp | findstr /c:":%PORT% " | findstr /i "LISTENING" >nul
if not errorlevel 1 goto open

where python >nul 2>&1
if errorlevel 1 goto nopython

echo [TRead] 正在启动服务：%URL% （关闭弹出的窗口即停止服务）
start "TRead server" cmd /k "python -m http.server %PORT% --bind 127.0.0.1"

set /a _tries=0
:wait
ping -n 2 127.0.0.1 >nul
netstat -ano -p tcp | findstr /c:":%PORT% " | findstr /i "LISTENING" >nul
if not errorlevel 1 goto open
set /a _tries+=1
if %_tries% lss 10 goto wait
echo [TRead][ERROR] 服务 10 秒内没有起来，请看弹出窗口里的报错。
pause
exit /b 1

:open
start "" "%URL%"
exit /b 0

:nopython
echo [TRead][ERROR] PATH 里找不到 python。
pause
exit /b 1
