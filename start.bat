@echo off
setlocal
cd /d "%~dp0"
title Secret-Tresor
where node >nul 2>&1
if errorlevel 1 (
  echo FEHLER: Node.js ist nicht installiert oder nicht im PATH.
  echo Bitte Node.js LTS von https://nodejs.org installieren.
  pause
  exit /b 1
)
echo [1/2] Installiere / pruefe npm-Pakete ...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo FEHLER: npm install fehlgeschlagen.
  pause
  exit /b 1
)
echo [2/2] Starte lokalen Secret-Tresor ...
node server.js
if errorlevel 1 (
  echo Der Server wurde mit einem Fehler beendet.
  pause
)
endlocal
