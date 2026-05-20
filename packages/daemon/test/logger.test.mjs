import assert from 'node:assert/strict';
import test from 'node:test';
import { homedir } from 'node:os';
import { Writable } from 'node:stream';
import { createLogger, maskString, maskValue } from '../dist/logger.js';

function captureLogger() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString('utf8'));
      cb();
    },
  });
  const logger = createLogger({ level: 'trace', destination: stream });
  return {
    logger,
    output() {
      return chunks.join('');
    },
    lines() {
      return chunks.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    },
  };
}

// ---------- maskString ----------

test('maskString replaces homedir prefix with ~', () => {
  const home = homedir();
  const sample = `${home}/Projects/secret/file.txt`;
  const out = maskString(sample);
  assert.equal(out.includes(home), false, `expected homedir stripped, got: ${out}`);
  assert.match(out, /^~[\\/]Projects/);
});

test('maskString redacts Bearer tokens', () => {
  const out = maskString('Authorization: Bearer abcDEF1234567890');
  assert.equal(out.includes('abcDEF1234567890'), false);
  assert.match(out, /Bearer \[Redacted\]/);
});

test('maskString redacts token query-string params', () => {
  const out = maskString('ws://127.0.0.1:7777/ws?role=observer&token=deadbeefcafebabe&other=x');
  assert.equal(out.includes('deadbeefcafebabe'), false);
  assert.match(out, /token=\[Redacted\]/);
  assert.match(out, /other=x/); // unrelated params preserved
});

test('maskString redacts standalone long hex tokens', () => {
  const out = maskString('token issued: 1a2b3c4d5e6f7890abcdef1234567890ab');
  assert.equal(/[0-9a-f]{32,}/.test(out), false);
  assert.match(out, /\[Redacted\]/);
});

test('maskString leaves short hex / non-secret strings alone', () => {
  assert.equal(maskString('error code 0xdeadbeef'), 'error code 0xdeadbeef');
  assert.equal(maskString('Hello world'), 'Hello world');
  assert.equal(maskString(''), '');
});

// ---------- maskValue ----------

test('maskValue recurses through nested objects and arrays', () => {
  const home = homedir();
  const input = {
    cwd: `${home}/code/proj`,
    items: [
      { path: `${home}/a.txt`, name: 'a' },
      { path: `${home}/b.txt`, name: 'b' },
    ],
    error: { stack: `Error: at ${home}/x.js:1` },
  };
  const out = maskValue(input);
  assert.equal(JSON.stringify(out).includes(home), false, `homedir leaked: ${JSON.stringify(out)}`);
  assert.equal(out.items[0].path, '~/a.txt');
  assert.equal(out.error.stack, 'Error: at ~/x.js:1');
});

test('maskValue handles circular references safely', () => {
  const a = { name: 'a' };
  a.self = a;
  const out = maskValue(a);
  assert.equal(out.name, 'a');
  assert.equal(out.self, '[Circular]');
});

// ---------- logger field redaction ----------

test('logger redacts known sensitive field names via pino redact', () => {
  const cap = captureLogger();
  cap.logger.info({ token: 'plaintext-token-value' }, 'op');
  cap.logger.info({ headers: { authorization: 'Bearer xyz' } }, 'req');
  cap.logger.info({ apiKey: 'live_abc123' }, 'cfg');
  cap.logger.info({ password: 'hunter2' }, 'cfg');
  const raw = cap.output();
  assert.equal(raw.includes('plaintext-token-value'), false, `token leaked: ${raw}`);
  assert.equal(raw.includes('live_abc123'), false);
  assert.equal(raw.includes('hunter2'), false);
  // 'Bearer xyz' is short enough that the BEARER_REGEX (min 8 chars) doesn't match, BUT
  // the authorization field path redact must still cover it.
  const lines = cap.lines();
  const reqLine = lines.find((l) => l.msg === 'req');
  assert.equal(reqLine?.headers?.authorization, '[Redacted]');
});

test('logger masks homedir paths inside structured fields', () => {
  const home = homedir();
  const cap = captureLogger();
  cap.logger.warn({ snapshotPath: `${home}/.codepanion/snapshot.json` }, 'snapshot save failed');
  cap.logger.info({ root: `${home}/.codex/sessions` }, 'scan root');
  const raw = cap.output();
  assert.equal(raw.includes(home), false, `homedir leaked: ${raw}`);
  const lines = cap.lines();
  assert.equal(lines[0].snapshotPath, '~/.codepanion/snapshot.json');
  assert.equal(lines[1].root, '~/.codex/sessions');
});

test('logger redacts Bearer tokens and query-string tokens in free-form string fields', () => {
  const cap = captureLogger();
  cap.logger.warn({ message: 'failed with Authorization: Bearer abcDEF1234567890' }, 'http error');
  cap.logger.info({ url: 'ws://127.0.0.1:7777/ws?role=observer&token=deadbeefcafebabe' }, 'connect');
  const raw = cap.output();
  assert.equal(raw.includes('abcDEF1234567890'), false, `bearer token leaked: ${raw}`);
  assert.equal(raw.includes('deadbeefcafebabe'), false, `query token leaked: ${raw}`);
});

test('logger masks homedir paths inside error stacks (err field)', () => {
  const home = homedir();
  const cap = captureLogger();
  const err = new Error('boom');
  err.stack = `Error: boom\n    at Module._compile (${home}/code/x.js:10:5)\n    at ${home}/y.js:1`;
  cap.logger.error({ err }, 'crash');
  const raw = cap.output();
  assert.equal(raw.includes(home), false, `homedir leaked through err stack: ${raw}`);
  const line = cap.lines()[0];
  // pino's standard err serializer puts the stack on err.stack — confirm masking reached it.
  const stackText = JSON.stringify(line);
  assert.match(stackText, /~[\\/]code[\\/]x\.js/);
});
