import { isAbsolute, relative, resolve, sep } from 'node:path';

// 通用：保证 input 解析后落在 anchor 下，让 CodeQL 的 path-injection 数据流看得到 containment。
// 用法：fs.read/write 之前把外部输入过一遍这个，CodeQL 就能跟上验证而不再报 js/path-injection。
//
// 刻意保持「纯词法」（不 realpath）：
//  1) 词法 relative + throw 是 CodeQL 识别的 path-injection sanitizer；任何在校验前对外部输入做的
//     existsSync/realpath 都会变成新的 path-injection sink（曾因此误报 2 条 high）。
//  2) realpath 会踩 Windows 短名(8.3)/长名差异——CI runner 的 TEMP 是 C:\Users\RUNNER~1\... 短名，
//     realpath 展开成长名后与词法 anchor 比较会把合法路径误判成越界。
// workspace 内「指向外部的 symlink」属于二级加固（P2），需另寻不破坏上面两点的实现，暂不在此处理。
export function ensurePathInside(input: string, anchor: string, label: string): string {
  const resolved = resolve(input);
  const resolvedAnchor = resolve(anchor);
  const rel = relative(resolvedAnchor, resolved);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`${label} must resolve inside ${resolvedAnchor}`);
  }
  return resolved;
}
