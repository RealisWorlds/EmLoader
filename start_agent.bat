@echo off
setlocal enabledelayedexpansion

if "%~1"=="" (
    echo Usage: start_agent.bat [profile_name] [host_mindserver]
    echo   profile_name: Name of the profile file (without path or extension)
    echo   host_mindserver: true or false (default: auto-detect)
    echo.
    echo Examples:
    echo   start_agent.bat BobVilaAI
    echo   start_agent.bat claude false
    echo   start_agent.bat gemini true
    exit /b 1
)

set "PROFILE_NAME=%~1"
set "PROFILE_PATH=./profiles/%PROFILE_NAME%.json"
set "HOST_MINDSERVER=%~2"

if "%HOST_MINDSERVER%"=="" (
    REM Auto-detect if we should host the mindserver by checking if the port is in use
    REM This is a crude check and not as reliable as the Node.js check in main.js
    set "HOST_MINDSERVER=true"
    netstat -an | find ":%MINDSERVER_PORT%" > nul
    if !errorlevel! equ 0 (
        set "HOST_MINDSERVER=false"
        echo Mindserver appears to be running already. This instance will not host the mindserver.
    ) else (
        echo No mindserver detected. This instance will host the mindserver.
    )
)

echo Starting Mindcraft with profile: %PROFILE_NAME%
echo Profile path: %PROFILE_PATH%
echo Host mindserver: %HOST_MINDSERVER%

node main.js --profiles %PROFILE_PATH% --host_mindserver %HOST_MINDSERVER%
