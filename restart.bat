@echo off
chcp 65001 >nul
echo Stopping Agent A (sentinel.js in agent)...
for /f "tokens=2" %%a in ('wmic process where "CommandLine like '%%agent\\sentinel.js%%' and Name='node.exe'" get ProcessId /value 2^>nul ^| findstr ProcessId') do (
    echo   Killing PID %%a
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 2 /nobreak >nul
echo Starting Agent A...
cd /d "%USERPROFILE%\agent"
start "" /B node sentinel.js
echo Agent A restarted.
