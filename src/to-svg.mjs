#!/usr/bin/env node
// Render the transparency comparison as an SVG bar chart.
//
// Why SVG and not a committed PNG: a bitmap of these numbers is a hand-copied
// number with extra steps - it keeps saying "7 家 401" the day one of them opens up,
// and grep can't see inside it. This file is rewritten by the same daily CI job that
// writes latest.json, so the picture cannot disagree with the table above it.
//
//   node src/cli.mjs --json > results/latest.json
//   node src/to-svg.mjs results/latest.json

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const raw = process.argv[2];
if (!raw) { console.error('用法：node src/to-svg.mjs <readings.json>'); process.exit(1); }
const doc = JSON.parse(readFileSync(raw, 'utf8'));
const rows = doc.results || [];
if (rows.length < 5) {
  // 少于 5 家就不成横评。宁可不出图，也不出一张"看起来是横评"的图。
  console.error(`REFUSED: 只有 ${rows.length} 行读数，不足以出横评图`);
  process.exit(1);
}

const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

const COLOR = { YES: '#4ee1a0', NO: '#ffb454', AUTH: '#788294' };
const LABEL = { YES: '免登录公布价格', NO: '清单公开 · 零价格', AUTH: '401 · 不注册看不到清单' };
const ORDER = { YES: 0, NO: 1, AUTH: 2 };

// Node 里没有字体度量，所以按码元估宽：CJK 约 1em，ASCII 约 0.55em。
// 估算本身不可信，所以配一条右边界断言——放不下就拒绝出图，而不是画成重叠。
const textW = (s, em) => [...s].reduce((w, ch) => w + (ch.codePointAt(0) > 0x2e80 ? em : em * 0.55), 0);

const sorted = [...rows].sort((a, b) => {
  const d = (ORDER[a.level] ?? 9) - (ORDER[b.level] ?? 9);
  return d !== 0 ? d : (b.total ?? 0) - (a.total ?? 0);
});

const W = 960, M = 40, ROW = 34, TOP = 78, BOT = 96;
const H = TOP + sorted.length * ROW + BOT;
const barX = M + 300, barW = W - M - barX - 96;

const count = lvl => sorted.filter(r => r.level === lvl).length;
const hidden = count('NO') + count('AUTH');

const parts = [];
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" font-family="system-ui,-apple-system,'Segoe UI','Microsoft YaHei',sans-serif">`);
parts.push(`<title>${esc(`${sorted.length} 家模型网关：注册之前谁能看到价格`)}</title>`);
parts.push(`<desc>${esc(`读数由 CI 每日生成于 ${doc.as_of}（${doc.as_of_tz ?? '未标注时区'}）。每家一次无鉴权 GET /v1/models。公布价格 ${count('YES')} 家，清单公开但零价格 ${count('NO')} 家，需 key 才能读清单 ${count('AUTH')} 家。`)}</desc>`);
parts.push(`<rect width="${W}" height="${H}" fill="#0b0d10"/>`);
parts.push(`<rect width="${W}" height="6" fill="${COLOR.YES}"/>`);
parts.push(`<text x="${M}" y="40" fill="#eceef3" font-size="24" font-weight="700">${esc(`${sorted.length} 家模型网关：注册之前，谁能看到价格？`)}</text>`);
parts.push(`<text x="${M}" y="63" fill="#96a0af" font-size="13">${esc(`每家一次无鉴权 GET /v1/models　·　CI 每日重跑，非手抄　·　${doc.as_of} ${doc.as_of_tz ?? ''}`)}</text>`);

sorted.forEach((r, i) => {
  const y = TOP + i * ROW;
  const col = COLOR[r.level] || '#96a0af';
  const mid = y + ROW / 2;
  if (textW(r.name, 16) > barX - M - 12) {
    console.error(`REFUSED: 服务商名「${r.name}」估宽 ${Math.round(textW(r.name, 16))}px > 名称列 ${barX - M - 12}px`);
    process.exit(1);
  }
  parts.push(`<text x="${M}" y="${mid + 5}" fill="#eceef3" font-size="16" font-weight="600">${esc(r.name)}</text>`);
  parts.push(`<rect x="${barX}" y="${y + 7}" width="${barW}" height="${ROW - 14}" rx="6" fill="#12161c" stroke="#242c36"/>`);
  const total = r.total, pub = r.hasPricing;
  let val;
  if (total) {
    const frac = Math.max(0, Math.min(1, (pub || 0) / total));
    if (frac > 0) {
      parts.push(`<rect x="${barX}" y="${y + 7}" width="${(barW * frac).toFixed(1)}" height="${ROW - 14}" rx="6" fill="${col}"/>`);
    }
    val = `${pub || 0}/${total}`;
  } else {
    val = '401';
  }
  parts.push(`<text x="${barX + barW + 12}" y="${mid + 5}" fill="${col}" font-size="15" font-weight="700">${esc(val)}</text>`);
});

let ly = TOP + sorted.length * ROW + 22;
parts.push(`<line x1="${M}" y1="${ly - 14}" x2="${W - M}" y2="${ly - 14}" stroke="#242c36" stroke-width="2"/>`);
let lx = M;
const legend = [];
for (const lvl of ['YES', 'NO', 'AUTH']) {
  const t = `● ${count(lvl)} 家 · ${LABEL[lvl]}`;
  legend.push({ x: lx, t, lvl });
  lx += 24 + textW(t, 13);
}
if (lx - 24 > W - M) {
  console.error(`REFUSED: 图例横排估宽 ${Math.round(lx - 24 - M)}px，可用 ${W - 2 * M}px —— 重叠比少一行图例更糟`);
  process.exit(1);
}
for (const { x, t, lvl } of legend) {
  parts.push(`<text x="${x}" y="${ly + 4}" fill="${COLOR[lvl]}" font-size="13">${esc(t)}</text>`);
}
parts.push(`<text x="${M}" y="${ly + 34}" fill="#ffb454" font-size="12.5">${esc(`这张图只回答「公布了什么」，不回答「给的是不是真权重」——不发送任何对话请求。`)}</text>`);
parts.push(`<text x="${M}" y="${ly + 54}" fill="#96a0af" font-size="12.5">${esc(`重放：node src/cli.mjs　·　原始读数：results/latest.json　·　${hidden} 家在注册之前不给你看价格`)}</text>`);
parts.push('</svg>');

const svg = parts.join('\n') + '\n';
// 输出路径可参数化：否则负向测试喂一个临时输入就会覆盖真工件（已经发生过一次，
// 屏幕上留下的是夹具的 11 家全 YES，不是世界的 3/1/7）。
// 显式给定时按 cwd 解析，和入参 <readings.json> 的解析方式保持一致。
const out = process.argv[3] ? resolve(process.argv[3])
  : fileURLToPath(new URL('../results/latest.svg', import.meta.url));
writeFileSync(out, svg);
console.log(`wrote ${out} (${sorted.length} providers, ${W}x${H})`);
