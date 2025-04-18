@echo off
REM Launch multiple agent instances with different profiles
start /MIN cmd /k "node main.js --profiles ./profiles/Clyyde.json"
timeout /t 5
start /MIN cmd /k "node main.js --profiles ./profiles/AceLove.json"
timeout /t 5
start /MIN cmd /k "node main.js --profiles ./profiles/Omniscientius.json"
timeout /t 5
start /MIN cmd /k "node main.js --profiles ./profiles/Becky.json"
timeout /t 5
start /MIN cmd /k "node main.js --profiles ./profiles/Bella.json"
echo Started multiple agent instances
