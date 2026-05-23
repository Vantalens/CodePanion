import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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

// N-17：旧实现「readPid → isProcessAlive → clearPid → writePid」中间任何一步都没有原子保证。
// CLI `codepanion start` 与 GUI 双击同时启动时，两个 daemon child 都能通过 alive 检查（pid 文件刚被对方
// clearPid 清掉，或两侧都拿到 dead pid），都 writePid 顺序覆盖，最终两个 daemon 同时跑——抢端口、抢
// token 文件。改为 `openSync(path, 'wx')` 原子独占创建：只有一个能赢，其他立即看到 EEXIST 退出。
// 兼容老问题：若文件存在但持有者已死，单次 retry 清理后再 wx，避免上次 daemon 异常退出后无法重启。
export function acquireLock(path: string = PID_PATH): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, 'wx');
      try {
        writeSync(fd, String(process.pid));
      } finally {
        closeSync(fd);
      }
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const existing = readPidAt(path);
      if (existing && isProcessAlive(existing)) {
        // 真有 daemon 在跑，本进程让位。
        return false;
      }
      // 文件存在但 pid 已死（上次崩溃 / 强杀残留）：清理后再试一次 wx。
      // 如果此时刚好另一个并发 child 抢到了 wx，第二次仍会 EEXIST，再检查 alive 时它会还活着，返回 false。
      try { unlinkSync(path); } catch {}
    }
  }
  return false;
}

function readPidAt(path: string): number | null {
  try {
    const raw = readFileSync(path, 'utf8').trim();
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// N-18：stop 命令以前直接 process.kill(pid, SIGTERM) —— 如果 daemon 早已退出而 OS
// 已经回收 pid 复用给别的进程，我们就会把无辜的用户进程杀掉。这里读取目标进程的
// 命令行并要求包含 "daemon-entry" 或 "codepanion"，确认确实是我们自己的 daemon。
// 任何 OS 调用失败都返回 unknown，让上层决定是否保守跳过 kill。
export type DaemonIdentity = 'match' | 'mismatch' | 'unknown';

const DAEMON_FINGERPRINT_RE = /(daemon-entry|codepanion)/i;

export function verifyDaemonIdentity(pid: number): DaemonIdentity {
  const cmdline = readProcessCommandLine(pid);
  if (cmdline === null) return 'unknown';
  return DAEMON_FINGERPRINT_RE.test(cmdline) ? 'match' : 'mismatch';
}

function readProcessCommandLine(pid: number): string | null {
  try {
    if (process.platform === 'linux') {
      const raw = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      return raw.replace(/\0/g, ' ').trim();
    }
    if (process.platform === 'darwin') {
      const out = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
      });
      return out.trim() || null;
    }
    if (process.platform === 'win32') {
      // wmic 在 Win11 已被标记为 deprecated 但仍可用；优先调用，失败时退到 PowerShell。
      try {
        const out = execFileSync(
          'wmic',
          ['process', 'where', `ProcessId=${pid}`, 'get', 'CommandLine', '/value'],
          { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', windowsHide: true },
        );
        const match = out.match(/CommandLine=(.*)/);
        if (match) return match[1].trim();
      } catch {
        // fall through
      }
      const psOut = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
        ],
        { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', windowsHide: true },
      );
      return psOut.trim() || null;
    }
  } catch {
    return null;
  }
  return null;
}
