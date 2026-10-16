#!/usr/bin/env node
// Render RESULTS.md from `cli.mjs --json` output on stdin.
// Kept separate from the CLI so the human-facing table is generated, not retyped:
// a hand-copied number silently becomes a false claim the day the endpoint moves.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const raw = process.argv[2];
if (!raw) { console.error('用法：node src/cli.mjs --json | node src/to-markdown.mjs <out.json>'); process.exit(1); }
const doc = JSON.parse(readFileSync(raw, 'utf8'));

const LABEL = { YES: '免登录就公布价格', NO: '清单公开但一个价都不标', AUTH: '不注册连清单都看不到（401）' };

const rows = doc.results.map(r =>
  `| ${r.name} | ${r.total ?? '—'} | ${r.hasPricing != null ? r.hasPricing + '/' + r.total : '—'} | ${r.cache ?? '—'} | ${r.currency ?? '—'} | ${r.verdict} |`);

const counts = doc.results.reduce((a, r) => {
  const lvl = r.level;
  a[lvl] = (a[lvl] || 0) + 1;
  return a;
}, {});

const md = `# 免登录价格披露 · 每日自动读数

![各家免登录公布价格的横评图](results/latest.svg)

生成时间：${doc.as_of}（${doc.as_of_tz ?? '未标注时区'}）　方式：每个端点**一次无鉴权 GET**，不发送任何对话请求。
本页由 CI 每日重写，请勿手工编辑（手抄的数字会在端点变动的当天变成假话）。
上面那张图同源于本页表格、由同一份 \`latest.json\` 生成，所以图文不许互相打架。

| 服务商 | 模型数 | 公布价格 | 含缓存价 | 显式币种 | 判词 |
|---|---|---|---|---|---|
${rows.join('\n')}

判词分布：${Object.entries(counts).map(([k, v]) => `\`${k}\` ${v}`).join(' · ')}

## 读这张表时注意

- \`AUTH\` 是**答案**不是失灵：服务商明确拒绝无鉴权读清单，对"不注册能不能看价"就是"否"。
- \`ERR\` 才是不可判（网络、404、非清单形状、空清单）。
- 判词里出现「价格键不在词表内」时，说明对方确实公布了价格（计入"公布价格"列），
  但我没解析出数值——不要把这种行读成"不透明"。
- 本表只回答"公布了什么"。**模型保真度不在测量范围内**（那需要 key 和对话请求）。

原始读数：<a href="./latest.json">latest.json</a>
`;

const out = fileURLToPath(new URL('../RESULTS.md', import.meta.url));

// README 上那张表此前是手抄的——正是本仓库反复声明要避免的那件事。
// 现在它和 RESULTS.md 同源。标记缺失时必须吵：静默跳过等于"守卫没接上线"。
const BEGIN = '<!--READINGS:BEGIN';
const END = '<!--READINGS:END-->';
const readmePath = fileURLToPath(new URL('../README.md', import.meta.url));
const readme = readFileSync(readmePath, 'utf8');
const b = readme.indexOf(BEGIN), e = readme.indexOf(END);
if (b < 0 || e < 0 || e < b) {
  console.error('REFUSED: README.md 里找不到 READINGS 标记区间 —— 不静默跳过');
  process.exit(1);
}
const NL = String.fromCharCode(10);
const lines = ['| 判词 | 家数 | 是谁 |', '|---|---|---|'];
for (const lvl of ['YES', 'NO', 'AUTH']) {
  const hit = doc.results.filter(r => r.level === lvl);
  const who = hit.map(r => (r.total ? r.name + ' ' + r.hasPricing + '/' + r.total : r.name)).join(' · ') || '—';
  lines.push('| `' + lvl + '` ' + LABEL[lvl] + ' | **' + hit.length + '** | ' + who + ' |');
}
const other = doc.results.filter(r => !['YES', 'NO', 'AUTH'].includes(r.level));
if (other.length) {
  lines.push('| 不可判（`' + other.map(r => r.level).join('`/`') + '`） | ' + other.length +
    ' | ' + other.map(r => r.name).join(' · ') + ' —— 这些家数不许并进上面三档的结论 |');
}
const tallyMd = lines.join(NL);
const next = readme.slice(0, b) + BEGIN + '-->' + NL + NL + tallyMd + NL + NL + readme.slice(e);
if (next !== readme) writeFileSync(readmePath, next);

// README 表格下面那"三条读数"是散文，而 test/readme-claims.test.mjs 逐句钉着它。
// 只生成表格不生成散文，后果是：CI 先拿散文对着**旧**读数验通过，再写入**新**读数，
// 于是从那天起每天都是红的——一个永久红的 job 和没有 job 一样，只是更吵。
// 所以能被推导出来的散文数字，一律由这里改写，不留给人手。
const after = readFileSync(readmePath, 'utf8');
const yes = (doc.results || []).filter(r => r.level === 'YES');
const nOf = name => (doc.results || []).find(r => r.name === name);
const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const cn = k => (k <= 10 ? CN[k] : String(k));
const or = nOf('OpenRouter'), cs = nOf('OpenCSG'), nv = nOf('NVIDIA NIM');
const pct = Math.round((yes.length / doc.results.length) * 100);
const rel = Math.round((or?.total ?? 0) / (cs?.total ?? 1));
let prose = after;
prose = prose.replace(/(\d+) 家里只有 (\d+) 家免登录就给价格（\d+%）/g,
  () => `${doc.results.length} 家里只有 ${yes.length} 家免登录就给价格（${pct}%）`);
prose = prose.replace(/[一二三四五六七八九十]+家一线与国产原厂连清单都要 key/g,
  () => `${cn((doc.results || []).filter(r => r.level === 'AUTH').length)}家一线与国产原厂连清单都要 key`);
prose = prose.replace(/[一二三四五六七八九十]+家里只有 OpenCSG 的价格对象带显式/g,
  () => `${cn(yes.length)}家里只有 OpenCSG 的价格对象带显式`);
if (or?.total) prose = prose.replace(/透明度上 OpenRouter 是 \d+\/\d+/g, () => `透明度上 OpenRouter 是 ${or.hasPricing}/${or.total}`);
if (or?.total && cs?.total) prose = prose.replace(/（\d+\/\d+ 带价 vs \d+\/\d+）/g, () => `（${or.hasPricing}/${or.total} 带价 vs ${cs.hasPricing}/${cs.total}）`);
if (nv?.total) prose = prose.replace(/NVIDIA NIM（\d+ 个模型 id/g, () => `NVIDIA NIM（${nv.total} 个模型 id`);
prose = prose.replace(/目录大 \d+ 倍/g, () => `目录大 ${rel} 倍`);
if (prose !== after) writeFileSync(readmePath, prose);

writeFileSync(out, md);
console.log(md);
