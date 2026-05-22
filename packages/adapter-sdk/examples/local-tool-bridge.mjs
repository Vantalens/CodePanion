// 示例：把任意"国产 AI 编程工具"或本地工具桥接到 CodePanion，
// 把"工具进程在不在"从 L1 进程级识别升级到 L2 真事件级（done / error / prompt）。
//
// 适用场景：
//   - 通义灵码 / Qoder / CodeBuddy / Trae / Comate / CodeGeeX 等已能被 process-scan 识别，
//     但需要进一步上报具体的"任务完成 / 任务失败 / 等待选择"等事件；
//   - 你拥有该工具产出的本地日志、状态文件、命令行包装脚本等公开数据源；
//   - 不读账号、token、cookie 或插件私有 DB，符合 MONITORING_SOURCES.md 的隐私边界。
//
// 运行：
//   node packages/adapter-sdk/examples/local-tool-bridge.mjs \
//     --kind lingma --name "通义灵码" \
//     --watch C:\path\to\tool.log
//
// 退出：Ctrl+C / SIGTERM，会触发 disconnect 把来源标记为 offline。
//
// 默认行为：
//   - 监控指定文件的 append 增量（fs.watch + 末尾偏移），不读完整文件，也不回放历史；
//   - 每行作为一条 activity 上报；行内含 ERROR / FAIL 关键字升级为 error；含 ? / 选择 / Continue
//     等关键字升级为 prompt（供 GUI 显示为"等待我"）。
//
// 把"监控什么 / 怎么解析"换成你工具的真实产出，是把 L1 升 L2 的最短路径。

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createAdapter } from '../src/index.js';

const KNOWN_KINDS = new Set([
  'lingma',
  'qoder',
  'codebuddy',
  'trae',
  'comate',
  'codegeex',
  'marscode',
  'qwen-code',
  'external',
]);

function parseArgs(argv) {
  const args = { kind: 'external', name: '', watch: '', workspace: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === '--kind' && next) { args.kind = next; i += 1; }
    else if (flag === '--name' && next) { args.name = next; i += 1; }
    else if (flag === '--watch' && next) { args.watch = next; i += 1; }
    else if (flag === '--workspace' && next) { args.workspace = next; i += 1; }
  }
  return args;
}

function classify(line) {
  const upper = line.toUpperCase();
  if (/(ERROR|FAIL|EXCEPTION|TRACEBACK|失败|错误)/.test(upper) || /\b(ERR|FATAL)\b/.test(upper)) {
    return { type: 'error', level: 'error' };
  }
  if (/(\?\s*$|请选择|是否|继续\?|Continue\?|\(y\/n\))/.test(line)) {
    return { type: 'prompt', level: 'prompt' };
  }
  if (/(完成|done|success|✓)/i.test(line)) {
    return { type: 'done', level: 'done' };
  }
  return { type: 'activity', level: 'info' };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.watch) {
    console.error('usage: node local-tool-bridge.mjs --kind <lingma|qoder|...> --name <显示名> --watch <文件路径>');
    process.exit(2);
  }
  if (!KNOWN_KINDS.has(args.kind)) {
    console.error(`[bridge] 未知 kind: ${args.kind}（合法值：${Array.from(KNOWN_KINDS).join(', ')}）`);
    process.exit(2);
  }
  const absoluteWatch = path.resolve(args.watch);
  if (!fs.existsSync(absoluteWatch)) {
    console.error(`[bridge] 监控文件不存在：${absoluteWatch}`);
    process.exit(2);
  }

  const workspace = args.workspace ? path.resolve(args.workspace) : path.dirname(absoluteWatch);
  const adapter = createAdapter({
    sourceKind: args.kind,
    sourceName: args.name || args.kind,
  });

  const source = await adapter.registerSource({
    workspace,
    capabilities: ['adapter', 'log-bridge', `tool:${args.kind}`],
    // 一旦能上报真事件（不只是"进程在不在"），能力等级就从 L1 升到 L2。
    capabilityLevel: 'L2',
  });
  console.log(`[bridge] 已注册来源 sourceId=${source.id} kind=${args.kind} watching=${absoluteWatch}`);

  let offset = fs.statSync(absoluteWatch).size;
  let pending = '';

  function drainChunk(chunk) {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const { type, level } = classify(line);
      adapter
        .emitEvent({
          type,
          level,
          title: line.length > 80 ? `${line.slice(0, 77)}...` : line,
          content: line,
          workspace,
        })
        .catch((err) => console.warn('[bridge] 上报失败:', err.message));
    }
  }

  function readTail() {
    let stat;
    try {
      stat = fs.statSync(absoluteWatch);
    } catch (err) {
      // 文件被轮转 / 移走时，下次 watch 再处理重建。
      return;
    }
    // 处理日志轮转：文件变小则从头读。
    if (stat.size < offset) offset = 0;
    if (stat.size === offset) return;

    const stream = fs.createReadStream(absoluteWatch, {
      start: offset,
      end: stat.size - 1,
      encoding: 'utf8',
    });
    offset = stat.size;
    stream.on('data', drainChunk);
    stream.on('error', (err) => console.warn('[bridge] 读取失败:', err.message));
  }

  const watcher = fs.watch(absoluteWatch, () => readTail());

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[bridge] 收到 ${signal}，正在断开来源 ...`);
    watcher.close();
    try {
      await adapter.disconnect();
    } catch (err) {
      console.warn('[bridge] disconnect 失败:', err.message);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[bridge] 启动失败:', err);
    process.exit(1);
  });
}

// 导出用于单元测试。
export { classify, parseArgs, KNOWN_KINDS };
