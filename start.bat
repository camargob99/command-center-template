@echo off
title Command Center
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this again. & pause & exit /b)
start "" http://localhost:4321
node server.js
pause
