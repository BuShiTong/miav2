@echo off
echo Starting Mia frontend in preview mode...
echo.
echo Open this URL on your phone (same Wi-Fi):
echo   https://YOUR_LOCAL_IP:5173/?preview
echo.
echo Press Ctrl+C to stop.
echo.
cd /d "%~dp0frontend"
npx vite --host
