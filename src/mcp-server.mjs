#!/usr/bin/env node
// 最小 MCP（stdio, JSON-RPC 2.0, 换行分帧）服务端。
// 它不重新实现测量：每个工具都是把 `src/cli.mjs` 当子进程跑一次，
// 所以 MCP 读数、CLI 读数、CI 归档读数出自同一条代码路径 —— 否则"两台仪器"是假的。
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import net from 'node:net';

const PKG = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
const CLI = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const PROTOCOL_FALLBACK = '2025-03-26';
const KNOWN_PROTOCOLS = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);

// 这个服务端会替你向任意 URL 发请求。宿主是一个语言模型，它可能被页面内容牵着走，
// 所以"能发什么请求"不能只靠模型自觉。默认拒绝：非 https、环回、私网、链路本地。
function assertSafeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('不是合法 URL：' + raw); }
  if (u.protocol !== 'https:') throw new Error('只允许 https://（明文 http 会把"无鉴权探测"变成"任意内网请求"）');
  if (process.env.GPC_ALLOW_INSECURE === '1') return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal|metadata\..*)$/i.test(host)) throw new Error('拒绝环回/内部主机 ' + host);
  if (net.isIP(host)) {
    if (net.isIPv4(host)) {
      const o = host.split('.').map(Number);
      if (o[0] === 127 || o[0] === 10 || o[0] === 0) throw new Error('拒绝私网/保留地址 ' + host);
      if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) throw new Error('拒绝私网地址 ' + host);
      if (o[0] === 192 && o[1] === 168) throw new Error('拒绝私网地址 ' + host);
      if (o[0] === 169 && o[1] === 254) throw new Error('拒绝链路本地地址 ' + host);
    }
    if (host.startsWith('::1') || host.toLowerCase().startsWith('fe80') || host.toLowerCase().startsWith('fd')) {
      throw new Error('拒绝 IPv6 环回/链路本地/唯一本地地址 ' + host);
    }
  }
  return u;
}

const TOOLS = [
  {
    name: 'check_price_disclosure',
    description: 'Sends exactly one unauthenticated GET to an OpenAI-compatible /v1/models endpoint and reports whether model prices are published before you sign up. Verdicts: YES, NO, AUTH, ERR, UNKNOWN — ERR/UNKNOWN are statements about the probe, not the vendor. Never sends a key, never sends a completion request, so it does not assess model fidelity.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'https base URL (…/v1) or full …/v1/models URL' },
        name: { type: 'string', description: 'Display label for the reading' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'latest_archive_readings',
    description: 'Returns the readings this repository\'s CI archived (today by default, or a given UTC+08 date YYYY-MM-DD) across all monitored gateways, as published — no re-probing.',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Archive day, e.g. 2026-10-17' } },
      additionalProperties: false,
    },
  },
];

function runCli(url, name) {
  const args = [CLI, '--url', url];
  if (name) args.push('--name', name);
  args.push('--json');
  const p = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 24, timeout: 180000 });
  if (p.error) throw new Error('子进程没跑起来：' + p.error.message);
  let doc = null;
  try { doc = JSON.parse(p.stdout); } catch { /* 下面按退出码解释 */ }
  if (!doc || !Array.isArray(doc.results)) {
    throw new Error('CLI 未产出 JSON（退出码 ' + p.status + '）：' + String(p.stderr || '').slice(0, 200));
  }
  if (![0, 1, 2].includes(p.status)) throw new Error('CLI 退出码 ' + p.status + ' 不在 0/1/2 内，不猜发生了什么');
  return doc;
}

function readArchive(date) {
  if (!date) {
    const f = fileURLToPath(new URL('../results/latest.json', import.meta.url));
    if (!existsSync(f)) throw new Error('results/latest.json 不在仓库里 —— 每日作业还没落过读数');
    return JSON.parse(readFileSync(f, 'utf8'));
  }
  const f = fileURLToPath(new URL('../results/history/' + date + '.json', import.meta.url));
  if (!existsSync(f)) throw new Error('归档里没有 ' + date + ' 这一天（可用日期见 results/history/）');
  return JSON.parse(readFileSync(f, 'utf8'));
}

const LEVELS = ['YES', 'NO', 'AUTH', 'ERR', 'UNKNOWN'];

function callTool(name, args) {
  if (name === 'check_price_disclosure') {
    const u = assertSafeUrl(String(args.url || ''));
    const doc = runCli(u.toString(), args.name ? String(args.name) : '');
    const rows = doc.results || [];
    if (rows.length !== 1) throw new Error('期望 1 行读数，得到 ' + rows.length);
    const r = rows[0];
    if (!LEVELS.includes(r.level)) throw new Error('判词 ' + JSON.stringify(r.level) + ' 不在闭集内，拒绝转述');
    return {
      content: [{ type: 'text', text: r.name + ' -> ' + r.level + '：' + r.verdict }],
      structuredContent: { as_of: doc.as_of, as_of_tz: doc.as_of_tz, note: doc.note, reading: r },
      isError: false,
    };
  }
  if (name === 'latest_archive_readings') {
    const doc = readArchive(args.date ? String(args.date) : '');
    const rows = doc.results || [];
    const tally = {};
    for (const r of rows) tally[r.level] = (tally[r.level] || 0) + 1;
    return {
      content: [{ type: 'text', text: doc.as_of + '（' + (doc.as_of_tz || '') + '）' + rows.length + ' 家：' +
        LEVELS.filter(l => tally[l]).map(l => l + ' ' + tally[l] + ' 家').join(' · ') }],
      structuredContent: doc,
      isError: false,
    };
  }
  const e = new Error('未知工具：' + name);
  e.code = -32602;
  throw e;
}

function respond(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
function fail(id, code, message) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n'); }

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return fail(null, -32700, 'parse error'); }
  const { id, method, params } = msg;
  if (id === undefined && String(method || '').startsWith('notifications/')) return; // 通知不许有回包
  try {
    if (method === 'initialize') {
      const asked = params && params.protocolVersion;
      return respond(id, {
        protocolVersion: KNOWN_PROTOCOLS.has(asked) ? asked : PROTOCOL_FALLBACK,
        capabilities: { tools: {} },
        serverInfo: { name: 'gateway-price-check', version: PKG.version },
        instructions: 'Two tools. Read-only: one unauthenticated GET per target, no keys, no completion requests. A verdict of ERR or UNKNOWN means the probe could not decide; do not restate it as "the vendor publishes no prices" (that verdict is NO). Model fidelity is out of scope and never asserted.',
      });
    }
    if (method === 'ping') return respond(id, {});
    if (method === 'tools/list') return respond(id, { tools: TOOLS });
    if (method === 'tools/call') {
      const name = params && params.name;
      if (!TOOLS.some(t => t.name === name)) return fail(id, -32602, '未知工具：' + name);
      return respond(id, callTool(name, (params && params.arguments) || {}));
    }
    return fail(id, -32601, '不支持的方法：' + method);
  } catch (e) {
    // 工具内部失败走 MCP 的 isError，不升级为协议错误 —— 让宿主能读到原因并改口；
    // 但被拒绝的 URL 属于调用方错误，仍是 JSON-RPC error。
    if (e.code === -32602) return fail(id, -32602, e.message);
    if (/只允许 https|拒绝|内部主机/.test(e.message)) return fail(id, -32600, e.message);
    return respond(id, { content: [{ type: 'text', text: '不可判：' + e.message }], isError: true });
  }
});
rl.on('close', () => process.exit(0));
