@echo off
REM Launch multiple agent instances with different profiles
start /MIN cmd /k "node main.js --profiles ./profiles/Bella.json"
echo Started multiple agent instances
