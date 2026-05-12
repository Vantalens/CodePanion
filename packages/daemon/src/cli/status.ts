import { checkHealth } from '../shared/client.js';
import { loadConfig } from '../config.js';

export async function statusCommand() {
  const cfg = loadConfig();
  const r = await checkHealth();
  if (!r.ok) {
    console.log(`[remindai] daemon NOT running (port ${cfg.port})`);
    process.exit(1);
  }
  console.log(`[remindai] daemon running (pid=${r.pid}, port=${cfg.port})`);
}
