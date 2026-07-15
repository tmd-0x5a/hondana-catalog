@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo 本棚カタログを準備しています...
call npm run build
if errorlevel 1 (
  echo 起動準備に失敗しました。
  pause
  exit /b 1
)

start "" http://127.0.0.1:8080/
echo.
echo 本棚カタログを起動しました。この画面を閉じるとサーバーも終了します。
echo.
node server\index.mjs
pause
