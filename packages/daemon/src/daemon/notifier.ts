import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger, maskString } from '../logger.js';
import type { Config } from '../config.js';

const execFileAsync = promisify(execFile);

// N-7：系统通知中心会持久缓存 body（Windows wpndatabase.db / macOS NotificationCenter）。
// 进入系统通道前统一脱敏（HOME → ~、token → [Redacted]）+ 截断，避免日志副本超出 daemon 本地 retention 控制。
const NOTIFY_TITLE_MAX = 60;
const NOTIFY_BODY_MAX = 80;

export function clipNotifyText(value: string | undefined, max: number): string {
  if (!value) return '';
  const masked = maskString(String(value)).replace(/\s+/g, ' ').trim();
  if (masked.length <= max) return masked;
  return masked.slice(0, Math.max(0, max - 1)) + '…';
}

export class Notifier {
  constructor(private cfg: Config) {}

  show(title: string, message: string, opts?: { sound?: boolean }) {
    if (!this.cfg.toast.enabled) return;

    const safeTitle = clipNotifyText(title, NOTIFY_TITLE_MAX) || 'CodePanion';
    const safeMessage = clipNotifyText(message, NOTIFY_BODY_MAX) || ' ';

    // 日志路径不再回写 title / message，避免 daemon.log 成为通知内容副本（与 N-12 同一类）。
    this.showNative(safeTitle, safeMessage, opts).catch((err) => {
      logger.warn({ err }, 'native notification failed');
    });
  }

  private async showNative(title: string, message: string, opts?: { sound?: boolean }) {
    if (process.platform === 'win32') {
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms',
        'Add-Type -AssemblyName System.Drawing',
        '$title = [Environment]::GetEnvironmentVariable("CODEPANION_NOTIFY_TITLE")',
        '$message = [Environment]::GetEnvironmentVariable("CODEPANION_NOTIFY_MESSAGE")',
        '$n = New-Object System.Windows.Forms.NotifyIcon',
        '$n.Icon = [System.Drawing.SystemIcons]::Information',
        '$n.BalloonTipTitle = $title',
        '$n.BalloonTipText = $message',
        '$n.Visible = $true',
        '$n.ShowBalloonTip(5000)',
        'Start-Sleep -Seconds 6',
        '$n.Dispose()',
      ].join('; ');
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        encoded,
      ], {
        env: {
          ...process.env,
          CODEPANION_NOTIFY_TITLE: title,
          CODEPANION_NOTIFY_MESSAGE: message,
        },
      });
      return;
    }

    if (process.platform === 'darwin') {
      await execFileAsync('osascript', [
        '-e',
        'on run argv',
        '-e',
        'display notification (item 2 of argv) with title (item 1 of argv)',
        '-e',
        'end run',
        title,
        message,
      ]);
      return;
    }

    await execFileAsync('notify-send', [
      opts?.sound ? '--urgency=normal' : '--urgency=low',
      title,
      message,
    ]);
  }
}
