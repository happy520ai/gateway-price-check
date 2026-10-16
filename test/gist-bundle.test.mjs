import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = readFileSync(root + 'gist/gateway-price-check.mjs', 'utf8');

// 这个 gist 是手工发布的，CI 改不了它（GITHUB_TOKEN 没有 gist 权限）。
// 所以不能拿"bundle 与当前 HEAD 逐字节相等"当判据——那样每次改 src 都会红，
// 一个逢改必红的门等于没有门。只问真问题：被内联进去的那份逻辑变过没有。
test('bundle 头部记有生成来源 commit', () => {
  const m = bundle.match(/生成自 commit ([0-9a-f]{7,})/);
  assert.ok(m, 'bundle 里找不到 "生成自 commit X" —— 它就不是从仓库生成的');
  const sha = execFileSync('git', ['-C', root, 'rev-parse', m[1]], { encoding: 'utf8' }).trim();
  assert.ok(sha, m[1] + ' 不是本仓库里的 commit');
});

test('bundle 内联的 probe 逻辑与 src/probe.mjs 一致', () => {
  const src = readFileSync(root + 'src/probe.mjs', 'utf8')
    .replace(/^import[^\n]*\n/gm, '')
    .replace(/^export\s+/gm, '')
    .trim();
  assert.ok(bundle.includes(src),
    'src/probe.mjs 已改动但 gist bundle 还是旧的 —— 跑 node make-gist-bundle.mjs 重新生成，\n' +
    '    然后更新 gist：<https://gist.github.com/happy520ai/5f5f2a95385ef185f51a42c04a99cc46>');
});

test('bundle 语法可解析且自带 11 家预设', () => {
  assert.equal(execFileSync('node', ['--check', root + 'gist/gateway-price-check.mjs'], { encoding: 'utf8' }), '');
  const presets = bundle.match(/"name":\s*"/g) || [];
  assert.ok(presets.length >= 11, '预设端点少于 11 家，说明 providers.json 没被完整带进去');
});
