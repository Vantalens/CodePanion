# Alpha Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a reliable Alpha verification gate, close the WebView navigation trust-boundary gap, and align package/documentation acceptance with the current multi-task-console product direction.

**Architecture:** Keep the existing Node daemon and WPF/WebView2 GUI architecture. Make narrow changes at the test transport helper, native navigation gate, packaging acceptance checks, and current-truth documentation surfaces without adding new product scope.

**Tech Stack:** Node.js `node:test`, TypeScript/JavaScript, WPF/WebView2 C#, PowerShell packaging, Markdown documentation.

---

### Task 1: Remove Random Blocked-Port Failures From Daemon Integration Tests

**Files:**
- Modify: `packages/daemon/test/server.integration.test.mjs:1-74`
- Test: `packages/daemon/test/server.integration.test.mjs`

- [ ] **Step 1: Replace the test-only fetch helper with `node:http`**

Import `request as httpRequest` from `node:http`, and implement the existing `request(...)` helper with a local HTTP request so ephemeral test ports are not filtered by the Fetch blocked-port policy:

```js
import { request as httpRequest } from 'node:http';

async function request(port, token, method, path, body, authorized = true) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(authorized ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({
        status: res.statusCode,
        body: text ? JSON.parse(text) : undefined,
      }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
```

- [ ] **Step 2: Run the integration file repeatedly to verify stability**

Run:

```powershell
1..10 | ForEach-Object { node --test packages/daemon/test/server.integration.test.mjs; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
```

Expected: all 10 invocations pass; no `Error: bad port`.

- [ ] **Step 3: Run the repository test gate**

Run: `npm test`

Expected: daemon tests and adapter-sdk tests pass; `validate:dtos` reports that C# DTO and `protocol.ts` match.

### Task 2: Close the WebView `data:` Navigation Boundary

**Files:**
- Modify: `packages/gui/MainWindow.xaml.cs:285-327`
- Modify: `packages/gui/wwwroot/chat.js:3231-3271`
- Test: `packages/daemon/test/chatWorkflowSnapshot.test.mjs`

- [ ] **Step 1: Add a failing frontend regression for a `data:` anchor**

Expose `shouldInterceptAnchor` in `window.CodePanion.__test`, then add a test creating `a[href="data:text/html,<script>alert(1)</script>"]` and asserting:

```js
assert.equal(dom.window.CodePanion.__test.shouldInterceptAnchor(anchor), true);
```

Run: `node --test packages/daemon/test/chatWorkflowSnapshot.test.mjs`

Expected: FAIL while `data:` is still treated as internal navigation.

- [ ] **Step 2: Intercept `data:` links in the Web UI**

Change `shouldInterceptAnchor` so only `#fragment`, same-host `https://codepanion.local/...`, and exact `about:blank` are left to the WebView. Do not return `false` for `data:`:

```js
if (url.host === 'codepanion.local') return false;
if (url.href === 'about:blank') return false;
return true;
```

- [ ] **Step 3: Restrict the native navigation allowlist**

Require HTTPS for the internal mapped host, then replace the `about` / `data` scheme allowance in `OnWebViewNavigationStarting` with exact allowance for `about:blank` only:

```csharp
if (uri.Scheme == Uri.UriSchemeHttps &&
    uri.Host.Equals("codepanion.local", StringComparison.OrdinalIgnoreCase))
{
    return;
}

if (string.Equals(uri.AbsoluteUri, "about:blank", StringComparison.OrdinalIgnoreCase))
{
    return;
}
```

All `data:` URIs must reach `e.Cancel = true` and then be rejected by `OpenExternalLink` as non-HTTP(S).

- [ ] **Step 4: Verify the GUI boundary changes**

Run:

```powershell
node --test packages/daemon/test/chatWorkflowSnapshot.test.mjs
npm run gui:build
```

Expected: JS snapshot tests pass and WPF GUI builds with 0 errors.

### Task 3: Make Portable-Package Acceptance Match Required Runtime Files

**Files:**
- Modify: `DEVELOPMENT_TASKS.md:270-279`
- Modify: `scripts/package-windows.ps1`
- Test: create `scripts/validate-portable-package.ps1`

- [ ] **Step 1: Rewrite the Alpha packaging criterion**

Replace the requirement that the package contain no `node_modules` with an allowlist requirement: `daemon/node_modules` may contain only the external runtime dependencies required by `daemon.cjs`, only the current RID prebuild for `node-pty`, and no test/example/source-map/debug-only content.

- [ ] **Step 2: Add a portable artifact validation script**

Create `scripts/validate-portable-package.ps1` to fail when `dist/CodePanion-win-x64/daemon/node_modules` includes a package outside the maintained allowlist, when `node-pty/prebuilds` includes a non-`win32-x64` directory, or when `.map`, `test`, `examples`, and source-only assets appear in the portable tree.

- [ ] **Step 3: Validate the packaged daemon dependency load**

Extend the script to invoke the packaged Node runtime with a harmless require probe for `node-pty`, `pino`, `sonic-boom`, and `thread-stream`, without booting the daemon:

```powershell
Push-Location -LiteralPath $distDir
try {
    & $packagedNodePath -e "require('./daemon/node_modules/node-pty'); require('./daemon/node_modules/pino'); require('./daemon/node_modules/sonic-boom'); require('./daemon/node_modules/thread-stream');"
    if ($LASTEXITCODE -ne 0) { throw "Packaged daemon runtime dependency probe failed." }
} finally {
    Pop-Location
}
```

- [ ] **Step 4: Verify packaging**

Run:

```powershell
npm run package:windows
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/validate-portable-package.ps1
```

Expected: package creation succeeds and the allowlist/smoke validation exits 0.

### Task 4: Restore Product Narrative Consistency and Config Regression Coverage

**Files:**
- Modify: `package.json:5`
- Modify: `packages/daemon/package.json:4`
- Modify: `docs/API.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/MONITORING_SOURCES.md`
- Modify: `docs/README.md`
- Modify: `packages/daemon/src/config.ts`
- Modify: `packages/daemon/test/configPermissions.test.mjs`

- [ ] **Step 1: Add failing `loadConfig` quarantine tests**

Refactor config path resolution behind an injectable test path or exported loader, then add tests using a temporary directory for malformed JSON and schema-invalid JSON. Each test must assert that the broken file is renamed to `config.json.broken-*`, a usable new config is written, and the returned token meets schema requirements.

- [ ] **Step 2: Implement the minimal injection needed for those tests**

Keep production defaults unchanged (`~/.codepanion/config.json`); only accept an optional config/home path in the loader or a small internal helper so tests do not write the real user configuration.

- [ ] **Step 3: Align current product descriptions**

Update user-facing product descriptions to use:

```text
本地优先、供应商中立、跨软件 / 跨窗口 / 跨项目的多任务完整操作台
```

Where `control plane` describes internal event/protocol mechanics, label it explicitly as an implementation concept rather than the product identity.

- [ ] **Step 4: Verify the complete stabilization batch**

Run:

```powershell
npm test
npm run gui:build
npm run package:windows
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/validate-portable-package.ps1
```

Expected: tests pass; GUI and package builds pass; package validation exits 0; no current-truth product surface advertises CodePanion as an AI coding workflow control plane.
