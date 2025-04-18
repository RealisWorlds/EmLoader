@echo off
REM Launch multiple agent instances with different profiles
start /MIN cmd /k "node main.js --profiles ./profiles/Clyyde.json"
timeout /t 2
start /MIN cmd /k "node main.js --profiles ./profiles/AceLove.json"
timeout /t 2
start /MIN cmd /k "node main.js --profiles ./profiles/Omniscientius.json"
timeout /t 2
start /MIN cmd /k "node main.js --profiles ./profiles/Becky.json"
timeout /t 2
start /MIN cmd /k "node main.js --profiles ./profiles/Bella.json"
timeout /t 2
start /MIN cmd /k "node main.js --profiles ./profiles/bumblesMcGee.json"
timeout /t 2
start /MIN cmd /k "node main.js --profiles ./profiles/JerryJohnson.json"
timeout /t 2
start /MIN cmd /k "node main.js --profiles ./profiles/Kai.json"
timeout /t 2
start /MIN cmd /k "node main.js --profiles ./profiles/NervousNed.json"
timeout /t 2
start /MIN cmd /k "node main.js --profiles ./profiles/Raven.json"
timeout /t 2
start /MIN cmd /k "node main.js --profiles ./profiles/Sammy.json"
timeout /t 2
start /MIN cmd /k "node main.js --profiles ./profiles/Sebastianleaf.json"
timeout /t 2
start /MIN cmd /k "node main.js --profiles ./profiles/Elon.json"
timeout /t 2
start /MIN cmd /k "node main.js --profiles ./profiles/SleepyJoe.json"
timeout /t 2
start /MIN cmd /k "node main.js --profiles ./profiles/DonaldTramp.json"
timeout /t 2
echo Started multiple agent instances
