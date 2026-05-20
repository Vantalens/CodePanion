import { notify } from '../shared/client.js';

type NotifyLevel = 'info' | 'prompt' | 'done' | 'error';

export async function notifyCommand(args: {
  title: string;
  message?: string;
  source?: string;
  level?: string;
}) {
  const level = normalizeLevel(args.level);
  await notify({
    title: args.title,
    message: args.message ?? '',
    source: args.source ?? 'cli',
    level,
  });
  console.log('[codepanion] notified');
}

function normalizeLevel(value?: string): NotifyLevel {
  switch (value) {
    case 'prompt':
    case 'done':
    case 'error':
    case 'info':
      return value;
    default:
      return 'info';
  }
}
