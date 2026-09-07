@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================================
echo   올리브영 가격 추적기 - Windows 부팅 시 자동 실행 등록
echo ============================================================
echo.

set "TARGET_DIR=%~dp0"
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS_LINK=%STARTUP_FOLDER%\OliveYoungPriceTracker.vbs"

echo [등록 작업 진행 중...]
echo 1. 시작프로그램 폴더 확인: %STARTUP_FOLDER%

(
    echo Set WshShell = CreateObject^("WScript.Shell"^)
    echo WshShell.CurrentDirectory = "%TARGET_DIR:~0,-1%"
    echo WshShell.Run chr^(34^) ^& "%TARGET_DIR%run_daily_scraper.bat" ^& chr^(34^), 0, False
    echo Set WshShell = Nothing
) > "%VBS_LINK%"

if exist "%VBS_LINK%" (
    echo.
    echo ✅ [성공] Windows 시작프로그램에 성공적으로 등록되었습니다!
    echo.
    echo  - 등록 위치: %VBS_LINK%
    echo  - 동작 방식:
    echo     1) PC가 켜지거나 로그인할 때 백그라운드에서 조용히 실행됩니다.
    echo     2) 오늘 이미 가격을 수집했다면 중복 실행되지 않고 자동 종료됩니다.
    echo     3) 오늘 아직 수집하지 않은 경우에만 12개 카테고리 100위 및 등록 상품의 가격을 수집합니다.
    echo     4) 수집 로그는 scraper\scraper.log 파일에서 확인하실 수 있습니다.
    echo.
    echo  - 자동 실행을 해제하려면 언제든 'remove_autostart.bat'을 실행하세요.
) else (
    echo ❌ [실패] 시작프로그램 등록 중 오류가 발생했습니다.
)

echo.
pause
