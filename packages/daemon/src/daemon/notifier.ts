import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../logger.js';
import type { Config } from '../config.js';

const execFileAsync = promisify(execFile);

export class Notifier {
  constructor(private cfg: Config) {}

  show(title: string, message: string, opts?: { sound?: boolean }) {
    if (!this.cfg.toast.enabled) return;

    this.showNative(title, message || ' ', opts).catch((err) => {
      logger.warn({ err, title, message }, 'native notification failed');
    });
  }

  private async showNative(title: string, message: string, opts?: { sound?: boolean }) {
    if (process.platform === 'win32') {
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms',
        'Add-Type -AssemblyName System.Drawing',
        '$title = [Environment]::GetEnvironmentVariable("REMINDAI_NOTIFY_TITLE")',
        '$message = [Environment]::GetEnvironmentVariable("REMINDAI_NOTIFY_MESSAGE")',
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
          REMINDAI_NOTIFY_TITLE: title,
          REMINDAI_NOTIFY_MESSAGE: message,
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
