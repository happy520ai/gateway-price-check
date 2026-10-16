// Pure measurement. No network, no clock - so it can be tested against fixtures,
// including fixtures that must make it fail.

const PRICE_KEY = /prompt|completion|price/i;
const CACHE_KEY = /cache/i;
const UPSTREAM_KEY = /repo_path|hugging_face_id|canonical_slug|base_model/i;

export function priceOf(m) {
  if (!m || typeof m !== 'object') return null;
  return m.pricing ?? m?.metadata?.pricing ?? null;
}

export function measurePayload(payload) {
  if (!payload || typeof payload !== 'object') return { error: '响应不是对象' };
  const rows = payload.data;
  if (!Array.isArray(rows)) return { error: '没有 data[] 数组（不是 OpenAI 兼容的模型清单形状）' };
  if (rows.length === 0) return { error: 'data[] 为空：探针看不见东西，不能报"没有价格"' };

  let inputPriced = 0;
  let anyPriced = 0;
  let cache = 0;
  let currency = 0;
  let upstream = 0;
  // 关键：用了我们词表之外的字段名时，不许静默算成"没公布价格"。
  const unrecognized = new Set();
  let pricedButUnparsed = 0;

  for (const m of rows) {
    const p = priceOf(m);
    if (p && typeof p === 'object') {
      const keys = Object.keys(p);
      const matched = keys.filter(k => PRICE_KEY.test(k));
      if (matched.length) anyPriced++;
      else if (keys.length) { pricedButUnparsed++; keys.forEach(k => unrecognized.add(k)); }
      if (JSON.stringify(p).match(CACHE_KEY)) cache++;
      if (JSON.stringify(p).match(/"currency"/)) currency++;
      const inp = p.input_token_price?.price_per_million ?? p.prompt;
      if (inp !== undefined && inp !== null) inputPriced++;
    }
    if (JSON.stringify(m).match(UPSTREAM_KEY)) upstream++;
  }

  return {
    total: rows.length,
    listShape: payload.object === 'list',
    inputPriced,
    anyPriced,
    cache,
    currency,
    upstream,
    pricedButUnparsed,
    unrecognizedKeys: [...unrecognized],
  };
}

// 只有"解析到了价格形状"和"确实没有价格"才允许下结论；
// 出现 pricedButUnparsed 时读数不完整，必须标注为不可判。
export function verdict(r) {
  if (r.error) return { level: 'ERR', text: '不可判：' + r.error };
  if (r.pricedButUnparsed > 0) {
    return {
      level: 'UNKNOWN',
      text: `不可判：${r.pricedButUnparsed} 条带 pricing 对象但字段名不在词表内（${r.unrecognizedKeys.slice(0, 4).join(', ')}）`,
    };
  }
  if (r.anyPriced === 0) return { level: 'NO', text: '免登录清单里没有任何价格字段' };
  const pct = Math.round((r.anyPriced / r.total) * 100);
  const bits = [`${r.anyPriced}/${r.total} 条带价（${pct}%）`];
  if (r.currency) bits.push('带显式币种字段');
  if (r.cache) bits.push('含缓存价');
  if (r.upstream) bits.push('含上游仓库标识');
  return { level: 'YES', text: bits.join(' · ') };
}
