Set WshShell = CreateObject("WScript.Shell")
strPath = WshShell.CurrentDirectory
WshShell.Run chr(34) & strPath & "\run_daily_scraper.bat" & chr(34), 0, False
Set WshShell = Nothing
