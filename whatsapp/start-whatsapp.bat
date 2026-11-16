@echo off
title WhatsApp sync (Command Center)
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this again. & pause & exit /b)
rem Stop any copy already running (background or an old window) so this one takes over.
call "%~dp0stop-whatsapp.bat" quiet
rem Not linked yet: run in this window so you can scan the QR code.
if not exist "store\whatsapp.db" (
  echo Scan the QR code with WhatsApp ^(Settings, Linked devices^). Once it says it's connected, close this window and run start-whatsapp.bat again.
  node --experimental-sqlite --no-warnings sync.js
  pause
  exit /b
)
rem Start hidden whenever you sign in to Windows (replaces the old minimized-window shortcut).
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\WhatsApp sync.lnk"
set "VBS=%~dp0run-hidden.vbs"
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK); $s.TargetPath='wscript.exe'; $s.Arguments='\"'+$env:VBS+'\"'; $s.WorkingDirectory=(Split-Path $env:VBS); $s.Save()"
start "" wscript.exe "%VBS%"
echo WhatsApp sync is running in the background. You can close this window.
echo It starts by itself when you sign in. To stop it, run stop-whatsapp.bat.
timeout /t 8 >nul
