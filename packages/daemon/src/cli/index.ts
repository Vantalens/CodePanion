import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { startCommand } from './start.js';
import { stopCommand } from './stop.js';
import { statusCommand } from './status.js';
import { notifyCommand } from './notify.js';
import { replyCommand } from './reply.js';
import { installCommand } from './install.js';
import {
  templateAddCommand,
  templateListCommand,
  templateRemoveCommand,
  templateRunCommand,
  templateShowCommand,
} from './templates.js';
import {
  workflowAddCommand,
  workflowHistoryCommand,
  workflowListCommand,
  workflowRemoveCommand,
  workflowReplayCommand,
  workflowRunCommand,
  workflowShowCommand,
} from './workflows.js';
import { auditExportCommand } from './audit.js';

export async function runCli(argv: string[]): Promise<void> {
  await yargs(hideBin(argv))
    .scriptName('codepanion')
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
          .option('source', { type: 'string', default: 'cli' })
          .option('level', {
            type: 'string',
            default: 'info',
            choices: ['info', 'prompt', 'done', 'error'],
          }),
      async (a) => {
        await notifyCommand({
          title: a.title as string,
          message: a.message as string | undefined,
          source: a.source as string,
          level: a.level as string,
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
      'PTY 包装方式启动一个命令（用法：codepanion run -- <cmd> [args...]）。注意：实际由 src/index.ts 短路处理，这里只是为了帮助文本',
      (y) => y,
      async () => {
        // No-op; handled in src/index.ts before yargs parsing.
        console.error('usage: codepanion run -- <command> [args...]');
        process.exit(2);
      },
    )
    .command(
      'install <target>',
      '把 CodePanion 集成到指定工具（target=claude-code）',
      (y) => y.positional('target', { type: 'string', demandOption: true }),
      async (a) => {
        await installCommand({ target: a.target as string });
      },
    )
    .command(
      'template <action> [name]',
      '管理本地工作流模板（add/list/show/run/remove）',
      (y) =>
        y
          .positional('action', {
            type: 'string',
            choices: ['add', 'list', 'show', 'run', 'remove'],
            demandOption: true,
          })
          .positional('name', { type: 'string' })
          .option('command', { type: 'string', describe: '模板启动命令，例如 codex 或 claude' })
          .option('arg', { type: 'array', string: true, describe: '模板命令参数，可重复，支持 {param} 占位' })
          .option('description', { type: 'string', describe: '模板说明' })
          .option('param', { type: 'array', string: true, describe: '参数定义 name=default，可重复' })
          .option('set', { type: 'array', string: true, describe: '运行时参数 name=value，可重复' })
          .option('dry-run', { type: 'boolean', default: false, describe: '只打印解析后的命令，不执行' }),
      async (a) => {
        const action = a.action as string;
        const name = a.name as string | undefined;
        if (action !== 'list' && !name) {
          console.error('usage: codepanion template <add|show|run|remove> <name>');
          process.exit(2);
        }
        if (action === 'list') return templateListCommand();
        if (action === 'show') return templateShowCommand({ name: name! });
        if (action === 'remove') return templateRemoveCommand({ name: name! });
        if (action === 'run') return templateRunCommand({ name: name!, set: a.set as string[] | undefined, dryRun: a.dryRun as boolean });
        if (!a.command) {
          console.error('usage: codepanion template add <name> --command <cmd> [--arg value] [--param name=default]');
          process.exit(2);
        }
        return templateAddCommand({
          name: name!,
          command: a.command as string,
          arg: a.arg as string[] | undefined,
          description: a.description as string | undefined,
          param: a.param as string[] | undefined,
        });
      },
    )
    .command(
      'workflow <action> [name]',
      '管理并运行本地多步骤工作流（add/list/show/run/remove/history/replay）',
      (y) =>
        y
          .positional('action', {
            type: 'string',
            choices: ['add', 'list', 'show', 'run', 'remove', 'history', 'replay'],
            demandOption: true,
          })
          .positional('name', { type: 'string' })
          .option('description', { type: 'string', describe: '工作流说明' })
          .option('param', { type: 'array', string: true, describe: '工作流参数 name=default，可重复' })
          .option('step', {
            type: 'array',
            string: true,
            describe: '步骤定义，例如 id=test;tool=npm;command=npm;args=test;after=build;checkpoint=true',
          })
          .option('set', { type: 'array', string: true, describe: '运行时参数 name=value，可重复' })
          .option('query', { type: 'string', describe: 'history 搜索关键字' })
          .option('dry-run', { type: 'boolean', default: false, describe: '只解析步骤，不实际执行' })
          .option('yes', { type: 'boolean', default: false, describe: '跳过人工检查点' }),
      async (a) => {
        const action = a.action as string;
        const name = a.name as string | undefined;
        if (action === 'list') return workflowListCommand();
        if (action === 'history') return workflowHistoryCommand({ query: a.query as string | undefined });
        if (action === 'replay') {
          if (!name) {
            console.error('usage: codepanion workflow replay <runId>');
            process.exit(2);
          }
          return workflowReplayCommand({
            id: name,
            set: a.set as string[] | undefined,
            dryRun: a.dryRun as boolean,
            yes: a.yes as boolean,
          });
        }
        if (!name) {
          console.error('usage: codepanion workflow <add|show|run|remove> <name>');
          process.exit(2);
        }
        if (action === 'show') return workflowShowCommand({ name });
        if (action === 'remove') return workflowRemoveCommand({ name });
        if (action === 'run') {
          return workflowRunCommand({
            name,
            set: a.set as string[] | undefined,
            dryRun: a.dryRun as boolean,
            yes: a.yes as boolean,
          });
        }
        return workflowAddCommand({
          name,
          description: a.description as string | undefined,
          param: a.param as string[] | undefined,
          step: a.step as string[] | undefined,
        });
      },
    )
    .command(
      'audit <action>',
      '本地审计与归档（action=export）',
      (y) =>
        y
          .positional('action', { type: 'string', choices: ['export'], demandOption: true })
          .option('output', { type: 'string', alias: 'o', describe: '写入文件路径；省略或 - 输出到 stdout' })
          .option('format', { type: 'string', choices: ['json', 'jsonl'], default: 'json' })
          .option('since', { type: 'string', describe: 'ISO 8601 字符串或 epoch ms，只导出该时刻之后的数据' })
          .option('redact', { type: 'boolean', default: false, describe: '对事件内容、回复、路径做最小脱敏' }),
      async (a) => {
        if (a.action === 'export') {
          await auditExportCommand({
            output: a.output as string | undefined,
            format: a.format as 'json' | 'jsonl',
            since: a.since as string | undefined,
            redact: a.redact as boolean,
          });
        }
      },
    )
    .demandCommand(1)
    .strict()
    .help()
    .parseAsync();
}
