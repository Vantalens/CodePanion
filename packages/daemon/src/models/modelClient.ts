// 执行模型两轴重构：模型 API 客户端（OpenAI 兼容 /chat/completions）。
// architecture=agent 的 step 通过这里调真实模型（DeepSeek 等）。用 Node 内置 fetch，零 SDK 依赖。
// 不打印 apiKey；错误只带 status / 截断的 body，避免把凭据写进日志。
import type { ModelBackend } from '../config.js';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type ChatCompletionResult = {
  text: string;
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
  signal?: AbortSignal;
}): Promise<ChatCompletionResult> {
  const { backend, messages, signal } = input;
  const url = joinUrl(backend.baseURL, '/chat/completions');
  const body: Record<string, unknown> = {
    model: backend.model,
    messages,
  };
  if (typeof backend.temperature === 'number') body.temperature = backend.temperature;
  if (typeof backend.maxTokens === 'number') body.max_tokens = backend.maxTokens;

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

  const text: string = parsed?.choices?.[0]?.message?.content ?? '';
  const usage = parsed?.usage
    ? {
        promptTokens: parsed.usage.prompt_tokens,
        completionTokens: parsed.usage.completion_tokens,
        totalTokens: parsed.usage.total_tokens,
      }
    : undefined;
  return { text, usage, raw: parsed };
}
