@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup_portable.ps1" %*
if errorlevel 1 (
  echo Setup failed. Read the error above, then run Setup.cmd again.
  pause
  exit /b 1
)
echo Setup completed. Start the app with Start.cmd.
pause
