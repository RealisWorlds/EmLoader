@echo off
setlocal enabledelayedexpansion

echo Starting multiple Mindcraft instances with different profiles...

REM Get available profile files
echo Available profiles:
set count=0
for %%f in (.\profiles\*.json) do (
    if not "%%~nf"=="defaults" (
        set /a count+=1
        set "profile!count!=%%~nf"
        echo !count!. %%~nf
    )
)

REM Check if any profiles were found
if %count%==0 (
    echo No profile files found in the profiles directory.
    exit /b 1
)

echo.
echo How many instances would you like to run? (1-%count%)
set /p instance_count=

if %instance_count% GTR %count% (
    echo Cannot run more instances than available profiles.
    exit /b 1
)

REM First instance will host the mindserver
set /p first_profile_index=Enter the number for the first profile (will host mindserver): 
if !first_profile_index! LEQ 0 (
    echo Invalid profile number.
    exit /b 1
)
if !first_profile_index! GTR %count% (
    echo Invalid profile number.
    exit /b 1
)

echo Starting first instance with !profile%first_profile_index%! (hosting mindserver)...
start cmd /k "node main.js --profiles ./profiles/!profile%first_profile_index%!.json --host_mindserver true"

REM Wait to ensure the first instance has time to start the mindserver
timeout /t 5

REM Start additional instances
set instances_started=1
:start_additional
if %instances_started% GEQ %instance_count% goto :done

set /a instances_started+=1
set /p next_profile_index=Enter the number for instance #%instances_started%: 
if !next_profile_index! LEQ 0 (
    echo Invalid profile number.
    goto start_additional
)
if !next_profile_index! GTR %count% (
    echo Invalid profile number.
    goto start_additional
)

echo Starting instance #%instances_started% with !profile%next_profile_index%!...
start cmd /k "node main.js --profiles ./profiles/!profile%next_profile_index%!.json --host_mindserver false"

REM Wait between starting instances
timeout /t 2

goto :start_additional

:done
echo All %instance_count% instances started successfully!
