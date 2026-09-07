@echo off
chcp 65001 >nul

echo ============================================================
echo   올리브영 가격 추적기 - Windows 부팅 시 자동 실행 해제
echo ============================================================
echo.

set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS_LINK=%STARTUP_FOLDER%\OliveYoungPriceTracker.vbs"

if exist "%VBS_LINK%" (
    del /f /q "%VBS_LINK%"
    echo ✅ [완료] Windows 시작프로그램에서 자동 실행이 해제되었습니다.
) else (
    echo [안내] 시작프로그램에 등록된 항목이 없습니다.
)

echo.
pause
