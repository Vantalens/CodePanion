import { execFile } from 'node:child_process';
import { platform } from 'node:os';
import { promisify } from 'node:util';
import type { MonitorSource, RegisterSourceRequest } from '../shared/protocol.js';
import { logger } from '../logger.js';
import { SourceManager } from '../daemon/sourceManager.js';

const execFileAsync = promisify(execFile);

type ProcessInfo = {
  processId: number;
  name: string;
  path?: string;
  commandLine?: string;
  windowTitle?: string;
};

type ToolProfile = {
  kind: RegisterSourceRequest['kind'];
  name: string;
  group: string;
  processPatterns: RegExp[];
  commandPatterns?: RegExp[];
  capabilities: string[];
};

const TOOL_PROFILES: ToolProfile[] = [
  {
    kind: 'trae',
    name: 'Trae',
    group: 'Code OSS / VS Code 系',
    processPatterns: [/^trae/i],
    commandPatterns: [/\\Trae(\\|$)/i, /trae/i],
    capabilities: ['process-detected', 'window', 'code-oss-family', 'ai-ide'],
  },
  {
    kind: 'codebuddy',
    name: 'CodeBuddy',
    group: 'CodeBuddy IDE / CLI',
    processPatterns: [/codebuddy/i],
    commandPatterns: [/codebuddy/i, /@tencent-ai[\\/]codebuddy-code/i],
    capabilities: ['process-detected', 'window', 'cli-detected', 'ai-ide'],
  },
  {
    kind: 'lingma',
    name: '通义灵码',
    group: '插件型 IDE 助手',
    processPatterns: [/lingma/i, /tongyi/i],
    commandPatterns: [/lingma/i, /tongyi/i, /通义灵码/i],
    capabilities: ['process-detected', 'plugin-family'],
  },
  {
    kind: 'marscode',
    name: '豆包 / MarsCode',
    group: 'Code OSS / VS Code 系',
    processPatterns: [/marscode/i, /doubao/i],
    commandPatterns: [/marscode/i, /doubao/i],
    capabilities: ['process-detected', 'window', 'code-oss-family', 'ai-ide'],
  },
  {
    kind: 'codegeex',
    name: 'CodeGeeX',
    group: '插件型 IDE 助手',
    processPatterns: [/codegeex/i],
    commandPatterns: [/codegeex/i],
    capabilities: ['process-detected', 'plugin-family'],
  },
  {
    kind: 'comate',
    name: '百度 Comate',
    group: '插件型 IDE 助手',
    processPatterns: [/comate/i],
    commandPatterns: [/comate/i, /baidu/i],
    capabilities: ['process-detected', 'plugin-family'],
  },
  {
    kind: 'qwen-code',
    name: 'Qwen Code',
    group: 'CLI 型工具',
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

        const key = `${profile.kind}:${process.processId}`;
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

function matchToolProfile(process: ProcessInfo): ToolProfile | undefined {
  const name = process.name || '';
  const text = `${process.path ?? ''}\n${process.commandLine ?? ''}\n${process.windowTitle ?? ''}`;
  return TOOL_PROFILES.find((profile) => {
    if (profile.processPatterns.some((pattern) => pattern.test(name))) return true;
    return profile.commandPatterns?.some((pattern) => pattern.test(text)) ?? false;
  });
}

function inferWorkspace(process: ProcessInfo): string | undefined {
  const command = process.commandLine ?? '';
  const quotedPath = command.match(/"([A-Za-z]:\\[^"]+)"/g)?.map((item) => item.slice(1, -1)) ?? [];
  const candidate = quotedPath.find((item) => !/\\(node\.exe|CodeBuddy|Trae|MarsCode|CodeGeeX|Comate)/i.test(item));
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
