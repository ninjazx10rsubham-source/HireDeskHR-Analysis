const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const urlFile = path.resolve(__dirname, 'current-serveo-url.txt');

function startTunnel() {
  console.log('[TUNNEL] Starting serveo tunnel on port 5174...');
  const child = spawn('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ServerAliveInterval=30',
    '-R', '80:127.0.0.1:5174',
    'serveo.net'
  ]);

  child.stdout.on('data', (data) => {
    const text = data.toString();
    console.log(text);
    const match = text.match(/https:\/\/[a-zA-Z0-9_-]+\.serveousercontent\.com/);
    if (match) {
      console.log('>>> ACTIVE PUBLIC URL:', match[0]);
      fs.writeFileSync(urlFile, match[0], 'utf-8');
    }
  });

  child.stderr.on('data', (data) => {
    console.error(data.toString());
  });

  child.on('close', (code) => {
    console.log(`[TUNNEL] Serveo exited with code ${code}. Reconnecting in 2 seconds...`);
    setTimeout(startTunnel, 2000);
  });
}

startTunnel();
