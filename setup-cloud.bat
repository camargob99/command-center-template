@echo off
cd /d "%~dp0"
node cloud\setup.js %*
pause
