@echo off
chcp 65001 >nul

echo ============================================================
echo   올리브영 가격 추적기 - Windows 작업 스케줄러 등록 해제
echo ============================================================
echo.

schtasks /delete /tn "OliveYoungPriceTracker" /f

if %ERRORLEVEL% equ 0 (
    echo.
    echo ✅ [성공] 작업 스케줄러에서 삭제되었습니다.
) else (
    echo.
    echo [안내] 등록된 작업이 없거나 이미 삭제되었습니다.
)

echo.
pause
