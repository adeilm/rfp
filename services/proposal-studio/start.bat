@echo off
REM Quickstart script for RFP Slide Deck Studio (Windows)

REM Run from the folder that contains this script
cd /d "%~dp0"

if "%STUDIO_API_KEY%"=="" (
    set "STUDIO_API_KEY=WIN2WIN_FSS_CSTAM_3"
)

set "PORT=%~1"
if "%PORT%"=="" (
    set "PORT=8091"
)

echo ====================================================
echo  Starting RFP Slide Deck Studio on port %PORT%
echo  Web UI:     http://localhost:%PORT%
echo  API Auth:   Include header 'X-API-Key'
echo ====================================================

python server.py %PORT%
