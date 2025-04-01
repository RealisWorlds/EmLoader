import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure logs directory exists
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Log update attempt
fs.appendFileSync(path.join(logsDir, 'update.log'), `Update attempt: ${new Date().toISOString()}\n`);

// Execute git pull
exec('git pull origin master', (error, stdout, stderr) => {
  if (error) {
    fs.appendFileSync(path.join(logsDir, 'update.log'), `Error: ${error.message}\n`);
    return;
  }
  if (stderr) {
    fs.appendFileSync(path.join(logsDir, 'update.log'), `Git stderr: ${stderr}\n`);
  }
  fs.appendFileSync(path.join(logsDir, 'update.log'), `Git stdout: ${stdout}\n`);
  fs.appendFileSync(path.join(logsDir, 'update.log'), `Update completed: ${new Date().toISOString()}\n\n`);
});