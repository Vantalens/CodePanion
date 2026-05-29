import { isAbsolute, relative, resolve, sep } from 'node:path';

// 通用：保证 input 解析后落在 anchor 下，让 CodeQL 的 path-injection 数据流看得到 containment。
// 用法：fs.read/write 之前把外部输入过一遍这个，CodeQL 就能跟上验证而不再报 js/path-injection。
export function ensurePathInside(input: string, anchor: string, label: string): string {
  const resolved = resolve(input);
  const resolvedAnchor = resolve(anchor);
  const rel = relative(resolvedAnchor, resolved);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`${label} must resolve inside ${resolvedAnchor}`);
  }
  return resolved;
}
