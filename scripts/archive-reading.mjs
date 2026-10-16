#!/usr/bin/env node
// Archive a reading under its own date so the number stays citable after tomorrow.
//
// Without this, results/latest.json is the only artifact and it is overwritten daily:
// a page that says "as of 2026-10-17, 3/1/7" links to something that will read
// "as of 2026-10-18" by the time anyone clicks. The dated claim and the undated
// artifact then contradict each other, and the contradiction is invisible to whoever
// wrote the sentence.
//
//   node scripts/archive-reading.mjs results/latest.json
//
// One file per Asia/Shanghai calendar day. A later run on the same day replaces the
// earlier one only if it is actually newer, and says so out loud.

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const src = process.argv[2];
if (!src) {
  console.error('用法：node scripts/archive-reading.mjs <readings.json>');
  process.exit(2);
}
const file = resolve(src);
if (!existsSync(file)) { console.error('REFUSED: ' + file + ' 不存在'); process.exit(1); }

const doc = JSON.parse(readFileSync(file, 'utf8'));
const rows = doc.results || [];
if (rows.length < 5) {
  console.error(`REFUSED: 只有 ${rows.length} 行，不归档一份不构成横评的读数`);
  process.exit(1);
}
if (!doc.as_of) { console.error('REFUSED: 读数没有 as_of，无法决定归档到哪个日期'); process.exit(1); }
const stamp = doc.as_of_utc || doc.as_of;

const dir = resolve('results/history');
mkdirSync(dir, { recursive: true });
// 一天一个文件，名字只由日期决定。带上输入文件名会让每次运行各开一份，
// 下面那条「不许往回覆盖」就永远碰不到自己的前一份——我第一版就是这样，测试才暴露出来。
const out = resolve(dir, doc.as_of + '.json');

if (existsSync(out)) {
  const prev = JSON.parse(readFileSync(out, 'utf8'));
  const prevStamp = prev.as_of_utc || prev.as_of;
  if (String(prevStamp) === String(stamp)) {
    console.log('unchanged: ' + out);
    process.exit(0);
  }
  // 同一天两次运行给出不同读数，本身就是"清单在动"的证据，别把它抹平。
  if (String(stamp) < String(prevStamp)) {
    console.error('REFUSED: 想把 ' + stamp + ' 写进一个记着更新的 ' + prevStamp + ' 的归档 —— 不往回覆盖');
    process.exit(1);
  }
  const moved = rows.filter(r => (prev.results.find(p => p.name === r.name) || {}).level !== r.level).length;
  console.log(`replace same-day archive ${out}: ${prevStamp} -> ${stamp}` +
    (moved ? `（${moved} 家判词在这天内变过）` : ''));
} else {
  console.log('archived: ' + out);
}
writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
