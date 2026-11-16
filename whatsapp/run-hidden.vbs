' Runs the WhatsApp sync with no window, and starts it again if it ever stops.
' start-whatsapp.bat launches this, and so does the "WhatsApp sync" shortcut in your Startup folder.
' Its output goes to sync.log next to this file. stop-whatsapp.bat stops it.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
Do
  code = sh.Run("cmd /c node --experimental-sqlite --no-warnings sync.js > sync.log 2>&1", 0, True)
  If code = 3 Then Exit Do ' another copy is already running
  WScript.Sleep 30000
Loop
