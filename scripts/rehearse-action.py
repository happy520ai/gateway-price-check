# 预演：直接执行 action.yml 里那段 run（把 ${{ github.action_path }} 换成本目录），
# 三个靶：YES 的端点、AUTH 的端点、故意打不通的主机。跑的是将要发布的那一份文字。
import subprocess, sys, yaml, io, os, tempfile, json

BASH = os.environ.get('BASH_PATH', r'C:\Program Files\Git\bin\bash.exe')
doc = yaml.safe_load(io.open('action.yml', encoding='utf-8'))
script = doc['runs']['steps'][0]['run'].replace('${{ github.action_path }}', '.')

def run(url, name, fail_on):
    gh_out = tempfile.NamedTemporaryFile('w+', delete=False, suffix='.out')
    gh_out.close()
    env = dict(os.environ, GITHUB_OUTPUT=gh_out.name, GPC_URL=url, GPC_NAME=name, GPC_FAIL_ON=fail_on)
    p = subprocess.run([BASH, '-c', script], env=env, capture_output=True, text=True, encoding='utf-8')
    outs = open(gh_out.name, encoding='utf-8').read()
    os.unlink(gh_out.name)
    kv = dict(l.split('=', 1) for l in outs.strip().split('\n') if '=' in l)
    return p.returncode, (p.stdout or '').strip(), (p.stderr or '').strip()[:160], kv

cases = [
    ('https://ai.space.opencsg.com/v1', 'OpenCSG', 'NO'),
    ('https://api.openai.com/v1', 'OpenAI', 'NO'),
    ('https://no-such-host.invalid/v1', 'Bogus', 'NO'),
    # 必失败臂：NO 且 fail-on 含 NO ⇒ 步骤必须退 1
    ('https://integrate.api.nvidia.com/v1', 'NVIDIA', 'NO'),
    # 必拒绝臂：fail-on 里写未知判词 ⇒ 必须 REFUSED，不许静默按"没人失败"处理
    ('https://ai.space.opencsg.com/v1', 'OpenCSG', 'BEST'),
]
for url, name, ban in cases:
    rc, so, se, kv = run(url, name, ban)
    print('%-8s rc=%s verdict=%s total=%r priced=%r' % (name, rc, kv.get('verdict'), kv.get('total'), kv.get('priced')))
    if so: print('   stdout:', so.replace('\n', ' | ')[:200])
    if se: print('   stderr:', se[:200])
