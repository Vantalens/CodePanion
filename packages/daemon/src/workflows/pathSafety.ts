import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

// 通用：保证 input 解析后落在 anchor 下，让 CodeQL 的 path-injection 数据流看得到 containment。
// 用法：fs.read/write 之前把外部输入过一遍这个，CodeQL 就能跟上验证而不再报 js/path-injection。
export function ensurePathInside(input: string, anchor: string, label: string): string {
  const resolvedAnchor = resolve(anchor);
  const resolved = resolve(input);
  // 1) 词法 containment：先挡掉 ../ 与绝对路径越界。这是 CodeQL 识别的 path-injection sanitizer barrier，
  //    后续所有文件系统访问都只发生在「已过此 barrier 的 resolved」上，不会引入新的 path-injection sink。
  const rel = relative(resolvedAnchor, resolved);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`${label} must resolve inside ${resolvedAnchor}`);
  }
  // 2) 跟随 symlink 复核：纯词法 resolve 不展开软链，workspace 内一个指向外部的 link.md 能骗过第 1 步。
  //    只在目标已存在时 realpath —— 这恰好等价于「readFileSync 会不会真的读到 workspace 外的文件」
  //    （existsSync / readFileSync 都跟随软链；目标不存在则本就读不到，无需复核）。realpath 只作用于
  //    已过 barrier 的 resolved，不触碰 anchor，保持 CodeQL 数据流干净。
  if (existsSync(resolved)) {
    const real = realpathSync.native(resolved);
    const realRel = relative(resolvedAnchor, real);
    if (realRel === '..' || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) {
      throw new Error(`${label} must resolve inside ${resolvedAnchor} (after following symlinks)`);
    }
    return real;
  }
  return resolved;
}
