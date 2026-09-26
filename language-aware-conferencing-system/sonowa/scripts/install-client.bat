@echo off
rem Sonowa participant PC setup: trust the Sonowa Local CA (run once per PC).
rem Double-click this file. Windows asks for administrator permission (UAC): click Yes.
cd /d "%~dp0"
if not exist "%~dp0ca.crt" (
  echo ca.crt not found. Put ca.crt in the same folder as this file.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File \"%~dp0setup-windows.ps1\" -CaPath \"%~dp0ca.crt\" -ClientOnly'"
