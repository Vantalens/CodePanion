import { execFile } from 'node:child_process';
import { platform } from 'node:os';
import { promisify } from 'node:util';
import type { MonitorSource, RegisterSourceRequest } from '../shared/protocol.js';
import { logger } from '../logger.js';
import { SourceManager } from '../daemon/sourceManager.js';

const execFileAsync = promisify(execFile);

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

    this.scan().catch((err) => logger.warn({ err }, 'ai tool process initial scan failed'));
    this.timer = setInterval(() => {
      this.scan().catch((err) => logger.warn({ err }, 'ai tool process scan failed'));
    }, 10_000);
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

        const source = this.sources.register({
          kind: profile.kind,
          name: profile.name,
          windowTitle: process.windowTitle || profile.group,
          workspace: inferWorkspace(process),
          pid: process.processId,
          capabilities: profile.capabilities,
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
      windowTitle: process.windowTitle || profile.group,
      workspace: inferWorkspace(process),
    });
  }
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
  if (profile.kind === 'cc-switch') {
    const identity = normalizeProcessIdentity(process.path) || normalizeProcessIdentity(process.name);
    return `${profile.kind}:${identity || 'cc-switch'}`;
  }
  return `${profile.kind}:${process.processId}`;
}

function normalizeProcessIdentity(value?: string): string {
  if (!value) return '';
  return value.trim().replace(/\//g, '\\').toLowerCase();
}

function inferWorkspace(process: ProcessInfo): string | undefined {
  const command = process.commandLine ?? '';
  const quotedPath = command.match(/"([A-Za-z]:\\[^"]+)"/g)?.map((item) => item.slice(1, -1)) ?? [];
  const candidate = quotedPath.find((item) => !/\\(node\.exe|CodeBuddy|Trae|MarsCode|CodeGeeX|Comate|Qoder)/i.test(item));
  if (candidate) return candidate;
  return process.path;
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
