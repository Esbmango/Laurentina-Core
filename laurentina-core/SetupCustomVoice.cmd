@echo off
cd /d "%~dp0"
".voice-venv\Scripts\python.exe" -E -s -X utf8 setup_custom_voice.py
if errorlevel 1 pause
