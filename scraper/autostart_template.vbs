Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "{DIR}"
WshShell.Run chr(34) & "{DIR}\run_daily_scraper.bat" & chr(34), 1, False
Set WshShell = Nothing
