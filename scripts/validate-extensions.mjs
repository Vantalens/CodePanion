import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve, join, isAbsolute } from 'node:path';

const errors = [];

function fail(msg) {
  errors.push(msg);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function fileExists(path) {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

function isSemverRange(value) {
  return typeof value === 'string' && /^[~^>=<]*\d+(\.\d+){0,2}/.test(value.trim());
}

async function validateVscodeManifest(pkgPath) {
  const pkg = await readJson(pkgPath);
  const root = dirname(pkgPath);
  const label = pkg.name || pkgPath;

  for (const field of ['name', 'displayName', 'version', 'publisher', 'description']) {
    if (!pkg[field]) fail(`${label}: missing required field "${field}"`);
  }

  if (!pkg.engines?.vscode) {
    fail(`${label}: engines.vscode is required`);
  } else if (!isSemverRange(pkg.engines.vscode)) {
    fail(`${label}: engines.vscode "${pkg.engines.vscode}" is not a recognized semver range`);
  }

  if (!Array.isArray(pkg.activationEvents) || pkg.activationEvents.length === 0) {
    fail(`${label}: activationEvents must be a non-empty array`);
  }

  if (!pkg.main) {
    fail(`${label}: main entry is required`);
  } else {
    const mainRel = pkg.main.startsWith('./') ? pkg.main.slice(2) : pkg.main;
    const mainPath = isAbsolute(mainRel) ? mainRel : join(root, mainRel);
    if (!(await fileExists(mainPath))) {
      fail(`${label}: main entry "${pkg.main}" does not resolve to a file (${mainPath})`);
    } else {
      const source = await readFile(mainPath, 'utf8');
      if (!/exports\.activate|module\.exports\s*=\s*\{[^}]*activate/.test(source)) {
        fail(`${label}: ${pkg.main} does not appear to export an "activate" function`);
      }
      if (!/exports\.deactivate|module\.exports\s*=\s*\{[^}]*deactivate/.test(source)) {
        fail(`${label}: ${pkg.main} does not appear to export a "deactivate" function`);
      }
      if (/require\(['"]vscode['"]\)/.test(source) === false) {
        fail(`${label}: ${pkg.main} never imports the "vscode" host API`);
      }
    }
  }

  if (pkg.contributes?.configuration) {
    const configs = Array.isArray(pkg.contributes.configuration)
      ? pkg.contributes.configuration
      : [pkg.contributes.configuration];
    for (const block of configs) {
      const props = block.properties ?? {};
      for (const [key, prop] of Object.entries(props)) {
        if (!prop || typeof prop !== 'object') {
          fail(`${label}: contributes.configuration["${key}"] is not an object`);
          continue;
        }
        if (!prop.type) fail(`${label}: contributes.configuration["${key}"] missing "type"`);
        if (!prop.description) fail(`${label}: contributes.configuration["${key}"] missing "description"`);
      }
    }
  }
}

await validateVscodeManifest(resolve('packages/vscode-extension/package.json'));

if (errors.length > 0) {
  for (const err of errors) console.error(`✗ ${err}`);
  console.error(`\n${errors.length} extension manifest issue(s) detected.`);
  process.exit(1);
}

console.log('VS Code extension manifest + activation contract ok');
