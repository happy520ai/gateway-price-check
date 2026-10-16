import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measurePayload, verdict } from '../src/probe.mjs';

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
