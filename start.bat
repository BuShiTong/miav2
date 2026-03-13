@echo off
echo Starting Mia...

echo Starting backend...
start "Mia Backend" cmd /k "cd /d %~dp0backend && uvicorn main:app --host 0.0.0.0 --port 8080"

timeout /t 1 /nobreak >nul

echo Starting frontend...
start "Mia Frontend" cmd /k "cd /d %~dp0frontend && npx vite --host"

echo Both servers starting. Close this window anytime.
