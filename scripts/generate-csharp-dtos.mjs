#!/usr/bin/env node
// 从 packages/daemon/dist/shared/protocol.js 的 Zod schemas 生成 GUI 端 C# DTO。
// 真相来源：packages/daemon/src/shared/protocol.ts。
//
// 用法（推荐走 npm 脚本，会自动 build daemon）：
//   npm run gen:dtos        // 写入 .g.cs
//   npm run validate:dtos   // 仅校验；漂移时退出码 1
//
// 直接调用 node 时需要先 npm run build -w packages/daemon。

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const distPath = resolve(repoRoot, 'packages/daemon/dist/shared/protocol.js');
const outPath = resolve(repoRoot, 'packages/gui/Models/Generated/ProtocolDtos.g.cs');

const isDebug = process.env.CODEPANION_DEBUG === '1' || process.env.LOG_LEVEL === 'debug';

function debug(msg) {
  if (isDebug) console.error(`[gen-dtos] ${msg}`);
}

if (!existsSync(distPath)) {
  console.error(`找不到 ${distPath}，请先运行: npm run build -w packages/daemon`);
  process.exit(2);
}

const protocol = await import(pathToFileURL(distPath).href);

const pascal = (s) => s[0].toUpperCase() + s.slice(1);

// 限定到 schema 的字段级类型 hint：key 形如 "SchemaName.fieldName"。
// 用于把语义清晰的整数字段保留为 int? 而不是 long?，避免未来同名字段被误覆盖。
const FIELD_TYPE_HINTS = {
  'MonitorSourceInfo.pid': 'int?',
  'SessionInfo.exitCode': 'int?',
};

// 限定到 schema 的字段级默认值 hint：保留手写 DTO 的语义默认（如 Status="running"）。
// schema 上 enum 字段没有 Zod default，但 GUI 在 JSON 字段缺失时会展示 "未知"，所以这里补一层 C# 端兜底。
const FIELD_DEFAULT_HINTS = {
  'SessionInfo.status': '"running"',
  'MonitorSourceInfo.status': '"online"',
};

function unwrap(schema) {
  let cur = schema;
  let optional = false;
  for (;;) {
    if (cur instanceof z.ZodOptional) { optional = true; cur = cur.unwrap(); continue; }
    if (cur instanceof z.ZodNullable) { optional = true; cur = cur.unwrap(); continue; }
    if (cur instanceof z.ZodDefault) {
      const inner = cur.def?.innerType ?? cur._def?.innerType;
      if (!inner) throw new Error('无法解开 ZodDefault：找不到 innerType');
      cur = inner;
      continue;
    }
    break;
  }
  return { schema: cur, optional };
}

function isIntegerNumber(schema, fieldRef) {
  const def = schema.def ?? schema._def ?? {};
  const checks = def.checks ?? [];
  if (checks.length === 0) return false;
  const isIntV3 = checks.some((c) => c?.kind === 'int');
  const isIntV4 = checks.some(
    (c) => c?._zod?.def?.format === 'safeint' || c?._zod?.def?.check === 'number_format',
  );
  if (!isIntV3 && !isIntV4) {
    debug(
      `${fieldRef}: ZodNumber 有 checks 但都不是 int 标志，回退为 double。` +
        ` 如果未来 schema 显式标了 .int() 仍未命中，可能是 Zod API 变更，请检查生成器。`,
    );
  }
  return isIntV3 || isIntV4;
}

function csBaseType(schema, fieldRef) {
  if (schema instanceof z.ZodString) return 'string';
  if (schema instanceof z.ZodNumber) return isIntegerNumber(schema, fieldRef) ? 'long' : 'double';
  if (schema instanceof z.ZodBoolean) return 'bool';
  if (schema instanceof z.ZodEnum) return 'string';
  if (schema instanceof z.ZodArray) {
    const inner = unwrap(schema.element);
    const innerType = csBaseType(inner.schema, `${fieldRef}[]`).replace(/\?$/, '');
    return `${innerType}[]`;
  }
  if (schema instanceof z.ZodObject) {
    throw new Error(
      `${fieldRef}: 嵌套 ZodObject 未支持。请在 generate-csharp-dtos.mjs 中显式扩展生成器或拆为独立 schema。`,
    );
  }
  throw new Error(`${fieldRef}: 未支持的 Zod 类型 ${schema?.constructor?.name ?? typeof schema}`);
}

