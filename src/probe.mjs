// Pure measurement. No network, no clock - so it can be tested against fixtures,
// including fixtures that must make it fail.

// 词表按"整键匹配或含价格语义词"来收，宁可显式扩表也不许把见过的 pricing 对象
// 静默算成"0 条带价"。Vercel AI Gateway 用的是 input/output/varies_by_provider，
// 2026-10-17 实测时被旧词表判成 UNKNOWN —— 那 471 条其实全带价。
const PRICE_KEY = /prompt|completion|price|^input$|^output$|^input_.+$|^output_.+$|^cost/i;
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
  let hasPricing = 0;   // 有非空 pricing 对象 => "免登录确实公布了价格"，这是本工具的主张
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
      if (keys.length) hasPricing++;
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
    hasPricing,
    cache,
    currency,
    upstream,
    pricedButUnparsed,
    unrecognizedKeys: [...unrecognized],
  };
}

// 三档之外必须有第四档：对本工具问的那个问题（"不注册能不能看到价"），
// 401/403 是**答案**，不是探针失灵。把它算成"不可判"会系统性高估行业透明度。
const AUTH_RE = /HTTP 40[13]\b/;

// 只有传输层抖动值得重试。把 401/404 也重试一遍，等于用三次失败换一次"读到了"，
// 那正是本工具存在的理由（把"我没读到"和"它没价格"分开）的反面。
const TRANSPORT_RE = /fetch failed|aborted|ECONN|ETIMEDOUT|EAI_AGAIN|socket hang up|terminated|network/i;
// 接受用户手里的 base_url（`.../v1`），而不只是完整清单地址（`.../v1/models`）。
// 猜错的后果是 ERR（吵），不是假 YES（骗），所以这条归一化是安全的；
// 但猜了就要说出来，所以 CLI 会把最终地址印出来。
export function normalizeModelsUrl(raw) {
  const u = new URL(raw);
  let p = u.pathname.replace(/\/+$/, '');
  if (/\/models(\?|$)/.test(p)) return u.href;
  if (p === '' || p === '/') p = '/v1';
  u.pathname = p + '/models';
  return u.href;
}

export function isRetryable(msg) {
  return TRANSPORT_RE.test(String(msg || ''));
}

export function verdict(r) {
  if (r.error && AUTH_RE.test(r.error)) {
    return { level: 'AUTH', text: '需要 key 才能读清单（' + r.error + '）——对"免登录可见价格"这个问题，这就是否' };
  }
  if (r.error) return { level: 'ERR', text: '不可判：' + r.error };
  if (r.pricedButUnparsed > 0 && r.anyPriced === 0) {
    return {
      level: 'UNKNOWN',
      text: `不可判：${r.pricedButUnparsed} 条带 pricing 对象但没有一条字段名在词表内（${r.unrecognizedKeys.slice(0, 4).join(', ')}）`,
    };
  }
  if (r.hasPricing === 0) return { level: 'NO', text: '免登录清单里没有任何价格字段' };
  const pct = Math.round((r.hasPricing / r.total) * 100);
  const bits = [`${r.hasPricing}/${r.total} 条公布价格（${pct}%）`];
  if (r.currency) bits.push('带显式币种字段');
  if (r.cache) bits.push('含缓存价');
  if (r.upstream) bits.push('含上游仓库标识');
  // 词表没覆盖到的键必须继续说出来：主张成立（它确实公布了价格），
  // 但"公布成什么样"这部分我没读全——两件事分开讲。
  if (r.pricedButUnparsed > 0) {
    bits.push(`注：${r.pricedButUnparsed} 条的价格键不在词表内（${r.unrecognizedKeys.slice(0, 3).join(', ')}…）——它们计入"公布价格"列，但我没解析出数值`);
  }
  return { level: 'YES', text: bits.join(' · ') };
}
