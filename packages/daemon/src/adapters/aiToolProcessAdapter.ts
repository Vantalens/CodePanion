import { execFile } from 'node:child_process';
import { platform } from 'node:os';
import { promisify } from 'node:util';
import type { MonitorSource, RegisterSourceRequest } from '../shared/protocol.js';
import { logger, maskString } from '../logger.js';
import { SourceManager } from '../daemon/sourceManager.js';

// N-6：进程级 L1 探测时，CommandLine / 可执行路径 / 窗口标题都可能含用户名 / API key /
// prompt 片段。仅用于本地匹配 profile，不直接上报；上报字段 workspace / windowTitle
// 一律走 maskString（HOME → ~、Bearer / 长 hex → [Redacted]）+ 80 字符截断。
const REPORT_FIELD_MAX = 80;

const execFileAsync = promisify(execFile);
const INITIAL_SCAN_DELAY_MS = 1500;
const SCAN_INTERVAL_MS = 30_000;

export type ProcessInfo = {
  processId: number;
  name: string;
  path?: string;
  commandLine?: string;
  windowTitle?: string;
};

/**
 * tier 收敛策略（与 docs/MONITORING_SOURCES.md 同步）：
 *   first    — 首批投入：广覆盖 + 显式验收，作为 Windows Alpha 国产工具样本。
 *   second   — 下一梯队观察：仍做进程级识别，但不作为 Alpha 验收必备项。
 *   switcher — 账号 / provider 切换器，不参与 AI 任务排序。
 */
export type ToolTier = 'first' | 'second' | 'switcher';

export type ToolProfile = {
  kind: RegisterSourceRequest['kind'];
  name: string;
  group: string;
  tier: ToolTier;
  processPatterns: RegExp[];
  commandPatterns?: RegExp[];
  capabilities: string[];
};

