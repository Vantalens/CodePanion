// agent tool-use 循环（slice 2a）。把「调模型 → 模型发 tool_calls → 执行工具 → 回填结果 → 再调」
// 这套 harness 与具体依赖解耦：callModel / runTool 都可注入，便于纯单测（不打网络、不碰 fs）。
import { chatCompletion, type ChatMessage, type ChatTool, type ChatCompletionResult } from './modelClient.js';
import type { ModelBackend } from '../config.js';

export type AgentToolRunner = (name: string, argsJson: string) => Promise<string>;

export type CallModel = (input: {
  backend: ModelBackend;
  messages: ChatMessage[];
  tools?: ChatTool[];
  signal?: AbortSignal;
}) => Promise<ChatCompletionResult>;

// 循环过程事件，调用方（daemon）转成 WS step-output 实时推给 GUI 时间线。
export type AgentLoopEvent =
  | { kind: 'assistant'; text: string }
  | { kind: 'tool-call'; name: string; args: string }
  | { kind: 'tool-result'; name: string; result: string }
  | { kind: 'max-turns'; turns: number };

export type AgentLoopResult = { finalText: string; turns: number; hitMaxTurns: boolean };

const DEFAULT_MAX_TURNS = 12;

/**
 * 跑一轮 tool-use 循环直到模型不再发 tool_calls，或触顶 maxTurns。
 * - tools 为空 / 无 runTool → 退化为 single-call（一次模型调用即返回）。
 * - 工具抛错被收成 tool 消息回填给模型（让模型自己决定怎么继续），不中断循环。
 * - signal 透传给每次模型调用，接 run cancel。
 */
export async function runAgentLoop(input: {
  backend: ModelBackend;
  system?: string;
  userPrompt: string;
  tools?: ChatTool[];
  runTool?: AgentToolRunner;
  callModel?: CallModel;
  maxTurns?: number;
  signal?: AbortSignal;
  onEvent?: (ev: AgentLoopEvent) => void;
}): Promise<AgentLoopResult> {
  const callModel = input.callModel ?? chatCompletion;
  const tools = input.tools && input.tools.length > 0 ? input.tools : undefined;
  const maxTurns = input.maxTurns && input.maxTurns > 0 ? input.maxTurns : DEFAULT_MAX_TURNS;

  const messages: ChatMessage[] = [];
  if (input.system && input.system.trim()) messages.push({ role: 'system', content: input.system });
  messages.push({ role: 'user', content: input.userPrompt });

  let lastText = '';
  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const res = await callModel({ backend: input.backend, messages, tools, signal: input.signal });
    lastText = res.text ?? '';
    // 始终把 assistant 消息（含 tool_calls）压回上下文，保持 OpenAI 协议正确性。
    messages.push({ role: 'assistant', content: res.text ?? '', tool_calls: res.toolCalls });
    if (lastText.trim()) input.onEvent?.({ kind: 'assistant', text: lastText });

    if (!res.toolCalls || res.toolCalls.length === 0) {
      return { finalText: lastText, turns: turn, hitMaxTurns: false };
    }
    // 模型要调工具但没有工具运行器（或没声明工具）→ 无法满足，返回现有文本收尾。
    if (!tools || !input.runTool) {
      return { finalText: lastText, turns: turn, hitMaxTurns: false };
    }
    for (const tc of res.toolCalls) {
      input.onEvent?.({ kind: 'tool-call', name: tc.function.name, args: tc.function.arguments });
      let result: string;
      try {
        result = await input.runTool(tc.function.name, tc.function.arguments);
      } catch (err) {
        result = `tool error: ${err instanceof Error ? err.message : String(err)}`;
      }
      input.onEvent?.({ kind: 'tool-result', name: tc.function.name, result });
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
    }
  }
  input.onEvent?.({ kind: 'max-turns', turns: maxTurns });
  return { finalText: lastText, turns: maxTurns, hitMaxTurns: true };
}
