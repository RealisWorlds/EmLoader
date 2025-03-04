@echo off
REM Launch multiple agent instances with different profiles
start cmd /k "node main.js --profiles ./profiles/BobVilaAI.json"
timeout /t 2
start cmd /k "node main.js --profiles ./profiles/Sam.json"
timeout /t 2
start cmd /k "node main.js --profiles ./profiles/Omniscientius.json"
echo Started multiple agent instances
