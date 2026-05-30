import { spawn } from 'node:child_process';

// 非 PTY 的本地命令执行器：spawn + 继承 stdio，resolve 退出码。
// 监听路线（含交互式 PTY）下线后，runWorkflow 的默认 executor 与 CLI `template run`
// 用它跑 shell 步骤/模板命令。daemon 内的 workflow 仍走 daemonWorkflowExecutor（带输出捕获 + WS 推送）。
export function runLocalCommand(command: string, args: string[] = []): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide: true });
    child.on('error', () => resolve(-1));
    child.on('exit', (code) => resolve(code ?? -1));
  });
}
