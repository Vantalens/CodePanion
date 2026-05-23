import { readPid, isProcessAlive, clearPid, verifyDaemonIdentity } from '../daemon/pidfile.js';
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
    // N-18：pid 文件可能指向 OS 复用后的无关进程。signal 之前先核对命令行，
    // mismatch 时只清理 pidfile，绝不杀错进程；unknown（探测失败）默认继续，
    // 因为在主流环境（Linux /proc、macOS ps、Windows wmic/PowerShell）几乎不会都失败。
    const identity = verifyDaemonIdentity(pid);
    if (identity === 'mismatch') {
      console.warn(
        `[codepanion] pid ${pid} 进程命令行不像 CodePanion daemon（可能已被 OS 回收复用），跳过 kill 仅清理 pidfile`,
      );
      clearPid();
      return;
    }
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
    // SIGKILL 之前再次核对，避免 SIGTERM 等待期内 pid 被复用。
    if (verifyDaemonIdentity(pid) !== 'mismatch') {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
  }
  clearPid();
  console.log('[codepanion] daemon stopped');
}
