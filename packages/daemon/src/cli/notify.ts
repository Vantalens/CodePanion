import { notify } from '../shared/client.js';

export async function notifyCommand(args: { title: string; message?: string; source?: string }) {
  await notify({
    title: args.title,
    message: args.message ?? '',
    source: args.source ?? 'cli',
    level: 'info',
  });
  console.log('[codepanion] notified');
}
