@echo off
rem Stops the WhatsApp sync (the background copy and any old window copy).
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'wscript.exe' -and $_.CommandLine -like '*run-hidden.vbs*') -or ($_.Name -eq 'node.exe' -and $_.CommandLine -like '*--experimental-sqlite*sync.js*') -or $_.Name -eq 'whatsapp-bridge.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
if /i not "%~1"=="quiet" (echo WhatsApp sync stopped. It starts again next time you sign in, or run start-whatsapp.bat. & pause)
