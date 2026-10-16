import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const doc = JSON.parse(readFileSync(root + 'results/latest.json', 'utf8'));
const svg = readFileSync(root + 'results/latest.svg', 'utf8');
const xml = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// 这张图存在的唯一理由是它和 latest.json 同源。测试夹具曾经覆盖过真工件，
// 屏幕上留下的是"11 家全 YES"而不是世界的 3/1/7 —— 所以这条必须机械化，不能靠看。
test('latest.svg 能从 latest.json 逐字节重放出来', () => {
  const tmp = root + 'results/_roundtrip.svg';
  try {
    execFileSync('node', ['src/to-svg.mjs', 'results/latest.json', 'results/_roundtrip.svg'], { cwd: root });
    assert.equal(readFileSync(tmp, 'utf8'), svg, '重放与已提交的图不一致：图不是由这份读数生成的');
  } finally {
    rmSync(tmp, { force: true });
  }
});

test('每家在图里恰好出现一次，底槽数等于行数', () => {
  for (const r of doc.results) {
    const n = svg.split('>' + xml(r.name) + '</text>').length - 1;
    assert.equal(n, 1, `${r.name} 作为文本出现 ${n} 次，应为 1（0=漏画，>1=重名或夹具残留）`);
  }
  assert.equal((svg.match(/rx="6" fill="#12161c"/g) || []).length, doc.results.length, '底槽数应等于行数');
});

test('x/y 标注与读数一致，AUTH 家标 401', () => {
  for (const r of doc.results) {
    const want = r.total ? `${r.hasPricing}/${r.total}` : '401';
    assert.ok(svg.includes('>' + want + '</text>'), `图上找不到 ${r.name} 的「${want}」`);
  }
});

test('图例三档家数=按 level 聚合，且三档之和等于总家数', () => {
  const count = lvl => doc.results.filter(r => r.level === lvl).length;
  const total = doc.results.length;
  assert.equal(count('YES') + count('NO') + count('AUTH'), total,
    '有 ERR/UNKNOWN 时图例三档之和 < 总家数，这张图不该按"三档=全部"出');
  for (const [lvl, label] of [['YES', '免登录公布价格'],
    ['NO', '清单公开 · 零价格'],
    ['AUTH', '401 · 不注册看不到清单']]) {
    assert.ok(svg.includes(`● ${count(lvl)} 家 · ${xml(label)}`), `图例缺 ${lvl} 或家数不对`);
  }
});

test('文本元素总数 = 2+2N+3+2（漏一家就会红）', () => {
  assert.equal((svg.match(/<text/g) || []).length, 2 + doc.results.length * 2 + 3 + 2);
});

test('假靶：读数不足 5 行时拒绝出图，且不留旧文件', () => {
  const bad = root + 'results/_short.json', out = root + 'results/_short.svg';
  try {
    writeFileSync(bad, JSON.stringify({ ...doc, results: doc.results.slice(0, 3) }));
    assert.throws(() => execFileSync('node', ['src/to-svg.mjs', 'results/_short.json', 'results/_short.svg'],
      { cwd: root, stdio: 'pipe' }), /REFUSED/);
    assert.equal(existsSync(out), false, '拒绝出图时不许留下文件');
  } finally {
    rmSync(bad, { force: true });
    rmSync(out, { force: true });
  }
});

test('假靶：服务商名超出名称列时拒绝出图', () => {
  const bad = root + 'results/_wide.json', out = root + 'results/_wide.svg';
  try {
    const rows = JSON.parse(JSON.stringify(doc.results));
    rows[0].name = '很长的中文服务商名称'.repeat(6);
    writeFileSync(bad, JSON.stringify({ ...doc, results: rows }));
    assert.throws(() => execFileSync('node', ['src/to-svg.mjs', 'results/_wide.json', 'results/_wide.svg'],
      { cwd: root, stdio: 'pipe' }), /REFUSED/);
  } finally {
    rmSync(bad, { force: true });
    rmSync(out, { force: true });
  }
});
