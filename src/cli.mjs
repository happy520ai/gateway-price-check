#!/usr/bin/env node
// gateway-price-check — does an OpenAI-compatible endpoint disclose prices
// WITHOUT an account or key? One unauthenticated GET per provider, sequential,
// no retries. Read-only; it never sends a completion request.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { measurePayload, verdict } from './probe.mjs';

const TIMEOUT_MS = 25_000;

function parseArgs(argv) {
  const targets = [];
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a === '--url') {
      const url = argv[++i];
      if (!url) { console.error('--url 后面缺值'); process.exit(1); }
      let host;
      try { host = new URL(url).hostname; } catch { console.error('--url 不是合法 URL：' + url); process.exit(1); }
      targets.push({ name: host, url });
    } else if (a === '--name') {
      if (!targets.length) { console.error('--name 必须跟在 --url 之后'); process.exit(1); }
      targets[targets.length - 1].name = argv[++i];
    } else if (a === '--help' || a === '-h') {
      console.log(`用法：
  node src/cli.mjs [--url <endpoint> [--name <label>]]... [--json]
  不给 --url 时读取 src/providers.json。

退出码：0 全部可判 · 1 有传输/形状错误 · 2 有"字段名不在词表内"的不可判项`);
      process.exit(0);
    } else { console.error('无法识别的参数：' + a); process.exit(1); }
  }
  return { targets, json };
}

async function probe(t) {
  const started = Date.now();
  // 用可清除的定时器而不是 AbortSignal.timeout()：后者留下的 handle 会让
  // 进程退出时撞上 libuv 断言（Windows 实测 exit 127）。
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(t.url, { method: 'GET', signal: ctrl.signal });
    if (!res.ok) return { ...t, ms: Date.now() - started, measure: { error: 'HTTP ' + res.status } };
    const body = await res.json();
    return { ...t, ms: Date.now() - started, measure: measurePayload(body) };
  } catch (e) {
    return { ...t, ms: Date.now() - started, measure: { error: String(e?.message || e) } };
  } finally {
    clearTimeout(timer);
  }
}

const { targets: cli, json } = parseArgs(process.argv.slice(2));
const targets = cli.length ? cli : JSON.parse(readFileSync(fileURLToPath(new URL('./providers.json', import.meta.url)), 'utf8'));

if (!targets.length) { console.error('没有可测端点'); process.exit(1); }

const results = [];
for (const t of targets) {
  process.stderr.write('探测 ' + t.name + ' … ');
  const r = await probe(t);
  const v = verdict(r.measure);
  process.stderr.write(v.level + ' (' + r.ms + 'ms)\n');
  results.push({ ...r, verdict: v });
}

if (json) {
  console.log(JSON.stringify({
    as_of: new Date().toISOString().slice(0, 10),
    note: '全部为无鉴权 GET；本工具不发送任何对话请求，因此不评估模型保真度。',
    results: results.map(r => ({ name: r.name, url: r.url, ms: r.ms, level: r.verdict.level, verdict: r.verdict.text, ...(!r.measure.error ? r.measure : {}) })),
  }, null, 2));
} else {
  console.log('| 服务商 | 模型数 | 公布价格 | 含缓存价 | 显式币种 | 上游标识 | 判词 |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of results) {
    const m = r.measure;
    const c = k => (m.error ? '—' : m[k]);
    console.log(`| ${r.name} | ${c('total')} | ${m.error ? '—' : m.hasPricing + '/' + m.total} | ${c('cache')} | ${c('currency')} | ${c('upstream')} | ${r.verdict.text} |`);
  }
  console.log('\n判词只回答"免登录时公布了什么"，不回答"给的是不是真权重"。');
}

// 用 exitCode 而不是 process.exit()：让事件循环自然排空，避免强退时踩到未清的 handle。
if (results.some(r => r.verdict.level === 'ERR')) process.exitCode = 1;
else if (results.some(r => r.verdict.level === 'UNKNOWN')) process.exitCode = 2;