function csFieldType(schemaName, fieldName, fieldSchema) {
  const ref = `${schemaName}.${fieldName}`;
  if (FIELD_TYPE_HINTS[ref]) return FIELD_TYPE_HINTS[ref];
  const { schema, optional } = unwrap(fieldSchema);
  const base = csBaseType(schema, ref);
  if (optional) {
    if (base.endsWith('[]')) return `${base}?`;
    return base === 'string' ? 'string?' : `${base}?`;
  }
  return base;
}

function csDefault(schemaName, fieldName, csType) {
  const overrideRef = `${schemaName}.${fieldName}`;
  if (FIELD_DEFAULT_HINTS[overrideRef]) {
    return ` = ${FIELD_DEFAULT_HINTS[overrideRef]};`;
  }
  if (csType === 'string') return ' = "";';
  if (csType.endsWith('[]')) {
    const elem = csType.slice(0, -2);
    return ` = Array.Empty<${elem}>();`;
  }
  return '';
}

function emitClass(className, schema) {
  const lines = [];
  lines.push(`    public class ${className}`);
  lines.push('    {');
  for (const [key, fieldSchema] of Object.entries(schema.shape)) {
    const csName = pascal(key);
    const csType = csFieldType(className, key, fieldSchema);
    lines.push(`        public ${csType} ${csName} { get; set; }${csDefault(className, key, csType)}`);
  }
  lines.push('    }');
  return lines.join('\n');
}

// 与 daemon WS 广播一致：在 MonitorEvent 之上加 id（运行时由 server 注入），并把 timestamp 收紧为必需整数。
const MonitorEventBroadcastSchema = z.object({
  id: z.string(),
  ...protocol.MonitorEventSchema.shape,
  timestamp: z.number().int(),
});

const targets = [
  { name: 'SessionInfo', schema: protocol.SessionInfoSchema },
  { name: 'MonitorSourceInfo', schema: protocol.MonitorSourceSchema },
  { name: 'MonitorEventInfo', schema: MonitorEventBroadcastSchema },
];

const body = targets
  .map(({ name, schema }) => emitClass(name, schema))
  .join('\n\n');

// 模板字面量在 Windows checkout 上携带 CRLF，body 用 LF 拼接。
// 显式归一到 LF 后写盘，避免每次 gen 在 Windows 工作树产生混排 churn。
// .gitattributes 同步配 *.g.cs eol=lf，让 checkout 也保持 LF。
const rawContent =
`// <auto-generated />
// 由 scripts/generate-csharp-dtos.mjs 生成。
// 真相来源：packages/daemon/src/shared/protocol.ts
// 不要手动编辑；运行 \`npm run gen:dtos\` 重新生成；CI 中 \`npm run validate:dtos\` 会拒绝漂移。
#nullable enable
using System;

namespace CodePanion.Gui.Models
{
${body}
}
`;
const content = rawContent.replace(/\r\n/g, '\n');

const checkMode = process.argv.includes('--check');
if (checkMode) {
  if (!existsSync(outPath)) {
    console.error(`缺少生成文件 ${outPath}，运行 npm run gen:dtos 后提交。`);
    process.exit(1);
  }
  const existing = readFileSync(outPath, 'utf8').replace(/\r\n/g, '\n');
  if (existing !== content) {
    console.error('生成的 C# DTO 与 protocol.ts 漂移，运行 npm run gen:dtos 后重新提交。');
    process.exit(1);
  }
  console.log('C# DTO 与 protocol.ts 一致');
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, content, 'utf8');
  console.log(`已写入 ${outPath}`);
}
