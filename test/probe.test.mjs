import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measurePayload, verdict, isRetryable } from '../src/probe.mjs';

// 两类形状，取自两个真实端点的响应结构（字段名原样保留）
const CSG = {
  object: 'list',
  data: [
    { id: 'deepseek-v4.1-flash', task: 'text-generation', metadata: { pricing: { input_token_price: { currency: '￥', price_per_million: 4, cached_price_per_million: 0.4 }, output_token_price: { currency: '￥', price_per_million: 12 } }, repo_path: 'deepseek-ai/DeepSeek-V4.1-Flash' } },
    { id: 'auto', task: 'text-generation', metadata: {} },
  ],
};
const OR = {
  object: 'list',
  data: [
    { id: 'x/y', pricing: { prompt: '0.00000025', completion: '0.000001', input_cache_read: '0.000000007' }, canonical_slug: 'x/y', hugging_face_id: 'x/y' },
  ],
};

test('CSG 形状：认出价格、币种、缓存价与上游标识', () => {
  const m = measurePayload(CSG);
  assert.equal(m.error, undefined);
  assert.equal(m.total, 2);
  assert.equal(m.anyPriced, 1);
  assert.equal(m.inputPriced, 1);
  assert.equal(m.cache, 1);
  assert.equal(m.currency, 1);
  assert.equal(m.upstream, 1);
  assert.equal(verdict(m).level, 'YES');
});

test('OpenRouter 形状：带价但无币种字段', () => {
  const m = measurePayload(OR);
  assert.equal(m.anyPriced, 1);
  assert.equal(m.currency, 0);
  assert.equal(m.cache, 1);
  assert.equal(m.upstream, 1);
});

// 必中靶 1：探针瞎了时必须报"不可判"，绝不能报"没有价格"。
// 这条是整个工具的存在理由——把"我没读到"说成"它没有"是最贵的错。
test('data 为空数组 => ERR，不是 NO', () => {
  const m = measurePayload({ object: 'list', data: [] });
  assert.ok(m.error, '空清单必须带 error');
  const v = verdict(m);
  assert.equal(v.level, 'ERR');
  assert.match(v.text, /不可判/);
  assert.doesNotMatch(v.text, /没有任何价格/);
});

// 必中靶 2：字段名不在词表内时，不许静默算成 0 带价。
test('未知价格字段名 => UNKNOWN，并列出没认出的键', () => {
  const weird = { object: 'list', data: [{ id: 'a', pricing: { in_unit: 1.2, out_unit: 3.4 } }] };
  const m = measurePayload(weird);
  assert.equal(m.anyPriced, 0);
  assert.equal(m.pricedButUnparsed, 1);
  assert.deepEqual(m.unrecognizedKeys.sort(), ['in_unit', 'out_unit']);
  assert.equal(verdict(m).level, 'UNKNOWN');
});

// 必中靶 3：401/403 是答案，不是探针失灵；而 404 仍然必须是"不可判"。
// 两条一起测，才排除"把所有错误都归成一档"这种偷懒实现。
test('HTTP 401 => AUTH（免登录看不到，即为否）', () => {
  const v = verdict({ error: 'HTTP 401' });
  assert.equal(v.level, 'AUTH');
  assert.doesNotMatch(v.text, /不可判/);
});

test('HTTP 403 => AUTH；HTTP 404 仍是 ERR（两者不许混）', () => {
  assert.equal(verdict({ error: 'HTTP 403' }).level, 'AUTH');
  assert.equal(verdict({ error: 'HTTP 404' }).level, 'ERR');
  assert.equal(verdict({ error: 'fetch failed' }).level, 'ERR');
});

// 真机回归靶：2026-10-17 实测 Vercel AI Gateway 用 input/output 当价格键，
// 旧词表把 471 条全带价的清单判成"0 带价 + UNKNOWN"。这条用例锁住扩表结果。
test('Vercel 形状（input/output 键）=> 认出带价，不落 UNKNOWN', () => {
  const v = {
    object: 'list',
    data: [
      { id: 'anthropic/claude-opus-5', pricing: { input: '5', output: '25', input_cache_read: '0.5', varies_by_provider: true } },
      { id: 'openai/gpt-5.5', pricing: { input: '1.25', output: '10' } },
    ],
  };
  const m = measurePayload(v);
  assert.equal(m.anyPriced, 2);
  assert.equal(m.pricedButUnparsed, 0, '不许再有认不出来的键');
  assert.equal(m.cache, 1);
  assert.equal(verdict(m).level, 'YES');
});

// 混合形状：主张成立（确实公布了价格）但词表没读全 —— 未读部分必须在判词里
// 报出来，不许静默丢。这是"否定结论不许靠看不见"的正面版本。
test('部分键不认识 => YES 但判词必须带未读条数', () => {
  const mixed = {
    object: 'list',
    data: [
      { id: 'a', pricing: { prompt: 1, completion: 2 } },
      { id: 'b', pricing: { video_duration_pricing: { s: 1 } } },
    ],
  };
  const m = measurePayload(mixed);
  assert.equal(m.hasPricing, 2);
  assert.equal(m.anyPriced, 1);
  assert.equal(m.pricedButUnparsed, 1);
  const v = verdict(m);
  assert.equal(v.level, 'YES');
  assert.match(v.text, /2\/2 条公布价格/);
  assert.match(v.text, /1 条的价格键不在词表内/);
  assert.match(v.text, /video_duration_pricing/);
});

test('确实没有 pricing 对象 => NO（与"读不到"区分开）', () => {
  const m = measurePayload({ object: 'list', data: [{ id: 'a' }, { id: 'b' }] });
  assert.equal(m.pricedButUnparsed, 0);
  assert.equal(verdict(m).level, 'NO');
});

test('不是清单形状 => ERR', () => {
  assert.ok(measurePayload({ models: [] }).error);
  assert.ok(measurePayload(null).error);
  assert.ok(measurePayload('nope').error);
});

// 重试判据的两个方向都要钉住：只测"该重试的会重试"，会把 401 也洗成读数。
test('传输层抖动可重试（这些是真失灵，不是答案）', () => {
  for (const msg of ['fetch failed', 'The operation was aborted', 'connect ECONNREFUSED 1.2.3.4:443',
    'read ECONNRESET', 'getaddrinfo EAI_AGAIN api.example.com', 'socket hang up']) {
    assert.equal(isRetryable(msg), true, `该重试却没重试：${msg}`);
  }
});

test('HTTP 状态码与形状错误绝不重试（401 是答案，不是失灵）', () => {
  for (const msg of ['HTTP 401', 'HTTP 403', 'HTTP 404', 'HTTP 500', '响应不是对象',
    '没有 data[] 数组（不是 OpenAI 兼容的模型清单形状）', 'data[] 为空：探针看不见东西，不能报"没有价格"']) {
    assert.equal(isRetryable(msg), false, `不该重试却重试了：${msg}`);
  }
});

test('空/异常输入不许被当成"可重试"而静默吞掉', () => {
  for (const v of [undefined, null, '', 0]) {
    assert.equal(isRetryable(v), false, `空值被判成可重试：${String(v)}`);
  }
});
