import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { startCommand } from './start.js';
import { stopCommand } from './stop.js';
import { statusCommand } from './status.js';
import { notifyCommand } from './notify.js';
import { replyCommand } from './reply.js';
import { installCommand } from './install.js';

export async function runCli(argv: string[]): Promise<void> {
  await yargs(hideBin(argv))
    .scriptName('remindai')
    .usage('$0 <command> [options]')
    .command('start', '启动后台 daemon', {}, async () => {
      await startCommand();
    })
    .command('stop', '停止后台 daemon', {}, async () => {
      await stopCommand();
    })
    .command('status', '检查 daemon 是否在运行', {}, async () => {
      await statusCommand();
    })
    .command(
      'notify <title> [message]',
      '发送一条系统通知',
      (y) =>
        y
          .positional('title', { type: 'string', demandOption: true })
          .positional('message', { type: 'string' })
          .option('source', { type: 'string', default: 'cli' }),
      async (a) => {
        await notifyCommand({
          title: a.title as string,
          message: a.message as string | undefined,
          source: a.source as string,
        });
      },
    )
    .command(
      'reply <sessionId> <text>',
      '向某个会话注入回复（默认末尾追加换行）',
      (y) =>
        y
          .positional('sessionId', { type: 'string', demandOption: true })
          .positional('text', { type: 'string', demandOption: true })
          .option('newline', { type: 'boolean', default: true, describe: '是否末尾补 \\n' }),
      async (a) => {
        await replyCommand({
          sessionId: a.sessionId as string,
          text: a.text as string,
          newline: a.newline as boolean,
        });
      },
    )
    .command(
      'run',
      'PTY 包装方式启动一个命令（用法：remindai run -- <cmd> [args...]）。注意：实际由 src/index.ts 短路处理，这里只是为了帮助文本',
      (y) => y,
      async () => {
        // No-op; handled in src/index.ts before yargs parsing.
        console.error('usage: remindai run -- <command> [args...]');
        process.exit(2);
      },
    )
    .command(
      'install <target>',
      '把 RemindAI 集成到指定工具（target=claude-code）',
      (y) => y.positional('target', { type: 'string', demandOption: true }),
      async (a) => {
        await installCommand({ target: a.target as string });
      },
    )
    .demandCommand(1)
    .strict()
    .help()
    .parseAsync();
}
