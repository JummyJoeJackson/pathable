@echo off
echo ===================================================
echo Starting Accessibility App (Backend + Frontend)
echo ===================================================

echo [1/2] Launching Flask Backend...
start "Flask Backend" cmd /k "call .venv\Scripts\activate && python backend\main.py"

echo [2/2] Launching Expo Frontend...
cd workspace
echo Installing dependencies if needed...
call npm install
start "Expo Frontend" cmd /k "npx expo start"

echo ===================================================
echo DONE! Check the two new windows that popped up.
echo ===================================================
pause
