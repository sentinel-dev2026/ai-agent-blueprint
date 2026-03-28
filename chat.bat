@echo off
chcp 65001 >nul
cd /d "%USERPROFILE%\agent"
echo Starting Sentinel...
node sentinel.js
