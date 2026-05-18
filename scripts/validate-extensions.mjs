import { readFile } from 'node:fs/promises';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

const vscodePkg = await readJson('packages/vscode-extension/package.json');
if (!vscodePkg.main || !vscodePkg.engines?.vscode) {
  throw new Error('VS Code extension package.json is missing main or engines.vscode');
}

console.log('VS Code extension manifest ok');
