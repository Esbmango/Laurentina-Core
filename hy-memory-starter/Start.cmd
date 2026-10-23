@echo off
set PYTHONUTF8=1
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
    if errorlevel 1 goto failed
)
".venv\Scripts\python.exe" -E -s -X utf8 launcher.py
if errorlevel 1 goto failed
exit /b 0
:failed
echo Setup or startup failed. See the message above.
pause
exit /b 1
