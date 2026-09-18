Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
strPath = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = strPath
WshShell.Run chr(34) & strPath & "\run_daily_scraper.bat" & chr(34), 0, False
Set WshShell = Nothing
Set fso = Nothing
