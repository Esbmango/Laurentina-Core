@echo off
if not exist "%~dp0..\hy-memory-starter\.venv\Scripts\pythonw.exe" (
  echo Run Setup.cmd first. / Please install the project environment first.
  pause
  exit /b 1
)
start "" /D "%~dp0" "%~dp0..\hy-memory-starter\.venv\Scripts\pythonw.exe" "%~dp0launch.pyw"
