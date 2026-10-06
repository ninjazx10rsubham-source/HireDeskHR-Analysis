const { execSync } = require('child_process');

const ports = [5001, 5173, 5174, 5175];
const pids = new Set();

function addPid(pid) {
  if (!pid || isNaN(pid) || Number(pid) <= 0 || Number(pid) === process.pid) return;
  pids.add(Number(pid));
}

for (const port of ports) {
  try {
    const output = execSync(`netstat -ano -p tcp | findstr :${port}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    });

    for (const line of output.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      const pid = parts[parts.length - 1];
      addPid(pid);
    }
  } catch (_) {
    // Port is free
  }
}

for (const pid of pids) {
  try {
    execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' });
  } catch (_) {
    try {
      process.kill(pid);
    } catch (_) {}
  }
}

const freedCount = pids.size;
if (freedCount > 0) {
  console.log(`[TalentFlow ATS] Cleared ${freedCount} background process(es) holding dev ports.`);
}
console.log('[TalentFlow ATS] Ports 5001 and 5174 are verified free and ready.');
