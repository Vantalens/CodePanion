import { readPid, isProcessAlive, clearPid } from '../daemon/pidfile.js';
import { checkHealth } from '../shared/client.js';

export async function stopCommand() {
  const pid = readPid();
  if (!pid) {
    const r = await checkHealth();
    if (!r.ok) {
      console.log('[codepanion] daemon not running');
      return;
    }
  }
  if (pid && isProcessAlive(pid)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (err) {
      console.error(`[codepanion] kill failed: ${(err as Error).message}`);
      process.exit(1);
    }
  }
  for (let i = 0; i < 25; i++) {
    if (!pid || !isProcessAlive(pid)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (pid && isProcessAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
  clearPid();
  console.log('[codepanion] daemon stopped');
}
