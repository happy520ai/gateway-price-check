# 结构自检：action.yml 必须能解析，且内嵌 shell 必须能通过 bash -n。
# GitHub 的 ${{ ... }} 模板不是合法 bash，所以先把它们换成一个普通变量再测语法。
import subprocess, sys, yaml, io, re, os

doc = yaml.safe_load(io.open('action.yml', encoding='utf-8'))
steps = doc['runs']['steps']
assert doc['runs']['using'] == 'composite', doc['runs']['using']
assert len(steps) == 1, len(steps)
script = steps[0]['run']
print('inputs=', ','.join(doc['inputs'].keys()))
print('outputs=', ','.join(doc['outputs'].keys()))
for k, v in doc['outputs'].items():
    assert v['value'].startswith('${{ steps.run.outputs.'), (k, v['value'])
tpl = re.findall(r'\$\{\{[^}]*\}\}', script)
clean = re.sub(r'\$\{\{[^}]*\}\}', '$GPC_ACTION_PATH', script)
print('templates_substituted=', len(tpl))
r = subprocess.run([os.environ.get('BASH_PATH', r'C:\Program Files\Git\bin\bash.exe'), '-n'],
                   input=clean, text=True, capture_output=True, encoding='utf-8')
print('BASH_N_RC=', r.returncode)
if r.returncode:
    print(r.stderr)
    sys.exit(1)
print('YAML_OK outputs_bound=true shell_syntax=true')
