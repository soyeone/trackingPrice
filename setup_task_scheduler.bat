@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================================
echo   올리브영 가격 추적기 - Windows 작업 스케줄러 등록
echo ============================================================
echo.

set "TASK_NAME=OliveYoungPriceTracker"
set "BAT_PATH=%~dp0run_daily_scraper.bat"

echo 작업 이름: %TASK_NAME%
echo 실행 대상: %BAT_PATH%
echo.

schtasks /create /tn "%TASK_NAME%" /tr "\"%BAT_PATH%\"" /sc onlogon /f

if %ERRORLEVEL% equ 0 (
    echo.
    echo ✅ [성공] Windows 작업 스케줄러에 등록되었습니다!
    echo    - 트리거: 사용자 로그인(PC 켜질 때)
    echo    - 작업 삭제: remove_task_scheduler.bat 실행
) else (
    echo.
    echo ⚠️ [안내] 작업 스케줄러 등록에 실패한 경우 'setup_autostart.bat'을 사용하시면 관리자 권한 없이 안정적으로 동작합니다.
)

echo.
pause
