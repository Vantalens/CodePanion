import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const FALLBACK = '0.0.0';

function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/shared/version.js   -> ../../package.json
    // bundle/daemon.cjs        -> ../package.json
    for (const rel of ['../../package.json', '../package.json']) {
      try {
        const raw = readFileSync(resolve(here, rel), 'utf8');
        const pkg = JSON.parse(raw) as { version?: string; name?: string };
        if (pkg.name && pkg.version && pkg.name.includes('codepanion')) {
          return pkg.version;
        }
      } catch {
        // try next candidate
      }
    }
  } catch {
    // ignore — fall through to fallback
  }
  return FALLBACK;
}

export const VERSION: string = readVersion();
