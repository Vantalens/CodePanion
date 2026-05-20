import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(here, '../../gui/wwwroot/vendor/codepanion-markdown.js');
const SCRIPT_SOURCE = readFileSync(SCRIPT_PATH, 'utf8');

function loadSanitizer() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
  dom.window.eval(SCRIPT_SOURCE);
  return dom.window;
}

test('DOMPurify drops <script> tags entirely', () => {
  const { DOMPurify } = loadSanitizer();
  const clean = DOMPurify.sanitize('<p>before</p><script>window.x = 1;</script><p>after</p>');
  assert.equal(clean.toLowerCase().includes('<script'), false);
  assert.equal(clean.includes('window.x'), false);
  assert.match(clean, /<p>before<\/p>/);
  assert.match(clean, /<p>after<\/p>/);
});

test('DOMPurify strips on* event handler attributes (e.g. onerror, onclick)', () => {
  const { DOMPurify } = loadSanitizer();
  const dirty = '<img src="x" onerror="alert(1)"><a href="#" onclick="alert(2)">click</a><div onmouseover="evil()">hi</div>';
  const clean = DOMPurify.sanitize(dirty);
  assert.equal(/onerror=/i.test(clean), false);
  assert.equal(/onclick=/i.test(clean), false);
  assert.equal(/onmouseover=/i.test(clean), false);
  assert.equal(clean.includes('alert('), false);
  assert.equal(clean.includes('evil()'), false);
});

test('DOMPurify rejects javascript:, vbscript:, and data:text/html URLs in href', () => {
  const { DOMPurify } = loadSanitizer();
  for (const proto of ['javascript:alert(1)', 'JaVaScRiPt:alert(2)', 'vbscript:msgbox', 'data:text/html,<script>alert(3)</script>', '  javascript:alert(4)']) {
    const clean = DOMPurify.sanitize(`<a href="${proto}">link</a>`);
    assert.equal(/href=/i.test(clean), false, `expected href stripped for ${proto}, got ${clean}`);
    assert.equal(/javascript:/i.test(clean), false, `expected javascript: scheme stripped, got ${clean}`);
    assert.equal(/vbscript:/i.test(clean), false, `expected vbscript: scheme stripped, got ${clean}`);
  }
});

test('DOMPurify preserves safe http(s) / mailto / fragment links', () => {
  const { DOMPurify } = loadSanitizer();
  const clean = DOMPurify.sanitize('<a href="https://example.com">a</a><a href="mailto:user@example.com">b</a><a href="#section">c</a>');
  assert.match(clean, /href="https:\/\/example\.com"/);
  assert.match(clean, /href="mailto:user@example\.com"/);
  assert.match(clean, /href="#section"/);
});

test('DOMPurify drops <iframe>, <object>, <embed>, <style>, <link>, <meta>, <base>, <form>', () => {
  const { DOMPurify } = loadSanitizer();
  const dirty = [
    '<iframe src="https://evil.example.com"></iframe>',
    '<object data="payload"></object>',
    '<embed src="payload">',
    '<style>body{display:none}</style>',
    '<link rel="stylesheet" href="https://evil.example.com/x.css">',
    '<meta http-equiv="refresh" content="0;url=https://evil.example.com">',
    '<base href="https://evil.example.com/">',
    '<form action="https://evil.example.com"><input name="x"></form>',
    '<p>survivor</p>',
  ].join('');
  const clean = DOMPurify.sanitize(dirty);
  for (const tag of ['iframe', 'object', 'embed', 'style', 'link', 'meta', 'base', 'form', 'input']) {
    assert.equal(new RegExp(`<${tag}`, 'i').test(clean), false, `expected <${tag}> stripped, got ${clean}`);
  }
  assert.match(clean, /<p>survivor<\/p>/);
});

test('DOMPurify unwraps unknown tags but preserves child text', () => {
  const { DOMPurify } = loadSanitizer();
  const clean = DOMPurify.sanitize('<custom-tag><b>kept text</b></custom-tag><unknown>plain</unknown>');
  assert.equal(/<custom-tag/i.test(clean), false);
  assert.equal(/<unknown/i.test(clean), false);
  assert.match(clean, /<b>kept text<\/b>/);
  assert.match(clean, /plain/);
});

test('DOMPurify strips disallowed attributes such as style, id, srcset', () => {
  const { DOMPurify } = loadSanitizer();
  const clean = DOMPurify.sanitize('<span class="ok" style="color:red" id="x" data-evil="y">text</span>');
  assert.match(clean, /class="ok"/);
  assert.equal(/style=/i.test(clean), false);
  assert.equal(/id=/i.test(clean), false);
  assert.equal(/data-evil=/i.test(clean), false);
});

test('DOMPurify removes HTML comments (which can carry conditional IE payloads)', () => {
  const { DOMPurify } = loadSanitizer();
  const clean = DOMPurify.sanitize('<p>visible</p><!--[if IE]><script>alert(1)</script><![endif]--><p>also</p>');
  assert.equal(clean.includes('<!--'), false);
  assert.equal(clean.toLowerCase().includes('<script'), false);
  assert.equal(clean.includes('alert(1)'), false);
});

test('marked.parse output through DOMPurify safely escapes raw <script> inside markdown', () => {
  const { marked, DOMPurify } = loadSanitizer();
  const dirty = 'normal text <script>alert(1)</script> end';
  const rendered = marked.parse(dirty);
  const clean = DOMPurify.sanitize(rendered);
  // No actual <script> tag should reach the DOM — the dangerous form is the open angle bracket.
  assert.equal(clean.toLowerCase().includes('<script'), false);
  // Escaped text content is allowed to keep the literal characters the user typed; what matters
  // is that the < is encoded so the browser cannot parse it as a tag.
  assert.match(clean, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
