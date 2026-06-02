import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const markdownSource = readFileSync(resolve(here, '../../gui/wwwroot/markdown.js'), 'utf8');
const projectsSource = readFileSync(resolve(here, '../../gui/wwwroot/projects.js'), 'utf8');
const settingsSource = readFileSync(resolve(here, '../../gui/wwwroot/settings.js'), 'utf8');
const codexSource = readFileSync(resolve(here, '../../gui/wwwroot/codex.js'), 'utf8');

const SHELL = `<!doctype html><html><body>
  <aside>
    <button id="new-chat-btn"></button>
    <button id="settings-btn"></button>
    <button id="workflow-btn"></button>
    <button id="projects-add-btn"></button>
    <div id="projects-list"></div>
    <select id="project-select"></select>
    <button id="project-manage"></button>
    <div id="project-dialog" hidden><div id="project-list"></div><input id="project-search"></div>
    <div id="sessions-list"></div>
    <span id="session-count"></span>
    <span id="status-dot"></span>
    <span id="status-text"></span>
  </aside>
  <main>
    <div id="empty-state"></div>
    <div id="chat-container" hidden>
      <div id="messages"></div>
    </div>
    <textarea id="message-input"></textarea>
    <button id="send-btn"></button>
    <button id="attach-btn"></button>
  </main>
  <div id="project-form-dialog" class="dialog-overlay" hidden>
    <form id="project-form">
      <input id="project-form-id">
      <input id="project-form-name">
      <input id="project-form-path">
      <textarea id="project-form-description"></textarea>
      <button id="project-form-close" data-close="project-form-dialog"></button>
      <button id="project-form-cancel" data-close="project-form-dialog"></button>
    </form>
  </div>
  <div id="settings-dialog" class="dialog-overlay" hidden>
    <button id="settings-dialog-close" data-close="settings-dialog"></button>
    <button class="settings-tab active" data-tab="providers"></button>
    <button class="settings-tab" data-tab="models"></button>
    <div id="settings-providers" class="settings-content">
      <button id="provider-add"></button>
      <div id="provider-list"></div>
    </div>
    <div id="settings-models" class="settings-content" hidden>
      <div id="model-config-container"></div>
    </div>
  </div>
  <div id="provider-form-dialog" class="dialog-overlay" hidden>
    <form id="provider-form">
      <input id="provider-form-id">
      <input id="provider-form-name">
      <select id="provider-form-type"><option value="openai">OpenAI</option></select>
      <input id="provider-form-apikey">
      <input id="provider-form-apibase">
      <button id="provider-form-close" data-close="provider-form-dialog"></button>
      <button id="provider-form-cancel" data-close="provider-form-dialog"></button>
    </form>
  </div>
</body></html>`;

function loadCodex() {
  const dom = new JSDOM(SHELL, { runScripts: 'outside-only', url: 'https://codepanion.local/' });
  const sent = [];
  dom.window.chrome = { webview: { postMessage: (m) => sent.push(m), addEventListener: () => {} } };
  dom.window.alert = () => {};
  dom.window.confirm = () => true;
  dom.window.eval(markdownSource);
  dom.window.eval(projectsSource);
  dom.window.eval(settingsSource);
  dom.window.eval(codexSource);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  return { dom, window: dom.window, document: dom.window.document, sent };
}

test('codex page scripts load and send ready without parse/runtime errors', () => {
  const { sent } = loadCodex();
  assert.ok(sent.some((m) => m.type === 'ready'));
});

test('first user message shows unavailable chat guidance without host create-session', () => {
  const { document, sent } = loadCodex();
  document.getElementById('message-input').value = 'build a test workflow';
  document.getElementById('send-btn').click();

  assert.equal(sent.some((m) => m.type === 'create-session'), false);
  assert.match(document.getElementById('messages').textContent, /对话式会话创建接口已下线/);
  assert.match(document.getElementById('sessions-list').textContent, /失败/);
});

test('provider and model host messages render through settings module', () => {
  const { window, document } = loadCodex();
  window.dispatchEvent(new window.MessageEvent('message', {
    data: {
      type: 'providers',
      providers: [{
        id: 'openai',
        name: 'OpenAI',
        type: 'openai',
        status: 'active',
        config: { baseUrl: 'https://api.openai.com/v1', apiKey: 'redacted' },
      }],
    },
  }));

  assert.match(document.getElementById('provider-list').textContent, /OpenAI/);
  assert.match(document.getElementById('provider-list').textContent, /https:\/\/api\.openai\.com\/v1/);

  window.dispatchEvent(new window.MessageEvent('message', {
    data: {
      type: 'models',
      models: [
        {
          id: 'provider:openai:model:gpt-test',
          modelId: 'gpt-test',
          providerId: 'openai',
          name: 'GPT Test',
          provider: 'openai',
        },
        {
          id: 'provider:openai:model:review-model',
          modelId: 'review-model',
          providerId: 'openai',
          name: 'Review Model',
          provider: 'openai',
        },
      ],
      defaultModel: 'provider:openai:model:gpt-test',
      roleBindings: { reviewer: 'provider:openai:model:review-model' },
    },
  }));
  assert.match(document.getElementById('model-config-container').textContent, /GPT Test/);
  assert.equal(document.getElementById('default-model-select').value, 'provider:openai:model:gpt-test');
  assert.equal(document.querySelector('select[data-role="reviewer"]').value, 'provider:openai:model:review-model');
});

test('project host messages update sidebar and shared project management state', () => {
  const { window, document } = loadCodex();
  window.dispatchEvent(new window.MessageEvent('message', {
    data: {
      type: 'projects',
      projects: [{ id: 'p1', name: 'Alpha', path: 'D:\\Alpha', active: true }],
    },
  }));

  assert.match(document.getElementById('projects-list').textContent, /Alpha/);
  assert.match(document.getElementById('project-select').textContent, /Alpha/);
  document.getElementById('project-manage').click();
  assert.match(document.getElementById('project-list').textContent, /Alpha/);
});

test('assistant markdown is sanitized before insertion into message body', () => {
  const { window, document } = loadCodex();
  window.dispatchEvent(new window.MessageEvent('message', {
    data: { type: 'session-registered', session: { id: 's1', command: 'demo', status: 'running' } },
  }));
  document.querySelector('.session-item').click();
  window.dispatchEvent(new window.MessageEvent('message', {
    data: {
      type: 'add-message',
      data: {
        sessionId: 's1',
        type: 'output',
        content: 'ok <script>alert(1)</script> [bad](javascript:alert(2))',
      },
    },
  }));

  const body = document.querySelector('.message-body').innerHTML;
  assert.equal(body.toLowerCase().includes('<script'), false);
  assert.equal(body.toLowerCase().includes('javascript:'), false);
});
