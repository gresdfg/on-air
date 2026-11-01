@echo off
cd /d "%~dp0"
set HOST=0.0.0.0
set PORT=7790
node server.mjs
pause
