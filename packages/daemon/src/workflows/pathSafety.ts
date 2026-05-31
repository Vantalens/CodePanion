import { existsSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

// 把已存在的最长前缀 realpath 掉，再接上不存在的剩余段。
// 纯 path.resolve() 不展开 symlink：workspace 内的 link.md -> /etc/passwd 这种「叶子或中间目录是
// 指向外部的软链」会骗过词法 containment。这里对存在的部分取真实路径，越界 symlink 的真实位置就暴露出来。
// 不存在的路径无法被 readFileSync 跟随，词法值即安全，所以只 realpath 存在的部分。
function canonicalize(input: string): string {
  let current = resolve(input);
  const tail: string[] = [];
  while (!existsSync(current)) {
    const parent = resolve(current, '..');
    if (parent === current) break; // 触底到根仍不存在：返回词法值即可。
    tail.unshift(basename(current));
    current = parent;
  }
  const realBase = existsSync(current) ? realpathSync.native(current) : current;
  return tail.length ? join(realBase, ...tail) : realBase;
}

// 通用：保证 input 解析后落在 anchor 下，让 CodeQL 的 path-injection 数据流看得到 containment。
// 用法：fs.read/write 之前把外部输入过一遍这个，CodeQL 就能跟上验证而不再报 js/path-injection。
// containment 判断基于 realpath（见 canonicalize），所以也挡得住 workspace 内指向外部的 symlink。
export function ensurePathInside(input: string, anchor: string, label: string): string {
  const resolvedAnchor = canonicalize(anchor);
  const resolvedInput = canonicalize(input);
  const rel = relative(resolvedAnchor, resolvedInput);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`${label} must resolve inside ${resolvedAnchor}`);
  }
  return resolvedInput;
}
