@echo off
setlocal
cd /d "%~dp0"
set "CORE_VOICE_PYTHON=%~dp0.voice-venv\Scripts\python.exe"
set "CORE_SETUP_PYTHON=%~dp0..\hy-memory-starter\.venv\Scripts\python.exe"
if exist "%CORE_VOICE_PYTHON%" goto install
if not exist "%CORE_SETUP_PYTHON%" goto launcher
"%CORE_SETUP_PYTHON%" -E -s -m venv "%~dp0.voice-venv"
if errorlevel 1 goto failed
goto install
:launcher
py -3.12 -m venv "%~dp0.voice-venv"
if errorlevel 1 goto failed
:install
"%CORE_VOICE_PYTHON%" -E -s -c "import sys; sys.exit(0 if sys.version_info[:2] == (3, 12) else 1)"
if errorlevel 1 goto failed
"%CORE_VOICE_PYTHON%" -E -s -m pip install --disable-pip-version-check --no-input -r "%~dp0requirements-voice-lock.txt"
if errorlevel 1 goto failed
"%CORE_VOICE_PYTHON%" -E -s -X utf8 "%~dp0setup_voice_models.py"
if errorlevel 1 goto failed
echo Local Chinese and English voice setup completed.
exit /b 0
:failed
echo Voice setup failed. Check Python 3.12 and the network, then run this file again.
exit /b 1
