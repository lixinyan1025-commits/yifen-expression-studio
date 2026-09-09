@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required. Please install Node.js 22.12 or newer.
  pause
  exit /b 1
)
node "%~dp0scripts\launch.mjs"
if errorlevel 1 pause
