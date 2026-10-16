// MCP 服务端测试：真跑 stdio 握手（spawn + 换行分帧 JSON-RPC），不是读代码断定。
// 三条纪律：每条请求都有超时（否则服务端不回包时测试会挂住）；每个子进程都登记并在 after() 里杀；
// 每个"必拒绝/必失败"臂都配一枚正对照，证明判据自己看得见目标。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const SERVER = fileURLToPath(new URL('../src/mcp-server.mjs', import.meta.url));
const children = [];
after(() => { for (const p of children) { try { p.stdin.end(); p.kill('SIGKILL'); } catch {} } });

const REQ_TIMEOUT = Number(process.env.GPC_TEST_TIMEOUT || 20000);

function client() {
  const p = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
  children.push(p);
  const rl = createInterface({ input: p.stdout, terminal: false });
  const waiters = new Map();
  const stray = [];
  const stderr = [];
  rl.on('line', (l) => {
    let m; try { m = JSON.parse(l); } catch { stray.push({ unparsed: l }); return; }
    const w = waiters.get(m.id);
    if (w) { waiters.delete(m.id); w(m); } else stray.push(m);
  });
  p.stderr.on('data', (d) => stderr.push(String(d)));
  let seq = 0;
  const send = (obj, ms = REQ_TIMEOUT) => new Promise((res, rej) => {
    const id = ++seq;
    obj.id = id; obj.jsonrpc = '2.0';
    const timer = setTimeout(() => {
      waiters.delete(id);
      rej(new Error('请求超时 ' + ms + 'ms：method=' + obj.method + '（子进程还在，测试不挂住，直接判失败）'));
    }, ms);
    waiters.set(id, (m) => { clearTimeout(timer); res(m); });
    p.stdin.write(JSON.stringify(obj) + '\n');
  });
  const notify = (method) => { p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'); };
  const settle = () => new Promise(r => setTimeout(r, 400));
  return { p, send, notify, settle, stderr, stray };
}

test('initialize 回协议版本与 tools 能力，且如实声明不评估保真度', async () => {
  const c = client();
  const m = await c.send({ method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  assert.equal(m.result.protocolVersion, '2025-03-26');
  assert.ok(m.result.capabilities.tools, '必须有 tools 能力');
  assert.equal(m.result.serverInfo.name, 'gateway-price-check');
  assert.match(m.result.instructions, /fidelity/);
  assert.match(m.result.instructions, /ERR or UNKNOWN/);
});

test('未认识的协议版本不许照抄，必须退回已知版本', async () => {
  const c = client();
  const m = await c.send({ method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  assert.equal(m.result.protocolVersion, '2025-03-26');
});

test('tools/list 就是那两把工具，名字逐字', async () => {
  const c = client();
  const m = await c.send({ method: 'tools/list', params: {} });
  assert.deepEqual(m.result.tools.map(t => t.name), ['check_price_disclosure', 'latest_archive_readings']);
  assert.match(m.result.tools[0].description, /YES, NO, AUTH, ERR, UNKNOWN/);
});

test('必拒绝臂：明文 http 与内网地址一律拒绝（无鉴权探测不能变成内网请求）', async () => {
  const c = client();
  for (const bad of ['http://openrouter.ai/api/v1/models', 'https://localhost/v1/models',
    'https://127.0.0.1/v1/models', 'https://192.168.1.1/v1/models', 'https://10.0.0.5/v1/models',
    'https://169.254.169.254/v1/models', 'https://metadata.google.internal/v1/models']) {
    const m = await c.send({ method: 'tools/call', params: { name: 'check_price_disclosure', arguments: { url: bad } } });
    assert.ok(m.error, bad + ' 应被拒绝，却得到 ' + JSON.stringify(m.result));
    assert.match(m.error.message, /https|内部主机|拒绝/, bad + ' 的拒绝理由要说清是哪条规则');
  }
  // 正对照：同一个工具吃到合规 https URL 时不该拒绝（否则上面的"全被拒"是探针瞎）
  const ok = await c.send({ method: 'tools/call', params: { name: 'check_price_disclosure', arguments: { url: 'https://integrate.api.nvidia.com/v1' } } }, 60000);
  assert.ok(!ok.error, '正对照被误拒：' + JSON.stringify(ok.error));
  assert.match(ok.result.structuredContent.reading.level, /^(YES|NO|AUTH|ERR|UNKNOWN)$/);
});

test('语法上合法但解析不到的主机要落 ERR（探针不可判），不许冒充 NO', async () => {
  const c = client();
  const m = await c.send({ method: 'tools/call', params: { name: 'check_price_disclosure', arguments: { url: 'https://no-such-host.invalid/v1' } } }, 60000);
  assert.ok(!m.error, '这不该是协议层拒绝：' + JSON.stringify(m.error));
  assert.equal(m.result.structuredContent.reading.level, 'ERR');
});

test('必拒绝臂：未知工具与未知方法各归其码，不许静默返回空', async () => {
  const c = client();
  assert.equal((await c.send({ method: 'tools/call', params: { name: 'do anything now', arguments: {} } })).error.code, -32602);
  assert.equal((await c.send({ method: 'prompts/list', params: {} })).error.code, -32601);
});

test('通知不许有回包；这条判据自带正对照', async () => {
  const c = client();
  await c.send({ method: 'initialize', params: { protocolVersion: '2025-03-26' } });
  c.p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 999001, method: 'ping' }) + '\n');
  await c.settle();
  assert.ok(c.stray.some(m => m.id === 999001), '正对照失效：stray 抓不到没人等的回包，下面的断言就是空断言');
  const before = c.stray.length;
  c.notify('notifications/initialized');
  c.notify('notifications/cancelled');
  const m = await c.send({ method: 'ping', params: {} });
  await c.settle();
  assert.ok(m.result, 'ping 应有回包');
  assert.equal(c.stray.length, before, '通知之后多出 ' + (c.stray.length - before) + ' 条没人等的回包 ⇒ 通知被回了');
});

test('归档读数工具吃真工件，摘要家数与逐条 level 对得上', async () => {
  const c = client();
  const m = await c.send({ method: 'tools/call', params: { name: 'latest_archive_readings', arguments: {} } });
  assert.equal(m.result.isError, false);
  const doc = m.result.structuredContent;
  assert.ok(Array.isArray(doc.results) && doc.results.length >= 10, '归档行数不足：' + (doc.results || []).length);
  const yes = doc.results.filter(r => r.level === 'YES').length;
  for (const r of doc.results) assert.match(r.level, /^(YES|NO|AUTH|ERR|UNKNOWN)$/, r.name + ' 判词非法：' + r.level);
  const text = m.result.content[0].text;
  if (yes > 0) assert.match(text, new RegExp('YES ' + yes + ' 家'), '摘要 YES 家数数不出来：' + text);
  else assert.ok(!/YES \d+ 家/.test(text), '零家时摘要不许出现 YES 计数');
});

test('必失败臂：归档里没有的那一天要如实报错，不许返回空数组冒充"零家"', async () => {
  const c = client();
  const m = await c.send({ method: 'tools/call', params: { name: 'latest_archive_readings', arguments: { date: '2020-01-01' } } });
  assert.equal(m.result.isError, true);
  assert.match(m.result.content[0].text, /归档里没有 2020-01-01/);
});

test('联网臂（CI 里跑）：OpenCSG 经 MCP 的判词必须吃满五档之一且带 total',
  { skip: process.env.GPC_LIVE_TESTS ? false : 'GPC_LIVE_TESTS 未设，只在真端点作业里跑' }, async () => {
  const c = client();
  const m = await c.send({ method: 'tools/call', params: { name: 'check_price_disclosure', arguments: { url: 'https://ai.space.opencsg.com/v1', name: 'OpenCSG' } } }, 60000);
  assert.equal(m.result.isError, false, m.result.content && m.result.content[0].text);
  const r = m.result.structuredContent.reading;
  assert.equal(r.name, 'OpenCSG');
  assert.match(r.level, /^(YES|NO|AUTH|ERR|UNKNOWN)$/);
  if (r.level === 'YES' || r.level === 'NO') assert.ok(r.total > 0, '可判却没有条目：' + JSON.stringify(r));
});
