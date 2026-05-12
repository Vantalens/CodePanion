import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { PID_PATH } from '../config.js';

export function readPid(): number | null {
  if (!existsSync(PID_PATH)) return null;
  const raw = readFileSync(PID_PATH, 'utf8').trim();
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function writePid(pid: number) {
  writeFileSync(PID_PATH, String(pid), 'utf8');
}

export function clearPid() {
  if (existsSync(PID_PATH)) unlinkSync(PID_PATH);
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code === 'EPERM';
  }
}

export function acquireLock(): boolean {
  const existing = readPid();
  if (existing && isProcessAlive(existing)) return false;
  if (existing) clearPid();
  writePid(process.pid);
  return true;
}
