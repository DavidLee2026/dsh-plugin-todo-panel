#!/usr/bin/env node
/**
 * 公开仓库自检：扫描 git 跟踪的文件，找个人信息与凭据。
 *
 * 跑法：npm run privacy-check
 *
 * 通用规则写在本文件里；个人向的关键词（真名、家人称呼、内部目录名、机器名）
 * 放在仓库根目录的 .privacy-patterns，一行一个，该文件已被 .gitignore 排除，
 * 永远不进仓库。有命中就退出码 1，方便挂到提交钩子上。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const LOCAL = path.join(ROOT, '.privacy-patterns');
/** 规则本身就含这些字面量，扫描时跳过自己。 */
const SKIP = new Set(['scripts/privacy-check.mjs']);

/** 通用规则：[名字, 正则, 命中的片段是否要再过一道放行]。 */
const RULES = [
  ['个人主目录绝对路径', /(?<![\w/.])(?:\/Users\/[^\s"'`)]*|\/home\/[a-z][^\s"'`)]*|[A-Za-z]:\\Users\\[^\s"'`)]*)/gm, null],
  ['桌面/文档/下载路径', /~\/(?:Desktop|Documents|Downloads)\b/gm, null],
  ['邮箱', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (text) => /@users\.noreply\.github\.com$/.test(text)],
  ['凭据串', /\b(?:sk-[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g, null],
  ['内网 IP', /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g, null],
  ['本地地址带端口', /\b(?:localhost|127\.0\.0\.1):\d+/g, null],
];

/** 读本地关键词；文件不存在就只用通用规则。 */
function read_terms() {
  if (!fs.existsSync(LOCAL)) return [];
  return fs
    .readFileSync(LOCAL, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/** 二进制文件按 NUL 字节判断，跳过去。 */
function is_binary(buffer) {
  return buffer.includes(0);
}

const terms = read_terms();
const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
const hits = [];

for (const name of files) {
  if (SKIP.has(name)) continue;
  const buffer = fs.readFileSync(path.join(ROOT, name));
  if (is_binary(buffer)) continue;
  const text = buffer.toString('utf8');
  const lines = text.split('\n');

  for (const [label, expression, allow] of RULES) {
    for (let index = 0; index < lines.length; index += 1) {
      expression.lastIndex = 0;
      const found = lines[index].match(expression);
      if (found === null) continue;
      for (const raw of found) {
        const snippet = raw.trim();
        if (allow !== null && allow(snippet)) continue;
        hits.push({ file: name, line: index + 1, label, snippet });
      }
    }
  }

  const lowered = text.toLowerCase();
  for (const term of terms) {
    if (!lowered.includes(term.toLowerCase())) continue;
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].toLowerCase().includes(term.toLowerCase())) continue;
      hits.push({ file: name, line: index + 1, label: '个人关键词', snippet: term });
    }
  }
}

if (hits.length === 0) {
  console.log(`通过：扫描 ${files.length} 个文件，未发现个人信息；本地关键词 ${terms.length} 条。`);
  if (terms.length === 0) console.log('提示：.privacy-patterns 不存在或为空，只跑了通用规则。');
  process.exit(0);
}

console.error(`发现 ${hits.length} 处可疑内容：`);
for (const hit of hits) console.error(`  ${hit.file}:${hit.line}  [${hit.label}] ${hit.snippet.slice(0, 90)}`);
process.exit(1);
