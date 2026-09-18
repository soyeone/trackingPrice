@echo off
chcp 65001 >nul
title 올리브영 가격 자동 수집기

cd /d "%~dp0"
echo ======================================================
echo  올리브영 가격 자동 수집기 실행 중...
echo ======================================================

set "PATH=C:\Program Files\nodejs;C:\Program Files\Git\mingw64\bin;%PATH%"

node scraper/daily_crawler.js %*

if "%~1"=="" (
    echo.
    echo 5초 후 자동으로 창이 닫힙니다...
    ping 127.0.0.1 -n 6 >nul
)
