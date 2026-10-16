#!/usr/bin/env python3
"""Turn a Claude Code stream-json transcript into an asciicast v2 file that looks like the
terminal UI: tool calls, short results, the agent's words. Times are compressed: each step
gets a fixed beat, and a status line on top shows the real elapsed time of the run."""
import json, re, sys, textwrap, datetime
src, out = sys.argv[1], sys.argv[2]
COLS, ROWS = 120, 40
rows = [json.loads(l) for l in open(src)]
REPO = re.compile(r'/home/dev/handoff-run/runs/[^/ ]+/repo/?')
FID = '01a1451c-6df5-7199-93dd-fd14ac6139ba'
EMAIL = re.compile(r'[\w.+-]+@(?!nuru\.test)[\w-]+\.[\w.]+')
def clean(s):
    s = REPO.sub('', s).replace('cd ; ', '').replace('cd  ; ', '').replace(FID, '01a1451c')
    s = s.replace('/home/dev/handoff-run/runs/claude-lessons-v2/repo', '.')
    s = re.sub(r'^cd \S*; ', '', s)
    return EMAIL.sub('<email>', s)
ts = lambda r: datetime.datetime.fromisoformat(r['timestamp'].replace('Z', '+00:00')).timestamp()
t_start = None
for r in rows:
    if 'timestamp' in r: t_start = ts(r); break
t_start -= 2  # the skill launch happened about 2 s after start
events, t = [], 0.0
DIM, RST, B, GRN, CYA, YEL, WHT = '\x1b[2m', '\x1b[0m', '\x1b[1m', '\x1b[32m', '\x1b[36m', '\x1b[33m', '\x1b[97m'
def emit(text, beat):
    global t
    events.append([round(t, 3), 'o', text]); t += beat
def status(real):
    m, s = divmod(int(real), 60)
    return f'\x1b7\x1b[1;1H\x1b[44m\x1b[97m{(" Claude Code  |  real time " + f"{m}:{s:02d}" + "  |  shown about 5x faster ").ljust(COLS)}\x1b[0m\x1b8'
def wrap(s, ind, width=COLS - 4):
    lines = []
    for para in s.split('\n'):
        lines += textwrap.wrap(para, width - len(ind), replace_whitespace=False) or ['']
    return lines
# screen setup: clear, keep row 1 for the status bar via a scroll region
emit('\x1b[2J\x1b[2;%dr\x1b[2;1H' % ROWS + status(0), 0.3)
prompt = 'Fix the problem reported in http://localhost:3263/s/g6htgaobdENSInReTgt4lg'
emit(f'{GRN}~/nuru{RST} $ ', 0.6)
for i in range(0, len(prompt) + 1, 6):
    pass
emit(f'claude "{prompt}"\r\n\r\n', 1.6)
pending = {}
for r in rows:
    if r.get('type') not in ('assistant', 'user'): continue
    real = ts(r) - t_start
    c = r['message']['content']
    if isinstance(c, str): continue
    for b in c:
        if r['type'] == 'assistant' and b['type'] == 'text':
            body = clean(b['text']).strip()
            final = body.startswith('I fixed the cause')
            lines = wrap(body, '  ')
            if final:
                lines = [l for l in lines][:26]
            emit(status(real) + '\r\n'.join([f'{WHT}{B}●{RST} {WHT}' + lines[0]] + ['  ' + l for l in lines[1:]]) + f'{RST}\r\n\r\n', 1.2 + 0.03 * len(lines) + (5 if final else 0))
        elif r['type'] == 'assistant' and b['type'] == 'tool_use':
            n, inp = b['name'], b['input']
            if n == 'Bash': arg = inp['command']
            elif n == 'Read': arg = inp['file_path']
            elif n == 'Skill': arg = inp['skill']
            else: arg = json.dumps(inp)[:200]
            arg = clean(arg).replace('\n', ' ')
            arg = re.sub(r'\s+', ' ', arg)
            if len(arg) > 2 * (COLS - 12): arg = arg[:2 * (COLS - 12) - 3] + '...'
            al = wrap(arg, '        ')
            pending[b['id']] = n
            emit(status(real) + f'{GRN}●{RST} {B}{n}{RST}({al[0]}' + ''.join('\r\n    ' + l for l in al[1:]) + ')\r\n', 0.35)
        elif r['type'] == 'user' and b['type'] == 'tool_result':
            n = pending.get(b.get('tool_use_id'), '')
            cont = b['content']
            txt = cont if isinstance(cont, str) else ''.join(x.get('text', '') for x in cont if isinstance(x, dict))
            txt = clean(txt).rstrip()
            if n == 'Read' and not txt.strip(): txt = '(image opened)'
            ls = [l for l in txt.split('\n')]
            keep = 3
            if 'open-toolbar feedback' in txt[:60]: keep = 16
            if 'Launching skill' in txt: ls, keep = ['Loaded skill open-toolbar-feedback (SKILL.md)'], 1
            shown = [l[:COLS - 8] for l in ls[:keep]]
            more = len(ls) - keep
            o = ''.join(f'  {DIM}⎿  {l}{RST}\r\n' if i == 0 else f'     {DIM}{l}{RST}\r\n' for i, l in enumerate(shown))
            if more > 0: o += f'     {DIM}... +{more} lines{RST}\r\n'
            emit(status(real) + o + '\r\n', 0.5 + (2.2 if keep == 16 else 0))
emit(status(291) + f'{GRN}~/nuru{RST} $ ', 3)
emit('', 0)
with open(out, 'w') as f:
    f.write(json.dumps({'version': 2, 'width': COLS, 'height': ROWS, 'env': {'TERM': 'xterm-256color'}}) + '\n')
    for e in events: f.write(json.dumps(e) + '\n')
print('duration', round(t, 1), 'events', len(events))
