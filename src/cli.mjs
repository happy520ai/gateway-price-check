#!/usr/bin/env node
// gateway-price-check — does an OpenAI-compatible endpoint disclose prices
// WITHOUT an account or key? One unauthenticated GET per provider, sequential,
// no retries. Read-only; it never sends a completion request.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { measurePayload, verdict, isRetryable, normalizeModelsUrl } from './probe.mjs';

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
      const resolved = normalizeModelsUrl(url);
      targets.push({ name: host, url: resolved, requestedUrl: url });
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

const RETRY_LIMIT = 2;

async function attempt(url) {
  const started = Date.now();
  // 用可清除的定时器而不是 AbortSignal.timeout()：后者留下的 handle 会让
  // 进程退出时撞上 libuv 断言（Windows 实测 exit 127）。
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
    // 判词引擎读的是 measure.error。把错误放到别的字段上，401 就会变成"没测到"。
    if (!res.ok) return { ms: Date.now() - started, measure: { error: 'HTTP ' + res.status }, retryable: false };
    const body = await res.json();
    return { ms: Date.now() - started, measure: measurePayload(body) };
  } catch (e) {
    const msg = String(e?.message || e);
    return { ms: Date.now() - started, measure: { error: msg }, retryable: isRetryable(msg) };
  } finally {
    clearTimeout(timer);
  }
}

async function probe(t) {
  let tries = 0, last;
  for (;;) {
    last = await attempt(t.url);
    // 只重试传输层抖动。401/404 是答案，不是失灵——重试它们会把"拒绝"洗成"读到了"。
    if (!last.retryable || tries >= RETRY_LIMIT) break;
    tries++;
    process.stderr.write('(' + t.name + ' 传输失败，第 ' + (tries + 1) + '/' + (RETRY_LIMIT + 1) + ' 次尝试) ');
    await new Promise(r => setTimeout(r, 400 * tries));
  }
  const { retryable, ...rest } = last;
  if (tries) rest.measure = { ...(rest.measure || {}), attempts: tries + 1 };
  return { ...t, ...rest };
}

const { targets: cli, json } = parseArgs(process.argv.slice(2));
const targets = cli.length ? cli : JSON.parse(readFileSync(fileURLToPath(new URL('./providers.json', import.meta.url)), 'utf8'));

if (!targets.length) { console.error('没有可测端点'); process.exit(1); }

const results = [];
for (const t of targets) {
  process.stderr.write('探测 ' + t.name + ' … ');
  if (t.requestedUrl && t.requestedUrl !== t.url) process.stderr.write('[按 OpenAI 兼容约定补全为 ' + t.url + '] ');
  const r = await probe(t);
  const v = verdict(r.measure);
  process.stderr.write(v.level + ' (' + r.ms + 'ms)\n');
  results.push({ ...r, verdict: v });
}

// 日期必须带时区：UTC 与北京时间会差一个日历日，只写"2026-10-16"会让读者以为
// 另一份写"2026-10-17"的产物是错的。
const now = new Date();
const offsetMin = -now.getTimezoneOffset();
const offsetLabel = 'UTC' + (offsetMin >= 0 ? '+' : '-') +
  String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, '0') + ':' +
  String(Math.abs(offsetMin) % 60).padStart(2, '0');
const localDate = new Date(now.getTime() + offsetMin * 60000).toISOString().slice(0, 10);

if (json) {
  console.log(JSON.stringify({
    as_of: localDate,
    as_of_tz: offsetLabel,
    as_of_utc: now.toISOString(),
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
