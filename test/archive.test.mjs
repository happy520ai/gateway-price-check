import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = root + 'results/history';
const latest = JSON.parse(readFileSync(root + 'results/latest.json', 'utf8'));
const files = readdirSync(dir);

// 归档存在的意义是"过期的说法还能被复核"。文件名与内容一旦对不上，
// 它就变成一个看起来可信、实际查不到出处的目录。
test('归档文件名都是 YYYY-MM-DD.json', () => {
  assert.ok(files.length >= 1, 'history/ 是空的 —— 归档步骤没跑或被删了');
  for (const f of files) {
    assert.match(f, /^\d{4}-\d{2}-\d{2}\.json$/, '文件名不合约定：' + f);
  }
});

test('每个归档的 as_of 与它的文件名一致（防回填错日期）', () => {
  for (const f of files) {
    const day = f.replace(/\.json$/, '');
    const doc = JSON.parse(readFileSync(dir + '/' + f, 'utf8'));
    assert.equal(doc.as_of, day, `${f} 的内容自称 ${doc.as_of} —— 名字和内容不一致的归档比没有更糟`);
    assert.ok(Array.isArray(doc.results) && doc.results.length >= 5, f + ' 行数不足以构成横评');
    assert.ok(doc.as_of_utc || doc.as_of, f + ' 没有任何时间戳');
  }
});

test('latest.json 那一天在归档里有对应文件（防归档步骤被悄悄去掉）', () => {
  assert.ok(files.includes(latest.as_of + '.json'),
    `latest.json 自称 ${latest.as_of}，但 history/ 里没有 ${latest.as_of}.json —— 归档没跑`);
});

test('归档与 latest 同日时读数相同（防只改其一）', () => {
  const same = files.includes(latest.as_of + '.json') ? latest.as_of : null;
  if (!same) return;
  const doc = JSON.parse(readFileSync(dir + '/' + same + '.json', 'utf8'));
  const key = d => (d.results || []).map(r => r.name + ':' + r.level + ':' + (r.total ?? '-')).sort().join('|');
  assert.equal(key(doc), key(latest), '同日归档与 latest.json 内容不同 —— 两者必有一个不是本次生成的');
});
