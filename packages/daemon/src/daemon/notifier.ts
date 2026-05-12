import notifier from 'node-notifier';
import { logger } from '../logger.js';
import type { Config } from '../config.js';

export class Notifier {
  constructor(private cfg: Config) {}

  show(title: string, message: string, opts?: { sound?: boolean }) {
    if (!this.cfg.toast.enabled) return;
    notifier.notify(
      {
        title,
        message: message || ' ',
        sound: opts?.sound ?? false,
        wait: false,
        appID: 'RemindAI',
      },
      (err) => {
        if (err) logger.warn({ err }, 'toast failed');
      },
    );
  }
}
