import markdown, html, sys
md = open(sys.argv[1]).read()
import re
md = re.sub(r'^```(\w+) (captured[^\n]*)$', lambda m: '<div class=lab>' + html.escape(m.group(2)) + '</div>\n\n```' + m.group(1), md, flags=re.M)
tree = open('tree.txt').read()
body = markdown.markdown(md, extensions=['tables', 'fenced_code'])
lines = []
for l in tree.splitlines():
    depth = l.count('/') - 1
    name = l.rsplit('/', 1)[-1]
    lines.append(f'<div style="padding-left:{depth*14}px">{html.escape(name)}</div>')
open('readme.html', 'w').write(f'''<!doctype html><meta charset=utf-8><title>README.md</title>
<style>
body{{margin:0;font:15px/1.55 "Noto Sans","DejaVu Sans",sans-serif;color:#1f2328;background:#fff;display:flex}}
aside{{width:300px;flex:none;background:#f6f8fa;border-right:1px solid #d0d7de;padding:16px;font:13px/1.7 "Liberation Mono",monospace;color:#24292f;min-height:100vh;box-sizing:border-box}}
aside b{{display:block;font:600 12px "Noto Sans",sans-serif;color:#57606a;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px}}
main{{padding:24px 40px;max-width:1040px}}
.tab{{font:13px "Liberation Mono",monospace;border-bottom:1px solid #d0d7de;padding-bottom:8px;margin-bottom:12px;color:#57606a}}
h1{{font-size:26px;border-bottom:1px solid #d0d7de;padding-bottom:6px;margin-top:0}} h2{{font-size:20px;border-bottom:1px solid #d0d7de;padding-bottom:4px;margin-top:26px}}
code{{font:13px "Liberation Mono",monospace;background:#eff1f3;padding:1px 4px;border-radius:4px}}
pre{{background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:10px 14px;overflow:hidden;white-space:pre-wrap}} pre code{{background:none;padding:0}}
.lab{{font:12px 'Liberation Mono',monospace;color:#8250df;margin:0 0 -10px}}
table{{border-collapse:collapse;font-size:13px}} td,th{{border:1px solid #d0d7de;padding:3px 10px;text-align:left}}
</style><aside><b>Folder</b>{"".join(lines)}</aside><main><div class=tab>.feedback/01a1451c…/README.md</div>{body}</main>''')
