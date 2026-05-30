// 执行模型两轴重构：模型 API 客户端（OpenAI 兼容 /chat/completions）。
// architecture=agent 的 step 通过这里调真实模型（DeepSeek 等）。用 Node 内置 fetch，零 SDK 依赖。
// 不打印 apiKey；错误只带 status / 截断的 body，避免把凭据写进日志。
import type { ModelBackend } from '../config.js';

// OpenAI 兼容消息。tool-use 循环需要：assistant 可带 tool_calls、新增 tool 角色回填工具结果。
export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content?: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

// OpenAI 兼容 function tool 声明（parameters 为 JSON Schema）。
export type ChatTool = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ChatCompletionResult = {
  text: string;
  toolCalls?: ToolCall[];
  finishReason?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  raw: unknown;
};

export class ModelClientError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ModelClientError';
  }
}

function joinUrl(baseURL: string, path: string): string {
  const trimmed = baseURL.replace(/\/+$/, '');
  return `${trimmed}${path}`;
}

/**
 * 调一次 OpenAI 兼容的 /chat/completions（非流式），返回首个 choice 的文本。
 * - signal：接 run cancel（AbortController.signal）。
 * - 失败（网络 / 非 2xx / 解析）一律抛 ModelClientError，由调用方归一成 failed step。
 */
export async function chatCompletion(input: {
  backend: ModelBackend;
  messages: ChatMessage[];
  tools?: ChatTool[];
  signal?: AbortSignal;
}): Promise<ChatCompletionResult> {
  const { backend, messages, tools, signal } = input;
  const url = joinUrl(backend.baseURL, '/chat/completions');
  const body: Record<string, unknown> = {
    model: backend.model,
    messages,
  };
  if (typeof backend.temperature === 'number') body.temperature = backend.temperature;
  if (typeof backend.maxTokens === 'number') body.max_tokens = backend.maxTokens;
  // tool-use：有工具时带 tools，让模型可以发 function tool_calls。
  if (tools && tools.length > 0) body.tools = tools;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(backend.apiKey ? { Authorization: `Bearer ${backend.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ModelClientError('model request aborted');
    }
    throw new ModelClientError(`model request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const rawText = await response.text();
  if (!response.ok) {
    // 只带前 500 字 body，避免把可能的敏感回显写进日志；绝不带 apiKey。
    throw new ModelClientError(`model API ${response.status}: ${rawText.slice(0, 500)}`, response.status);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new ModelClientError(`model API returned non-JSON body: ${rawText.slice(0, 200)}`);
  }

  const message = parsed?.choices?.[0]?.message;
  const text: string = message?.content ?? '';
  const finishReason: string | undefined = parsed?.choices?.[0]?.finish_reason ?? undefined;
  // 解析 tool_calls（仅保留 function 型，结构归一为 ToolCall）。
  let toolCalls: ToolCall[] | undefined;
  if (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) {
    toolCalls = message.tool_calls
      .filter((tc: any) => tc && tc.function && typeof tc.function.name === 'string')
      .map((tc: any) => ({
        id: typeof tc.id === 'string' ? tc.id : '',
        type: 'function' as const,
        function: { name: tc.function.name, arguments: typeof tc.function.arguments === 'string' ? tc.function.arguments : '' },
      }));
    if (toolCalls && toolCalls.length === 0) toolCalls = undefined;
  }
  const usage = parsed?.usage
    ? {
        promptTokens: parsed.usage.prompt_tokens,
        completionTokens: parsed.usage.completion_tokens,
        totalTokens: parsed.usage.total_tokens,
      }
    : undefined;
  return { text, toolCalls, finishReason, usage, raw: parsed };
}
