import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { startCommand } from './start.js';
import { stopCommand } from './stop.js';
import { statusCommand } from './status.js';
import { notifyCommand } from './notify.js';
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
  workflowArtifactsCommand,
  workflowBoardCommand,
  workflowCancelCommand,
  workflowGatesCommand,
  workflowHistoryCommand,
  workflowImportCommand,
  workflowListCommand,
  workflowRemoveCommand,
  workflowReplayCommand,
  workflowResolveCommand,
  workflowRunCommand,
  workflowShowCommand,
  workflowStartCommand,
  workflowWatchCommand,
} from './workflows.js';
import { workspaceInitCommand, workspaceStatusCommand } from './workspace.js';

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
          // N-8：install hook 注入的是 `--message`，过去没注册 → yargs .strict() 直接拒，首启即坏。
          .option('message', {
            type: 'string',
            describe: '通知正文；与位置参数 message 二选一，--message 优先',
          })
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
      '管理并运行本地多步骤工作流（add/import/list/show/run/remove/history/replay）',
      (y) =>
        y
          .positional('action', {
            type: 'string',
            choices: ['add', 'import', 'list', 'show', 'run', 'remove', 'history', 'replay', 'start', 'board', 'gates', 'cancel', 'resolve', 'watch', 'artifacts'],
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
          .option('file', { type: 'string', describe: 'import 操作的 workflow JSON 文件路径' })
          .option('set', { type: 'array', string: true, describe: '运行时参数 name=value，可重复' })
          .option('query', { type: 'string', describe: 'history 搜索关键字' })
          .option('dry-run', { type: 'boolean', default: false, describe: '只解析步骤，不实际执行' })
          .option('yes', { type: 'boolean', default: false, describe: '跳过人工检查点' })
          .option('workspace', {
            type: 'string',
            describe: 'workspace 根目录；未指定时从 cwd 向上找 .codepanion/，找不到则走 HOME_DIR 全局共享',
          })
          .option('decision', {
            type: 'string',
            choices: ['approve', 'reject', 'retry'],
            describe: 'resolve 操作的人工决定（approve / reject / retry）',
          })
          .option('step-id', { type: 'string', describe: 'resolve 时的 checkpoint step id' })
          .option('message', { type: 'string', describe: 'resolve 操作的可选说明' })
          .option('constraint', { type: 'array', string: true, describe: '可重复的人工约束条目' })
          .option('run', { type: 'string', describe: 'watch 时只 follow 指定 runId 的事件' })
          .option('once', { type: 'boolean', default: false, describe: 'watch 收到匹配的 run-finish 后立即退出' })
          .option('verbose', { type: 'boolean', default: false, describe: 'artifacts 命令展开 content + files 列表' }),
      async (a) => {
        const action = a.action as string;
        const name = a.name as string | undefined;
        const workspace = a.workspace as string | undefined;
        if (action === 'list') return workflowListCommand({ workspace });
        if (action === 'history') return workflowHistoryCommand({ query: a.query as string | undefined, workspace });
        if (action === 'board') return workflowBoardCommand({ workspace });
        if (action === 'gates') return workflowGatesCommand({ workspace });
        if (action === 'watch') return workflowWatchCommand({ run: a.run as string | undefined, once: a.once as boolean });
        if (action === 'import') {
          const file = (a.file as string | undefined) ?? name;
          if (!file) {
            console.error('usage: codepanion workflow import --file <path-to-json>');
            process.exit(2);
          }
          return workflowImportCommand({ file, workspace });
        }
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
            workspace,
          });
        }
        if (action === 'cancel') {
          if (!name) {
            console.error('usage: codepanion workflow cancel <runId>');
            process.exit(2);
          }
          return workflowCancelCommand({ id: name });
        }
        if (action === 'artifacts') {
          if (!name) {
            console.error('usage: codepanion workflow artifacts <runId> [--verbose]');
            process.exit(2);
          }
          return workflowArtifactsCommand({
            runId: name,
            workspace,
            verbose: a.verbose as boolean,
          });
        }
        if (action === 'resolve') {
          const stepId = a['step-id'] as string | undefined;
          const decision = a.decision as 'approve' | 'reject' | 'retry' | undefined;
          if (!name || !stepId || !decision) {
            console.error('usage: codepanion workflow resolve <runId> --step-id <stepId> --decision <approve|reject|retry>');
            process.exit(2);
          }
          return workflowResolveCommand({
            runId: name,
            stepId,
            decision,
            message: a.message as string | undefined,
            constraint: a.constraint as string[] | undefined,
            workspace,
          });
        }
        if (!name) {
          console.error('usage: codepanion workflow <add|show|run|remove|start> <name>');
          process.exit(2);
        }
        if (action === 'show') return workflowShowCommand({ name, workspace });
        if (action === 'remove') return workflowRemoveCommand({ name, workspace });
        if (action === 'run') {
          return workflowRunCommand({
            name,
            set: a.set as string[] | undefined,
            dryRun: a.dryRun as boolean,
            yes: a.yes as boolean,
            workspace,
          });
        }
        if (action === 'start') {
          return workflowStartCommand({
            name,
            set: a.set as string[] | undefined,
            yes: a.yes as boolean,
            dryRun: a.dryRun as boolean,
            workspace,
          });
        }
        return workflowAddCommand({
          name,
          description: a.description as string | undefined,
          param: a.param as string[] | undefined,
          step: a.step as string[] | undefined,
          workspace,
        });
      },
    )
    .command(
      'workspace <action>',
      '初始化 / 查看当前 workspace（.codepanion/）',
      (y) =>
        y
          .positional('action', { type: 'string', choices: ['init', 'status'], demandOption: true })
          .option('root', { type: 'string', describe: 'workspace 根目录，默认 cwd' }),
      async (a) => {
        const action = a.action as string;
        const root = a.root as string | undefined;
        if (action === 'init') return workspaceInitCommand({ root });
        return workspaceStatusCommand({ root });
      },
    )
    .demandCommand(1)
    .strict()
    .help()
    .parseAsync();
}