export const TOOL_PROFILES: ToolProfile[] = [
  {
    // Anthropic Claude Code CLI（`npm i -g @anthropic-ai/claude-code`）。
    //
    // 2026-05-24 严控：不再用 processPatterns，避免任何叫 claude.exe / claude-code.exe 的
    // 同名程序被误识别；必须命令行里见到 npm 包路径 `@anthropic-ai/claude-code` 才算命中。
    // 这避开了 VS Code 主进程 / helper / 其它带 "claude" 字串的进程被吞进来的回归。
    kind: 'claude-code',
    name: 'Claude Code',
    group: 'CLI 型工具',
    tier: 'first',
    processPatterns: [],
    commandPatterns: [
      /[\\/]@anthropic-ai[\\/]claude-code[\\/]/i,
    ],
    capabilities: ['process-detected', 'cli-detected', 'anthropic-claude'],
  },
  {
    // OpenAI Codex CLI（`npm i -g @openai/codex`）。
    //
    // 2026-05-24 严控：不再用 processPatterns。Codex Desktop（Electron 应用）的主进程
    // 与多个 renderer / GPU / utility 子进程都叫 `codex.exe`，会被宽匹配抓成"运行中的
    // Codex CLI 多份"，触发任务列表里同一来源被重复登记成 N 条。
    // 命令行必须严格匹配 npm 包路径 `@openai/codex` 才算 CLI。Desktop 走 codexDesktopAdapter，
    // 不在这里参与匹配。
    kind: 'codex',
    name: 'Codex CLI',
    group: 'CLI 型工具',
    tier: 'first',
    processPatterns: [],
    commandPatterns: [
      /[\\/]@openai[\\/]codex[\\/]/i,
    ],
    capabilities: ['process-detected', 'cli-detected', 'openai-codex'],
  },
  {
    // sst/opencode CLI。同样只靠 `@sst/opencode` 包路径锚定，避免任何同名 binary 误命中。
    kind: 'external',
    name: 'OpenCode',
    group: 'CLI 型工具',
    tier: 'first',
    processPatterns: [],
    commandPatterns: [
      /[\\/]@sst[\\/]opencode[\\/]/i,
    ],
    capabilities: ['process-detected', 'cli-detected', 'opencode'],
  },
  {
    kind: 'cc-switch',
    name: 'CC Switch',
    group: 'AI 账号 / Provider 切换器',
    tier: 'switcher',
    processPatterns: [/^(cc-switch|ccs|ccswitch)(\.exe)?$/i, /claude[-\s]?code[-\s]?switch/i],
    commandPatterns: [
      /(^|[\s"'])cc-switch(\.exe)?([\s"']|$)/i,
      /(^|[\s"'])ccs(\.exe)?([\s"']|$)/i,
      /(^|[\s"'])ccswitch(\.exe)?([\s"']|$)/i,
      /@[^\\/ ]+[\\/]cc-switch/i,
      /@[^\\/ ]+[\\/]claude-code-switch/i,
      /claude-code-switch/i,
      /cc switch/i,
    ],
    capabilities: ['process-detected', 'account-switcher', 'provider-switcher', 'claude-code-config', 'codex-config'],
  },
  {
    kind: 'trae',
    name: 'Trae',
    group: 'Code OSS / VS Code 系',
    tier: 'first',
    processPatterns: [/^trae/i],
    commandPatterns: [/\\Trae(\\|$)/i, /trae/i],
    capabilities: ['process-detected', 'window', 'code-oss-family', 'ai-ide'],
  },
  {
    kind: 'codebuddy',
    name: 'CodeBuddy',
    group: 'CodeBuddy IDE / CLI',
    tier: 'first',
    processPatterns: [/codebuddy/i],
    commandPatterns: [/codebuddy/i, /@tencent-ai[\\/]codebuddy-code/i],
    capabilities: ['process-detected', 'window', 'cli-detected', 'ai-ide'],
  },
  {
    kind: 'lingma',
    name: '通义灵码',
    group: '插件型 IDE 助手',
    tier: 'first',
    processPatterns: [/lingma/i, /tongyi/i],
    commandPatterns: [/lingma/i, /tongyi/i, /通义灵码/i],
    capabilities: ['process-detected', 'plugin-family'],
  },
  {
    kind: 'qoder',
    name: 'Qoder',
    group: 'Code OSS / VS Code 系',
    tier: 'first',
    // Qoder 当前以独立 IDE 形态发布，进程名通常是 Qoder.exe（含 Qoder Helper / GPU 子进程）；
    // 仍兼容旧路径上把 Qoder 视作 lingma 别名的样本——一旦该路径出现，由更具体的 Qoder profile 命中。
    processPatterns: [/^qoder/i],
    commandPatterns: [/\\Qoder(\\|$)/i, /(^|[\s"'])qoder(\.exe)?([\s"']|$)/i],
    capabilities: ['process-detected', 'window', 'code-oss-family', 'ai-ide'],
  },
  {
    kind: 'codegeex',
    name: 'CodeGeeX',
    group: '插件型 IDE 助手',
    tier: 'first',
    processPatterns: [/codegeex/i],
    commandPatterns: [/codegeex/i],
    capabilities: ['process-detected', 'plugin-family'],
  },
  {
    kind: 'comate',
    name: '百度 Comate',
    group: '插件型 IDE 助手',
    tier: 'first',
    processPatterns: [/comate/i],
    commandPatterns: [/comate/i, /baidu/i],
    capabilities: ['process-detected', 'plugin-family'],
  },
  {
    kind: 'marscode',
    name: '豆包 / MarsCode',
    group: 'Code OSS / VS Code 系',
    tier: 'second',
    processPatterns: [/marscode/i, /doubao/i],
    commandPatterns: [/marscode/i, /doubao/i],
    capabilities: ['process-detected', 'window', 'code-oss-family', 'ai-ide'],
  },
  {
    kind: 'qwen-code',
    name: 'Qwen Code',
    group: 'CLI 型工具',
    tier: 'second',
    processPatterns: [/^qwen/i],
    commandPatterns: [/qwen-code/i, /@qwen/i],
    capabilities: ['process-detected', 'cli-detected'],
  },
];

export class AiToolProcessAdapter {
  private timer: NodeJS.Timeout | null = null;
  private readonly sourceIdsByKey = new Map<string, string>();
  private scanning = false;

  constructor(private sources: SourceManager) {}

  start() {
    if (platform() !== 'win32') {
      logger.info({ platform: platform() }, 'ai tool process adapter skipped on non-windows platform');
      return;
    }

    const initialTimer = setTimeout(() => {
      this.scan().catch((err) => logger.warn({ err }, 'ai tool process initial scan failed'));
    }, INITIAL_SCAN_DELAY_MS);
    initialTimer.unref();
    this.timer = setInterval(() => {
      this.scan().catch((err) => logger.warn({ err }, 'ai tool process scan failed'));
    }, SCAN_INTERVAL_MS);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async scan() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const processes = await listWindowsProcesses();
      const seen = new Set<string>();
      for (const process of processes) {
        const profile = matchToolProfile(process);
        if (!profile) continue;

        const key = sourceKeyForProcess(profile, process);
        seen.add(key);
        const sourceId = this.sourceIdsByKey.get(key);
        if (sourceId) {
          this.sources.touch(sourceId);
          continue;
        }

        // process-scan 路径不能走 sourceManager 的 kind 默认 metadata：
        // - 'claude-code' / 'codex' kind 默认是 L3 cli-pty（CLI handoff 启动时是真 PTY），但
        //   这里只是看到进程在跑，不持有它的 stdio，能力实质只到 L1-L2。
        // - 显式标 process-scan 后 GUI 来源面板的「能力层级 / 接入方式 / 隐私边界」三项与
        //   adapter 的实际语义一致，避免把进程级识别误展示成「深度接管」。
        // switcher（cc-switch）保留默认 config-switcher 语义。
        const overrideMetadata = profile.tier !== 'switcher'
          ? {
              capabilityLevel: 'L1-L2' as const,
              integrationKind: 'process-scan' as const,
              privacyBoundary: 'minimal-process' as const,
            }
          : {};
        const source = this.sources.register({
          kind: profile.kind,
          name: profile.name,
          windowTitle: sanitizeReportField(process.windowTitle || profile.group),
          workspace: inferWorkspace(process),
          pid: process.processId,
          capabilities: profile.capabilities,
          ...overrideMetadata,
        });
        this.sourceIdsByKey.set(key, source.id);
        this.emitDetectedEvent(source, profile, process);
      }

      for (const [key, sourceId] of Array.from(this.sourceIdsByKey.entries())) {
        if (seen.has(key)) continue;
        this.sources.disconnect(sourceId);
        this.sourceIdsByKey.delete(key);
      }
    } finally {
      this.scanning = false;
    }
  }

  private emitDetectedEvent(source: MonitorSource, profile: ToolProfile, process: ProcessInfo) {
    this.sources.emitEvent({
      type: 'activity',
      sourceId: source.id,
      source: profile.kind,
      title: `${profile.name} 已识别`,
      content: `${profile.name} 正在运行，CodePanion 已将其纳入本地 AI 工具来源监控。当前能力：${profile.capabilities.join(', ')}。`,
      windowTitle: sanitizeReportField(process.windowTitle || profile.group),
      workspace: inferWorkspace(process),
    });
  }
}

export function sanitizeReportField(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const masked = maskString(String(value)).trim();
  if (!masked) return undefined;
  if (masked.length <= REPORT_FIELD_MAX) return masked;
  return masked.slice(0, REPORT_FIELD_MAX - 1) + '…';
}

export function matchToolProfile(process: ProcessInfo): ToolProfile | undefined {
  const name = process.name || '';
  const text = `${process.path ?? ''}\n${process.commandLine ?? ''}\n${process.windowTitle ?? ''}`;
  return TOOL_PROFILES.find((profile) => {
    if (profile.processPatterns.some((pattern) => pattern.test(name))) return true;
    return profile.commandPatterns?.some((pattern) => pattern.test(text)) ?? false;
  });
}

export function sourceKeyForProcess(profile: ToolProfile, process: ProcessInfo): string {
  // 路径级去重：CC Switch + 三个新加 CLI profile 一律按 binary 路径合并，
  // 避免同一工具的多个子进程（VS Code helper / Electron renderer / npm shim 子进程）
  // 被各自登记成独立 source —— 这就是 2026-05-24 用户反馈"列表里 8 条几乎一样的 Codex"
  // 的根因。其它（IDE 型）保留 PID 区分，因为它们的多窗口需要分开统计。
  if (
    profile.kind === 'cc-switch' ||
    profile.kind === 'claude-code' ||
    profile.kind === 'codex' ||
    profile.kind === 'external'
  ) {
    const identity = normalizeProcessIdentity(process.path) || normalizeProcessIdentity(process.name);
    return `${profile.kind}:${identity || profile.kind}`;
  }
  return `${profile.kind}:${process.processId}`;
}

function normalizeProcessIdentity(value?: string): string {
  if (!value) return '';
  return value.trim().replace(/\//g, '\\').toLowerCase();
}

function inferWorkspace(process: ProcessInfo): string | undefined {
  // N-6：不再用 process.path（可执行文件路径，常含 C:\Users\<name>\）作为 workspace 兜底，
  // 仅识别 commandLine 里第一个明显属于工程目录的引号路径，并把 HOME 段替换为 ~。
  // 命令行本身永不上报，只用作匹配 / 解析输入。
  const command = process.commandLine ?? '';
  const quotedPath = command.match(/"([A-Za-z]:\\[^"]+)"/g)?.map((item) => item.slice(1, -1)) ?? [];
  const candidate = quotedPath.find((item) => !/\\(node\.exe|CodeBuddy|Trae|MarsCode|CodeGeeX|Comate|Qoder)/i.test(item));
  if (!candidate) return undefined;
  return sanitizeReportField(candidate);
}

async function listWindowsProcesses(): Promise<ProcessInfo[]> {
  const command = [
    '$items = Get-CimInstance Win32_Process | Select-Object ProcessId,Name,ExecutablePath,CommandLine;',
    '$windows = Get-Process | Select-Object Id,MainWindowTitle;',
    '$titles = @{};',
    'foreach ($w in $windows) { if ($w.MainWindowTitle) { $titles[[int]$w.Id] = $w.MainWindowTitle } }',
    '$items | ForEach-Object { [PSCustomObject]@{ processId=$_.ProcessId; name=$_.Name; path=$_.ExecutablePath; commandLine=$_.CommandLine; windowTitle=$titles[[int]$_.ProcessId] } } | ConvertTo-Json -Compress',
  ].join(' ');

  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], {
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 6,
  });
  const parsed = JSON.parse(stdout || '[]');
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows
    .filter((item) => item && Number.isFinite(Number(item.processId)))
    .map((item) => ({
      processId: Number(item.processId),
      name: String(item.name ?? ''),
      path: stringOrUndefined(item.path),
      commandLine: stringOrUndefined(item.commandLine),
      windowTitle: stringOrUndefined(item.windowTitle),
    }));
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
