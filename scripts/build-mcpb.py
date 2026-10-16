#!/usr/bin/env python3
"""打包 .mcpb（zip + manifest.json + app/ 布局），并**当场验证包能跑**：
解到临时目录 → 起 stdio 握手 → initialize/tools/list 必须有应答，
且 latest_archive_readings 必须读得到被打包进来的 results/latest.json。
只"打成功了"不叫成功——一个装起来起不来的包，注册表里看不出来。
"""
import json, os, hashlib, shutil, subprocess, sys, tempfile, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'dist', 'gateway-price-check-mcp.mcpb')
NODE = shutil.which('node') or sys.exit('REFUSED: 找不到 node，无法验证包能跑')

INCLUDE = [
    'src/mcp-server.mjs', 'src/cli.mjs', 'src/probe.mjs', 'src/providers.json',
    'src/to-markdown.mjs', 'package.json', 'results/latest.json', 'LICENSE', 'README.md',
]

def pack():
    missing = [p for p in INCLUDE if not os.path.exists(os.path.join(ROOT, p))]
    if missing:
        sys.exit('REFUSED: 打包清单里这些文件不存在：' + ', '.join(missing))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    manifest = json.load(open(os.path.join(ROOT, 'mcpb', 'manifest.json'), encoding='utf-8'))
    pkgver = json.load(open(os.path.join(ROOT, 'package.json'), encoding='utf-8'))['version']
    if manifest['version'] != pkgver:
        # 版本对不上时不许静默出一个自称某版本而代码是别的版本的包
        sys.exit('REFUSED: manifest.version=%s 与 package.json=%s 不一致' % (manifest['version'], pkgver))
    with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
        for p in INCLUDE:
            z.write(os.path.join(ROOT, p), 'app/' + p.replace('\\', '/'))
    return manifest

def verify():
    d = tempfile.mkdtemp(prefix='mcpb-check-')
    try:
        with zipfile.ZipFile(OUT) as z:
            bad = z.testzip()
            if bad:
                sys.exit('REFUSED: zip 里 ' + bad + ' 校验失败')
            names = z.namelist()
            if 'manifest.json' not in names:
                sys.exit('REFUSED: 包里没有 manifest.json')
            if not any(n == 'app/results/latest.json' for n in names):
                sys.exit('REFUSED: 包里没有归档读数，latest_archive_readings 会在客户端里报"文件不存在"')
            z.extractall(d)
        msgs = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize",
             "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "pack-check", "version": "0"}}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "latest_archive_readings", "arguments": {}}},
            {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "check_price_disclosure", "arguments": {"url": "http://127.0.0.1/v1/models"}}},
        ]
        stdin_text = '\n'.join(json.dumps(m) for m in msgs) + '\n'
        p = subprocess.run([NODE, os.path.join(d, 'app', 'src', 'mcp-server.mjs')],
                           input=stdin_text, text=True, capture_output=True, encoding='utf-8', timeout=90)
        lines = [l for l in p.stdout.splitlines() if l.strip()]
        got = {}
        for l in lines:
            m = json.loads(l)
            if 'id' in m:
                got[m['id']] = m
        assert 1 in got and got[1]['result']['serverInfo']['name'] == 'gateway-price-check', got.get(1)
        assert 2 in got and [t['name'] for t in got[2]['result']['tools']] == ['check_price_disclosure', 'latest_archive_readings']
        assert 3 in got and got[3]['result']['isError'] is False, got.get(3)
        n = len(got[3]['result']['structuredContent']['results'])
        assert n >= 10, '包里的归档只有 %d 行' % n
        # 必拒绝臂在包里同样要成立（不是解包时丢了安全码）
        assert 4 in got and 'error' in got[4], '私网 URL 在包里没被拒绝：' + json.dumps(got.get(4))[:120]
        assert len(lines) == 4, '收到 %d 行应答，期望 4（通知被回了？）' % len(lines)
        return n
    finally:
        shutil.rmtree(d, ignore_errors=True)

if __name__ == '__main__':
    pack()
    rows = verify()
    sha = hashlib.sha256(open(OUT, 'rb').read()).hexdigest()
    print('PACKED ' + os.path.relpath(OUT, ROOT) + ' rows_in_bundle=' + str(rows))
    print('SHA256 ' + sha)
