#!/usr/bin/env node
// Build a single-file, copy-runnable version of the probe from the repo sources.
//
// Why generate rather than paste: a gist holding a hand-copied script is a second
// carrier of the same logic, and the second carrier is the one that keeps saying
// something false after the first is fixed. This bundle is derived, and its header
// names the exact commit it came from, so a reader can diff it against the source.
//
//   node make-gist-bundle.mjs            # writes ../gist/gateway-price-check.mjs
//   node make-gist-bundle.mjs --check    # fail if the committed bundle is stale

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const CHECK = process.argv.includes('--check');
const OUT = here + 'gist/gateway-price-check.mjs';

const sha = execFileSync('git', ['-C', here, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['-C', here, 'status', '--porcelain', 'src/'], { encoding: 'utf8' }).trim();

const probe = readFileSync(here + 'src/probe.mjs', 'utf8');
const providers = readFileSync(here + 'src/providers.json', 'utf8');

// 把 ESM 源码拼成一个文件：去掉 import/export 关键字，其余逐字保留。
const inlined = probe
  .replace(/^import[^\n]*\n/gm, '')
  .replace(/^export\s+/gm, '')
  .trim();

const bundle = `#!/usr/bin/env node
// gateway-price-check — 免登录时，一个 OpenAI 兼容端点愿意把价格告诉你吗？
//
// 单文件版，由 gateway-price-check 仓库的 src/probe.mjs 机械拼接生成：
//   源仓库 https://github.com/happy520ai/gateway-price-check
//   生成自 commit ${sha}${dirty ? '（工作区有未提交改动）' : ''}
//   重新生成：node make-gist-bundle.mjs
// 逻辑与仓库版逐字相同（只去掉 import/export 关键字），所以这不是第二份实现，
// 是同一份实现的另一个载体——它过期了，仓库里那份也会过期，比对得出来。
//
// 用法：
//   node gateway-price-check.mjs                       # 跑内置 11 家
//   node gateway-price-check.mjs https://your-gw/v1    # 跑你自己的一家
//
// 只发一次无鉴权 GET，不发任何对话请求 ⇒ 只回答"公布了什么"，不回答"给的是不是真权重"。

${inlined}

const TIMEOUT_MS = 12000;
const RETRY_LIMIT = 2;
const TRANSPORT_ONLY = (msg) => isRetryable(msg);

const PRESET = ${providers.trim()};

async function attempt(url) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
    if (!res.ok) return { ms: Date.now() - started, measure: { error: 'HTTP ' + res.status }, retryable: false };
    return { ms: Date.now() - started, measure: measurePayload(await res.json()) };
  } catch (e) {
    const msg = String(e?.message || e);
    return { ms: Date.now() - started, measure: { error: msg }, retryable: TRANSPORT_ONLY(msg) };
  } finally {
    clearTimeout(timer);
  }
}

async function probeTarget(t) {
  let tries = 0, last;
  for (;;) {
    last = await attempt(t.url);
    if (!last.retryable || tries >= RETRY_LIMIT) break;
    tries++;
    await new Promise((r) => setTimeout(r, 400 * tries));
  }
  const m = last.measure;
  if (tries) m.attempts = tries + 1;
  const v = verdict(m);
  return { name: t.name, url: t.url, ms: last.ms, level: v.level, text: v.text, ...m };
}

const arg = process.argv[2];
const targets = arg
  ? [{ name: (() => { try { return new URL(normalizeModelsUrl(arg)).hostname; } catch { return arg; } })(), url: normalizeModelsUrl(arg) }]
  : PRESET.map((p) => ({ ...p, url: normalizeModelsUrl(p.url) }));

if (arg) console.log('（按 OpenAI 兼容约定补全为 ' + targets[0].url + '）');
console.log('| 服务商 | 模型数 | 公布价格 | 含缓存价 | 显式币种 | 上游标识 | 判词 |');
console.log('|---|---|---|---|---|---|---|');
for (const t of targets) {
  const r = await probeTarget(t);
  const cell = (x) => (x == null ? '—' : String(x));
  console.log('| ' + r.name + ' | ' + cell(r.total) + ' | ' +
    (r.hasPricing != null ? r.hasPricing + '/' + r.total : '—') + ' | ' + cell(r.cache) + ' | ' +
    cell(r.currency) + ' | ' + cell(r.upstream) + ' | ' + r.text + ' |');
}
console.log(String.fromCharCode(10) + '判词只回答"免登录时公布了什么"，不回答"给的是不是真权重"。');
`;

if (CHECK) {
  let prev = '';
  try { prev = readFileSync(OUT, 'utf8'); } catch { console.error('REFUSED: 没有已提交的 bundle'); process.exit(1); }
  if (!prev.includes('commit ' + sha) || prev.includes('工作区有未提交改动')) {
    console.error('STALE: bundle 不是从当前 HEAD(' + sha + ') 生成的，或生成时工作区不干净');
    process.exit(1);
  }
  console.log('bundle 与 HEAD ' + sha + ' 一致');
  process.exit(0);
}

mkdirSync(here + 'gist', { recursive: true });
writeFileSync(OUT, bundle);
console.log('wrote gist/gateway-price-check.mjs from commit ' + sha + (dirty ? ' (工作区有未提交改动)' : ''));
