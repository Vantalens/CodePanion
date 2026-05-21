/**
 * Detects when a PTY session is "waiting for user input" using two signals:
 *  1. Idle timeout: no output for `idleMs` since the last chunk.
 *  2. Last-line heuristic: the trailing line (after stripping ANSI escape codes
 *     and trailing whitespace) ends with a prompt-y char or contains a y/n marker.
 *
 * The detector is debounced and de-duplicates: it will not re-fire while the
 * session is still in the same waiting state (until new output arrives).
 */
const ANSI_RE = /\[[0-9;?]*[ -/]*[@-~]/g;

export interface PromptDetectorOptions {
  idleMs: number;
  onPrompt: (lastLines: string, options: string[] | undefined) => void;
}

export class PromptDetector {
  private buffer = '';
  private timer: NodeJS.Timeout | null = null;
  private firedForCurrentIdle = false;

  constructor(private opts: PromptDetectorOptions) {}

  feed(chunk: string) {
    this.buffer = (this.buffer + chunk).slice(-4096);
    this.firedForCurrentIdle = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.evaluate(), this.opts.idleMs);
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private evaluate() {
    if (this.firedForCurrentIdle) return;
    const cleaned = this.buffer.replace(ANSI_RE, '');
    const lines = cleaned.split(/\r?\n/);
    const lastNonEmpty = [...lines].reverse().find((l) => l.trim().length > 0) ?? '';
    const trimmed = lastNonEmpty.trimEnd();

    if (!looksLikePrompt(trimmed, cleaned)) return;

    const lastLines = lines.slice(-6).filter((l) => l.length > 0).join('\n');
    const options = extractPromptOptions(cleaned, trimmed);
    this.firedForCurrentIdle = true;
    this.opts.onPrompt(lastLines, options);
  }
}

function looksLikePrompt(lastLine: string, fullBuffer: string): boolean {
  if (!lastLine) return false;
  if (/[?>:#$❯➜»]\s*$/.test(lastLine)) return true;
  if (/\((y\/n|yes\/no)\)\s*\??\s*$/i.test(lastLine)) return true;
  if (/\[(y\/n|y\/N|Y\/n)\]\s*$/i.test(lastLine)) return true;
  if (/(请输入|请回复|请选择|请确认|是否)/i.test(lastLine)) return true;
  if (extractPromptOptions(fullBuffer, lastLine)?.length ?? 0) return true;
  return false;
}

function extractPromptOptions(text: string, lastLine: string): string[] | undefined {
  const numbered = extractNumberedOptions(text);
  if (numbered) return numbered;
  if (/\((yes\/no)\)\s*\??\s*$/i.test(lastLine)) return ['yes', 'no'];
  if (/\((y\/n)\)\s*\??\s*$/i.test(lastLine)) return ['y', 'n'];
  if (/\[(y\/N|Y\/n|y\/n)\]\s*$/i.test(lastLine)) return ['y', 'n'];
  return undefined;
}

function extractNumberedOptions(text: string): string[] | undefined {
  const lines = text.replace(ANSI_RE, '').split(/\r?\n/);
  const opts: string[] = [];
  for (const line of lines.slice(-12)) {
    const m = line.match(/^\s*(\d+)[.)\]]\s+(.{1,80})$/);
    if (m) opts.push(`${m[1]}. ${m[2].trim()}`);
  }
  if (opts.length >= 2) return opts;
  return undefined;
}
