import { readFile } from 'node:fs/promises';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

const vscodePkg = await readJson('packages/vscode-extension/package.json');
if (!vscodePkg.main || !vscodePkg.engines?.vscode) {
  throw new Error('VS Code extension package.json is missing main or engines.vscode');
}

const manifest = await readJson('packages/browser-extension/manifest.json');
if (manifest.manifest_version !== 3) {
  throw new Error('Browser extension must use Manifest V3');
}
if (!manifest.background?.service_worker || !Array.isArray(manifest.content_scripts)) {
  throw new Error('Browser extension manifest is missing background or content scripts');
}

console.log('extension manifests ok');
