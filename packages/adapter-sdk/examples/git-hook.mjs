// 示例：把 git hook（如 post-commit / pre-push）触发的事件上报到 CodePanion。
//
// 安装方法（以 post-commit 为例）：
//   1. 在仓库 .git/hooks/post-commit 写入：
//        #!/bin/sh
//        node /path/to/CodePanion/packages/adapter-sdk/examples/git-hook.mjs post-commit
//   2. chmod +x .git/hooks/post-commit
//
// 用途：用 CodePanion 任务列表追踪 commit / push / merge / rebase 等关键节点；
//       不触碰 commit message 之外的内容，符合 explicit-adapter 边界。

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createAdapter } from '../src/index.js';

function safeExec(command, args) {
  try {
    return execFileSync(command, args, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

async function main() {
  const hookName = process.argv[2] || 'post-commit';
  const repoRoot = safeExec('git', ['rev-parse', '--show-toplevel']);
  const branch = safeExec('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const headSha = safeExec('git', ['rev-parse', '--short', 'HEAD']);
  const subject = safeExec('git', ['log', '-1', '--pretty=%s']);

  if (!repoRoot) {
    console.error('[adapter] 当前目录不在 git 仓库内');
    process.exit(2);
  }

  const adapter = createAdapter({
    sourceKind: 'external',
    sourceName: `git-hook: ${path.basename(repoRoot)}`,
  });

  const source = await adapter.registerSource({
    workspace: repoRoot,
    capabilities: ['adapter', 'git-hook'],
    capabilityLevel: 'L2',
  });

  await adapter.emitEvent({
    type: 'activity',
    title: `${hookName} @ ${branch || 'HEAD'}`,
    content: subject ? `${headSha} ${subject}` : `${headSha}`,
    workspace: repoRoot,
  });

  // hook 是短脚本，立即 disconnect 以释放来源条目
  await adapter.disconnect(source.id);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[adapter] git-hook 上报失败:', err.message);
    process.exit(1);
  });
}
