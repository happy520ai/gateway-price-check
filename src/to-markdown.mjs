#!/usr/bin/env node
// Render RESULTS.md from `cli.mjs --json` output on stdin.
// Kept separate from the CLI so the human-facing table is generated, not retyped:
// a hand-copied number silently becomes a false claim the day the endpoint moves.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const raw = process.argv[2];
if (!raw) { console.error('用法：node src/cli.mjs --json | node src/to-markdown.mjs <out.json>'); process.exit(1); }
const doc = JSON.parse(readFileSync(raw, 'utf8'));

const rows = doc.results.map(r =>
  `| ${r.name} | ${r.total ?? '—'} | ${r.hasPricing != null ? r.hasPricing + '/' + r.total : '—'} | ${r.cache ?? '—'} | ${r.currency ?? '—'} | ${r.verdict} |`);

const counts = doc.results.reduce((a, r) => {
  const lvl = r.level;
  a[lvl] = (a[lvl] || 0) + 1;
  return a;
}, {});

const md = `# 免登录价格披露 · 每日自动读数

生成时间：${doc.as_of}（${doc.as_of_tz ?? '未标注时区'}）　方式：每个端点**一次无鉴权 GET**，不发送任何对话请求。
本页由 CI 每日重写，请勿手工编辑（手抄的数字会在端点变动的当天变成假话）。

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
writeFileSync(out, md);
console.log(md);
