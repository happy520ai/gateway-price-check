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

test('图例三档家数=按 level 聚合；不可判单独成档，不并进三档', () => {
  const count = lvl => doc.results.filter(r => r.level === lvl).length;
  const total = doc.results.length;
  const others = doc.results.filter(r => !['YES', 'NO', 'AUTH'].includes(r.level));
  // 三档之和 + 不可判数 = 总家数。不可判不得并进三档：并进去就等于替这些家
  // 断言了"公布了/不公布"，而 ERR/UNKNOWN 的意思恰恰是判不出来。
  assert.equal(count('YES') + count('NO') + count('AUTH') + others.length, total,
    '三档 + 不可判 之和必须等于总家数');
  for (const [lvl, label] of [['YES', '免登录公布价格'],
    ['NO', '清单公开 · 零价格'],
    ['AUTH', '401 · 不注册看不到清单']]) {
    assert.ok(svg.includes(`● ${count(lvl)} 家 · ${xml(label)}`), `图例缺 ${lvl} 或家数不对`);
  }
  if (others.length > 0) {
    const kinds = [...new Set(others.map(r => r.level))].join('/');
    assert.ok(svg.includes(`● ${others.length} 家 · 不可判（${xml(kinds)}）`),
      '有不可判家时图例必须单列一档');
  } else {
    assert.ok(!svg.includes('不可判'), '没有不可判家时图例不该出现这一档');
  }
});

test('文本元素总数 = 2+2N+图例档数+2（漏一家就会红）', () => {
  const legendTiers = 3 + (doc.results.some(r => !['YES', 'NO', 'AUTH'].includes(r.level)) ? 1 : 0);
  assert.equal((svg.match(/<text/g) || []).length, 2 + doc.results.length * 2 + legendTiers + 2);
});

test('假靶：有一家不可判时，图例单列第四档，三档不被污染', () => {
  // 这条走的是真实分支：11-15 的 CI 上 OpenAI 探测 fetch failed，图上多出一行灰条
  // 而图例只有三档，两边说法打架。夹具把一家 YES 改成 ERR，验证第四档真的会出。
  const bad = root + 'results/_err.json', out = root + 'results/_err.svg';
  try {
    const fixture = { ...doc, results: doc.results.map((r, i) => i === 0 ? { ...r, level: 'ERR', verdict: '不可判：fetch failed' } : r) };
    writeFileSync(bad, JSON.stringify(fixture));
    execFileSync('node', ['src/to-svg.mjs', 'results/_err.json', 'results/_err.svg'], { cwd: root, stdio: 'pipe' });
    const outSvg = readFileSync(out, 'utf8');
    // 家数按夹具实算，不写死：真实读数里本来就可能已有不可判家（11-17 就是），
    // 写死 '1 家' 只是把这一天的数据焊进断言。
    const others = fixture.results.filter(r => !['YES', 'NO', 'AUTH'].includes(r.level));
    assert.ok(others.length >= 1, '夹具必须造出至少一家不可判');
    const kinds = [...new Set(others.map(r => r.level))].join('/');
    assert.ok(outSvg.includes(`● ${others.length} 家 · 不可判（${kinds}）`), '不可判家必须单列第四档');
    // 三档家数各归各家：被改成 ERR 的那家不再算进 YES
    const yes = fixture.results.filter(r => r.level === 'YES').length;
    assert.ok(outSvg.includes(`● ${yes} 家 · 免登录公布价格`), 'YES 档家数必须减掉被改走的那家');
  } finally {
    rmSync(bad, { force: true });
    rmSync(out, { force: true });
  }
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
