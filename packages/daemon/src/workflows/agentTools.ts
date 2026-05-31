// agent tool-use 循环（slice 2a）：只读工具调度器 + workspace 沙箱。
// 所有文件访问用 ensurePathInside 钳在 workspaceRoot 内；越界 / 出错都返回字符串（让模型看到），不抛崩循环。
// workspaceRoot 为空（全局 fallback，无安全沙箱根）→ 不提供任何工具，dispatcher 一律拒绝。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ensurePathInside } from './pathSafety.js';
import type { ChatTool } from '../models/modelClient.js';
import type { AgentToolRunner } from '../models/agentRuntime.js';

const READ_FILE_CAP = 64 * 1024; // 单文件回填上限，超出截断并标注。
const LIST_DIR_CAP = 500;        // 单目录列出条目上限。

const READONLY_TOOLS: ChatTool[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取 workspace 内某个文件的文本内容（相对 workspace 根的路径）。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '相对 workspace 根的文件路径' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: '列出 workspace 内某个目录的条目（相对 workspace 根的路径，默认根目录）。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '相对 workspace 根的目录路径，默认 "."' } },
      },
    },
  },
];

function parsePathArg(argsJson: string, fallback = '.'): string {
  let parsed: any = {};
  try { parsed = argsJson ? JSON.parse(argsJson) : {}; } catch { /* 容错：参数非 JSON 时按默认 */ }
  const p = typeof parsed?.path === 'string' && parsed.path.trim() ? parsed.path.trim() : fallback;
  return p;
}

/**
 * 构造只读工具集 + dispatcher。workspaceRoot 必须是绝对路径；空串 → 无工具（沙箱根缺失）。
 */
export function buildReadonlyTools(workspaceRoot: string): { tools: ChatTool[]; runTool: AgentToolRunner } {
  if (!workspaceRoot) {
    return {
      tools: [],
      runTool: async () => '错误：当前没有选定 workspace，文件工具不可用。请先选择一个 workspace 再运行。',
    };
  }

  const safeResolve = (rel: string): string => ensurePathInside(join(workspaceRoot, rel), workspaceRoot, 'agent tool path');

  const runTool: AgentToolRunner = async (name, argsJson) => {
    if (name === 'read_file') {
      const rel = parsePathArg(argsJson);
      let abs: string;
      try { abs = safeResolve(rel); } catch { return `错误：路径越界，拒绝访问 workspace 之外：${rel}`; }
      try {
        if (!existsSync(abs)) return `错误：文件不存在：${rel}`;
        if (statSync(abs).isDirectory()) return `错误：${rel} 是目录，请用 list_dir`;
        const raw = readFileSync(abs, 'utf8');
        if (raw.length > READ_FILE_CAP) {
          return `${raw.slice(0, READ_FILE_CAP)}\n\n[内容已截断：超过 ${READ_FILE_CAP} 字节]`;
        }
        return raw;
      } catch (err) {
        return `错误：读取失败：${err instanceof Error ? err.message : String(err)}`;
      }
    }
    if (name === 'list_dir') {
      const rel = parsePathArg(argsJson, '.');
      let abs: string;
      try { abs = safeResolve(rel); } catch { return `错误：路径越界，拒绝访问 workspace 之外：${rel}`; }
      try {
        if (!existsSync(abs)) return `错误：目录不存在：${rel}`;
        if (!statSync(abs).isDirectory()) return `错误：${rel} 不是目录，请用 read_file`;
        const entries = readdirSync(abs, { withFileTypes: true });
        const lines = entries.slice(0, LIST_DIR_CAP).map((e) => `${e.isDirectory() ? 'dir ' : 'file'} ${e.name}`);
        if (entries.length > LIST_DIR_CAP) lines.push(`... [还有 ${entries.length - LIST_DIR_CAP} 条未列出]`);
        return lines.length > 0 ? lines.join('\n') : '（空目录）';
      } catch (err) {
        return `错误：列目录失败：${err instanceof Error ? err.message : String(err)}`;
      }
    }
    return `错误：未知工具 ${name}`;
  };

  return { tools: READONLY_TOOLS, runTool };
}
