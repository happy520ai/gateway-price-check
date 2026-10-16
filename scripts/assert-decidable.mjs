#!/usr/bin/env node
// CI gate: did the live probe still produce a usable cross-comparison?
//
// Lives in a file rather than inline `node -e '...'` because this workflow runs on both
// ubuntu and windows, and `run:` defaults to bash on one and PowerShell on the other -
// a multi-line single-quoted script is parsed differently by the two, which showed up as
// a step that exited 1 while printing nothing at all.
//
//   node scripts/assert-decidable.mjs probe.json
//
// Exit 0 = usable. Exit 1 = not usable, with the reason on stderr.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DECIDABLE = new Set(['YES', 'NO', 'AUTH']);
const SUBJECT = 'OpenCSG';
const MIN_ROWS = 11;
const MAX_UNDECIDABLE = 3;

const file = process.argv[2];
if (!file) {
  console.error('用法：node scripts/assert-decidable.mjs <probe.json>');
  process.exit(2);
}

let doc;
// 命令行给的路径按 cwd 解析（调用方是 workflow 的工作目录），不按本文件位置。
try {
  doc = JSON.parse(readFileSync(resolve(file), 'utf8'));
} catch (e) {
  console.error('REFUSED: 读不到/解析不了 ' + file + '（' + e.message + '）—— 探针没产出，不算通过');
  process.exit(1);
}

const rows = doc.results || [];
const bad = rows.filter(r => !DECIDABLE.has(r.level));
const subject = rows.find(r => r.name === SUBJECT);

if (rows.length < MIN_ROWS) {
  console.error(`REFUSED: 只探到 ${rows.length} 家，少于 ${MIN_ROWS} —— providers.json 少了一半？`);
  process.exit(1);
}
if (!subject || !DECIDABLE.has(subject.level)) {
  console.error(`REFUSED: 被测主体 ${SUBJECT} 不可判（${subject ? subject.level : '缺席'}）`);
  process.exit(1);
}
if (bad.length > MAX_UNDECIDABLE) {
  console.error(`REFUSED: ${bad.length}/${rows.length} 家不可判，超出容忍 ${MAX_UNDECIDABLE} —— 多数端点读不到就不是横评了`);
  console.error('  ' + bad.map(r => r.name + ' → ' + String(r.verdict || r.text || '').slice(0, 40)).join('\n  '));
  process.exit(1);
}

if (bad.length) {
  console.log(`容忍内不可判 ${bad.length} 家（不计入任何一档）：` +
    bad.map(r => ' ' + r.name + ' → ' + String(r.verdict || r.text || '').slice(0, 40)).join(' ;'));
}
console.log(`decidable ${rows.length - bad.length}/${rows.length} · 主体 ${SUBJECT} ${subject.level}`);
