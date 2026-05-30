import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { chatCompletion, ModelClientError } from '../dist/models/modelClient.js';

// 执行模型两轴重构：modelClient 单测。起一个本地 http stub 冒充 OpenAI 兼容端点，
// 断言请求头/体与返回解析、错误分支抛 ModelClientError。不打真实网络。

function withStub(handler, run) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => handler(req, res, body));
    });
    server.listen(0, '127.0.0.1', async () => {
      const { port } = server.address();
      try {
        await run(`http://127.0.0.1:${port}`);
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

test('chatCompletion 发到 /chat/completions，带 model/messages/Authorization，解析 choices 文本', async () => {
  let seen = null;
  await withStub((req, res, body) => {
    seen = { url: req.url, auth: req.headers['authorization'], ct: req.headers['content-type'], body: JSON.parse(body) };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'HELLO_FROM_MODEL' } }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    }));
  }, async (baseURL) => {
    const result = await chatCompletion({
      backend: { kind: 'openai-compatible', baseURL, apiKey: 'sk-test', model: 'demo-model', temperature: 0.2, maxTokens: 100 },
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
    });
    assert.equal(result.text, 'HELLO_FROM_MODEL');
    assert.equal(result.usage.totalTokens, 8);
    assert.equal(seen.url, '/chat/completions');
    assert.equal(seen.auth, 'Bearer sk-test');
    assert.match(seen.ct, /application\/json/);
    assert.equal(seen.body.model, 'demo-model');
    assert.equal(seen.body.temperature, 0.2);
    assert.equal(seen.body.max_tokens, 100);
    assert.equal(seen.body.messages.length, 2);
    assert.equal(seen.body.messages[0].role, 'system');
  });
});

test('tools 进请求体；解析 choices[0].message.tool_calls 与 finish_reason', async () => {
  let seenBody = null;
  await withStub((req, res, body) => {
    seenBody = JSON.parse(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
          ],
        },
      }],
    }));
  }, async (baseURL) => {
    const tools = [{ type: 'function', function: { name: 'read_file', description: 'read', parameters: { type: 'object' } } }];
    const result = await chatCompletion({
      backend: { kind: 'openai-compatible', baseURL, apiKey: '', model: 'm' },
      messages: [{ role: 'user', content: 'go' }],
      tools,
    });
    // tools 进请求体。
    assert.ok(Array.isArray(seenBody.tools));
    assert.equal(seenBody.tools[0].function.name, 'read_file');
    // tool_calls 与 finish_reason 被解析。
    assert.equal(result.finishReason, 'tool_calls');
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].id, 'call_1');
    assert.equal(result.toolCalls[0].function.name, 'read_file');
    assert.equal(result.toolCalls[0].function.arguments, '{"path":"a.txt"}');
    assert.equal(result.text, '');
  });
});

test('无 tools 时请求体不带 tools 字段，普通文本回复无 toolCalls', async () => {
  let seenBody = null;
  await withStub((req, res, body) => {
    seenBody = JSON.parse(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'done' } }] }));
  }, async (baseURL) => {
    const result = await chatCompletion({
      backend: { kind: 'openai-compatible', baseURL, apiKey: '', model: 'm' },
      messages: [{ role: 'user', content: 'x' }],
    });
    assert.equal('tools' in seenBody, false);
    assert.equal(result.toolCalls, undefined);
    assert.equal(result.text, 'done');
    assert.equal(result.finishReason, 'stop');
  });
});

test('baseURL 末尾斜杠被规整，不双斜杠', async () => {
  let url = null;
  await withStub((req, res) => {
    url = req.url;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
  }, async (baseURL) => {
    await chatCompletion({
      backend: { kind: 'openai-compatible', baseURL: `${baseURL}/`, apiKey: '', model: 'm' },
      messages: [{ role: 'user', content: 'x' }],
    });
    assert.equal(url, '/chat/completions');
  });
});

test('非 2xx 抛 ModelClientError 带 status，且不含 apiKey', async () => {
  await withStub((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
  }, async (baseURL) => {
    await assert.rejects(
      () => chatCompletion({
        backend: { kind: 'openai-compatible', baseURL, apiKey: 'sk-secret-XYZ', model: 'm' },
        messages: [{ role: 'user', content: 'x' }],
      }),
      (err) => {
        assert.ok(err instanceof ModelClientError);
        assert.equal(err.status, 401);
        assert.equal(err.message.includes('sk-secret-XYZ'), false, '错误信息不得泄露 apiKey');
        return true;
      },
    );
  });
});

test('非 JSON body 抛 ModelClientError', async () => {
  await withStub((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('not json');
  }, async (baseURL) => {
    await assert.rejects(
      () => chatCompletion({
        backend: { kind: 'openai-compatible', baseURL, apiKey: '', model: 'm' },
        messages: [{ role: 'user', content: 'x' }],
      }),
      (err) => err instanceof ModelClientError,
    );
  });
});

test('AbortSignal 已 abort 时抛 ModelClientError', async () => {
  await withStub((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
  }, async (baseURL) => {
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(
      () => chatCompletion({
        backend: { kind: 'openai-compatible', baseURL, apiKey: '', model: 'm' },
        messages: [{ role: 'user', content: 'x' }],
        signal: ac.signal,
      }),
      (err) => err instanceof ModelClientError,
    );
  });
});
