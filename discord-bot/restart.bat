@echo off
chcp 65001 >nul
echo Stopping Discord Bot...
for /f "tokens=2" %%a in ('wmic process where "CommandLine like '%%discord-bot\\bot.js%%' and Name='node.exe'" get ProcessId /value 2^>nul ^| findstr ProcessId') do (
    echo   Killing PID %%a
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 2 /nobreak >nul
echo Starting Discord Bot...
cd /d "%USERPROFILE%\agent\discord-bot"
start "" /B node bot.js
echo Discord Bot restarted.
