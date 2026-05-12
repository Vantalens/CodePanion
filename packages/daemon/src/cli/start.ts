import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { checkHealth } from '../shared/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function waitForHealth(timeoutMs = 8000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await checkHealth();
    if (r.ok) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

export async function startCommand() {
  const existing = await checkHealth();
  if (existing.ok) {
    console.log(`[remindai] daemon already running (pid=${existing.pid})`);
    return;
  }
  const entry = resolve(__dirname, '..', 'index.js');
  const child = spawn(process.execPath, [entry, '--daemon'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  console.log(`[remindai] starting daemon (child pid=${child.pid})...`);
  const ok = await waitForHealth();
  if (!ok) {
    console.error('[remindai] daemon failed to become healthy in time');
    process.exit(1);
  }
  const r = await checkHealth();
  console.log(`[remindai] daemon ready (pid=${r.pid})`);
}
