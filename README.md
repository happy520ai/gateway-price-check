# gateway-price-check

[![ci](https://github.com/happy520ai/gateway-price-check/actions/workflows/ci.yml/badge.svg)](https://github.com/happy520ai/gateway-price-check/actions/workflows/ci.yml)
[![daily-readings](https://github.com/happy520ai/gateway-price-check/actions/workflows/daily.yml/badge.svg)](https://github.com/happy520ai/gateway-price-check/actions/workflows/daily.yml)

一个只读问题：**一个 OpenAI 兼容端点，在你没注册、没 key 的时候，愿不愿意把价格告诉你？**

很多模型网关要先把账号建完、充完值，你才知道自己按什么单价付费。这个工具对任意端点发**一次无鉴权 GET**，
然后报告它公开返回了什么：有没有价格、有没有币种字段、有没有缓存价、有没有告诉你每个模型 id 背后是哪份权重。

```bash
# 不用 clone、不用装：一条命令直接跑（已实测，输出如上）
npx github:happy520ai/gateway-price-check

# 探测你自己的端点
npx github:happy520ai/gateway-price-check --url https://your-gateway.example/v1 --name mine

# 或者 clone 下来
node src/cli.mjs
node src/cli.mjs --url https://your-gateway.example/v1 --name mine
```

![各家免登录公布价格的横评图](results/latest.svg)

下表与上面这张图都由 CI 从 `results/latest.json` 重写（`<!--READINGS:-->` 之间是机器区，手改会在下一次
每日跑批时被覆盖——覆盖不是 bug，是因为手抄的数字会在端点变动当天变成假话，而这张页面上的数字是给别人引用的）。
最新一次读数见 [RESULTS.md](RESULTS.md)。

<!--READINGS:BEGIN-->

| 判词 | 家数 | 是谁 |
|---|---|---|
| `YES` 免登录就公布价格 | **3** | OpenCSG 21/23 · OpenRouter 466/466 · Vercel AI Gateway 457/471 |
| `NO` 清单公开但一个价都不标 | **1** | NVIDIA NIM 0/81 |
| `AUTH` 不注册连清单都看不到（401） | **7** | OpenAI · DeepSeek · SiliconFlow 硅基流动 · Alibaba DashScope 百炼 · Volcengine Ark 火山方舟 · Zhipu 智谱 · MiniMax |

<!--READINGS:END-->

三条读数：

1. **11 家里只有 3 家免登录就给价格（27%）。** 所以"免登录能看价"既不是行业惯例，也不是某个品类的默认设置——
   任何拿它当独家卖点的文案都不该被相信。
2. **它跟厂商大小无关。** NVIDIA 把清单公开却一个价都不标；七家一线与国产原厂连清单都要 key。
   公开清单和公开价格是两件不同的事，混为一谈的探针会给出漂亮的假数据。
3. 三家里只有 OpenCSG 的价格对象带显式 `currency` 字段并按「元/百万 token」报。
   **这是单位可读性差异，不是透明度差异**——透明度上 OpenRouter 是 466/466，比它更高。

## 它刻意不做的事

- **不发任何对话请求，因此不评估模型保真度。** 它只回答"公布了什么"，不回答"给的是不是真权重"。
  要测后者，去看 `awesome-ai-gateway` 的 canary-diff 方法。
- **不并发、不重试、不轮询。** 每个端点一次 GET。
- **不把"我没读到"说成"它没有"。** 这是本工具唯一严格的设计约束，见下。

## 三档判词，而不是两档

| 退出码 | 档位 | 含义 |
|---|---|---|
| 0 | `YES` / `NO` / `AUTH` | 清单读到了；或明确被鉴权挡住（401/403）——对"免登录可见价格"这个问题，`AUTH` 就是"否" |
| 1 | `ERR` | 端点不可达 / 非 401·403 的错误 / 不是 `data[]` 清单形状 / **清单为空** |
| 2 | `UNKNOWN` | 有条目带 `pricing` 对象，但**一条都没有**字段名落在识别词表内 |

`ERR` 与 `NO` 必须分开：一个返回空数组的端点，和一个明确列出 20 个模型却一个价都不标的端点，
是两件完全不同的事。`AUTH` 也不算 `ERR`——把 401 归成"探针失灵"会**系统性高估整个行业的透明度**，
这正是我第一版犯的错，是拿 OpenAI 和 DeepSeek 真跑了一遍才暴露的。
`UNKNOWN` 存在的原因是——如果服务商把价格放在 `in_unit` 这种我们没见过的键里，
一个只会数 `prompt`/`price` 的探针会报"0 条带价"，那是**探针瞎了**，不是服务商不透明。
部分不认识时判 `YES` 并在判词里报出未解析条数与键名（Vercel 那 60 条就是这么露出来的）。

## 自测

```bash
node --test
```

10 条用例里包含四条**必中靶**：空清单必须落到 `ERR`（不许落 `NO`）、全未知字段必须落到 `UNKNOWN`、
401 必须落到 `AUTH` 而 404 仍须是 `ERR`（不许把两种失败混成一档）、部分未知时判 `YES` 但判词必须带出未解析条数。
没有这四条，上面的分档承诺只是文档里的一句话。

## 加一个服务商

编辑 `src/providers.json`，或直接用 `--url`。若对方用了新字段名，把键加进 `src/probe.mjs` 顶部的
`PRICE_KEY` / `CACHE_KEY` / `UPSTREAM_KEY` 三个正则，并补一条用例。

## 披露

本仓库作者维护一个 [OpenCSG 价格实测页](https://happy520ai.github.io/opencsg-model-pricing/)，
那个页面带个人邀请码，有人经它注册我会拿到平台奖励。本工具与那份利益关系**保持隔离**：
默认配置里两个服务商是并列摆放的，而上面那张表里 **OpenRouter 的透明度读数比 OpenCSG 更高**
（466/466 带价 vs 21/23）。如果这个工具只对某一家说好话，它就没有存在价值。

MIT。
