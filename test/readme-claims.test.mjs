import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const doc = JSON.parse(readFileSync(root + 'results/latest.json', 'utf8'));
const readme = readFileSync(root + 'README.md', 'utf8');
const row = name => doc.results.find(r => r.name === name);
const count = lvl => doc.results.filter(r => r.level === lvl).length;

const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

// README 的表格已经是机器区了，但表格下面那"三条读数"是散文，数字照样会腐烂。
// 散文比表格更容易被忽略，所以这里逐条钉住。
test('「N 家里只有 M 家免登录就给价格（P%）」与读数一致', () => {
  const m = readme.match(/(\d+) 家里只有 (\d+) 家免登录就给价格（(\d+)%）/);
  assert.ok(m, 'README 里找不到这句 —— 改了写法就要同步改这条判据，不许让它空转');
  assert.equal(Number(m[1]), doc.results.length, '总家数');
  assert.equal(Number(m[2]), count('YES'), '公布价格的家数');
  assert.equal(Number(m[3]), Math.round((count('YES') / doc.results.length) * 100), '百分比');
});

test('「NVIDIA 把清单公开却一个价都不标」只在 NVIDIA 真的是 NO 档时成立', () => {
  const claims = /NVIDIA 把清单公开却一个价都不标/.test(readme);
  const nvidia = row('NVIDIA NIM');
  assert.ok(nvidia, '读数里没有 NVIDIA NIM，这句无来源');
  const truth = nvidia.level === 'NO' && nvidia.total > 0 && nvidia.hasPricing === 0;
  assert.equal(claims, truth, `README 断言=${claims}，读数=${nvidia.level} ${nvidia.hasPricing}/${nvidia.total}`);
});

test('「七家…连清单都要 key」的中文数词等于 AUTH 家数', () => {
  const m = readme.match(/([一二三四五六七八九十]+)家一线与国产原厂连清单都要 key/);
  assert.ok(m, 'README 里找不到这句');
  assert.equal(CN[m[1]], count('AUTH'), `写了「${m[1]}家」，AUTH 实际 ${count('AUTH')} 家`);
});

test('「三家里只有 OpenCSG 带显式 currency」要求 YES 档里恰好一家有币种字段', () => {
  const m = readme.match(/([一二三四五六七八九十]+)家里只有 OpenCSG 的价格对象带显式 `currency`/);
  assert.ok(m, 'README 里找不到这句');
  assert.equal(CN[m[1]], count('YES'), '分母不是 YES 家数');
  const withCur = doc.results.filter(r => r.level === 'YES' && (r.currency || 0) > 0);
  assert.equal(withCur.length, 1, `YES 档里有币种字段的不是 1 家而是 ${withCur.length} 家：${withCur.map(r => r.name)}`);
  assert.equal(withCur[0].name, 'OpenCSG');
});

test('「OpenRouter 是 x/y」与读数一致，且这句话不许把透明度说成 OpenCSG 更强', () => {
  const m = readme.match(/透明度上 OpenRouter 是 (\d+)\/(\d+)，比它更高/);
  assert.ok(m, 'README 里找不到这句');
  const or = row('OpenRouter');
  assert.equal(Number(m[1]), or.hasPricing);
  assert.equal(Number(m[2]), or.total);
  const cs = row('OpenCSG');
  assert.ok(or.hasPricing / or.total >= cs.hasPricing / cs.total, '这句比较方向已不成立');
});

test('机器区之外不许残留手抄的 x/y 读数（除已被上面各条钉住的）', () => {
  const outside = readme.replace(/<!--READINGS:BEGIN[\s\S]*?<!--READINGS:END-->/g, '');
  const names = doc.results.map(r => r.name);
  let checked = 0;
  for (const m of outside.matchAll(/(\d+)\/(\d+)/g)) {
    // 只认「贴着服务商名的 x/y」是价格读数。401/403 这类 HTTP 状态码不是比率，
    // 把它们当假读数会逼我去放宽判据——那才是真正会漏判的地方。
    // 距离要对着**最近一次**出现量，不是第一次出现：否则同名第二次出现的真读数会被判"不贴名"而漏掉。
    const near = names.some(n => {
      let i = outside.indexOf(n);
      while (i >= 0) {
        if (Math.abs(i - m.index) < 60) return true;
        i = outside.indexOf(n, i + n.length);
      }
      return false;
    });
    if (!near) continue;
    checked++;
    const a = Number(m[1]), b = Number(m[2]);
    assert.ok(doc.results.some(r => r.hasPricing === a && r.total === b),
      `贴着服务商名的「${m[0]}」在读数里不存在`);
  }
  // 这条只是"扫描器还接着线"的下限。逐句精确判据在上面 5 条里，
  // 它们各自 assert 找不到句子就红——所以这里不许写成 >= 3，
  // 那会让"删掉一句散文"变成假红。
  assert.ok(checked >= 1, '一条贴名的 x/y 都没扫到 —— 判据可能已经空转');
});
