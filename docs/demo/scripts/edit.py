#!/usr/bin/env python3
"""Cut the Nuru scenario recording and the Claude Code terminal replay into docs/demo/nuru-demo.mp4."""
import subprocess, os
W, H, BAND, FPS = 1280, 800, 64, 24
FONT = '/nix/store/5gbijvvjbp9pvp0dv77g16dn45xyxlrh-noto-fonts-2026.09.01/share/fonts/noto/NotoSans.ttf'
D = '/home/dev/demo-run/video'
SCEN = '/home/dev/demo-raw/nuru-scenario.mp4'
GIF = '/home/dev/demo-run/claude.gif'
SHOTS = '/home/dev/toolbar/docs/demo'
ENC = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p', '-r', str(FPS), '-an']
def tf(i, text):
    p = f'{D}/cap{i:02d}.txt'; open(p, 'w').write(text); return p
def band(i, text):
    return (f"pad={W}:{H+BAND}:0:0:color=0x111318,"
            f"drawtext=expansion=none:fontfile={FONT}:textfile={tf(i, text)}:fontcolor=white:fontsize=24:x=24:y={H}+(({BAND}-th)/2)")
def run(args):
    subprocess.run(['ffmpeg', '-v', 'error', '-y'] + args, check=True)
segs = []
def clip(i, start, end, speed, text):
    out = f'{D}/s{i:02d}.mp4'
    run(['-ss', str(start), '-to', str(end), '-i', SCEN, '-vf', f"setpts=(PTS-STARTPTS)/{speed},fps={FPS},scale={W}:{H}," + band(i, text)] + ENC + [out])
    segs.append(out)
def still(i, img, secs, text):
    out = f'{D}/s{i:02d}.mp4'
    run(['-loop', '1', '-t', str(secs), '-i', img, '-vf', f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=white,fps={FPS}," + band(i, text)] + ENC + [out])
    segs.append(out)
def card(i, secs, title, sub):
    out = f'{D}/s{i:02d}.mp4'
    t1, t2 = tf(i * 10 + 1, title), tf(i * 10 + 2, sub)
    run(['-f', 'lavfi', '-t', str(secs), '-i', f'color=c=0x111318:s={W}x{H+BAND}:r={FPS}', '-vf',
         f"drawtext=expansion=none:fontfile={FONT}:textfile={t1}:fontcolor=white:fontsize=46:x=(w-tw)/2:y=h/2-80,"
         f"drawtext=expansion=none:fontfile={FONT}:textfile={t2}:fontcolor=0xb8bcc6:fontsize=26:x=(w-tw)/2:y=h/2+10:line_spacing=12"] + ENC + [out])
    segs.append(out)
def term(i, text):
    out = f'{D}/s{i:02d}.mp4'
    run(['-i', GIF, '-vf', f"fps={FPS},scale=-2:{H},pad={W}:{H}:(ow-iw)/2:0:color=0x272822," + band(i, text)] + ENC + [out])
    segs.append(out)

card(1, 4, 'open-toolbar on Nuru', 'A reviewer traces a lesson on 116.nuru.sh.\nThen Claude Code fixes the bug from the feedback folder alone.')
clip(2, 0, 11.6, 1.5, 'Nuru, /sw. The reviewer wakes the toolbar (Ctrl+Shift+.) and starts a trace.')
clip(3, 11.6, 27.2, 1.5, 'Lesson 1: write a line of Nuru and run it (Endesha).')
clip(4, 27.2, 40.8, 1.25, 'Highlight the output and comment, then comment on the title: lesson 1 is English on /sw.')
clip(5, 40.8, 58.7, 3, 'A 15 s voice note on the trace (shown 3x faster).')
clip(6, 58.7, 85.2, 1.75, 'Lesson 2 says to use /n for a new line. The reviewer comments, then tries \\n.')
clip(7, 85.2, 118.9, 2, 'Lesson 5: a syntax error, then 10 % 0, which crashes with the wrong message.')
clip(8, 118.9, 157.7, 3, 'English and back, lesson 8 with input, a reload mid-run, 390 px wide (3x).')
clip(9, 157.7, 163.4, 1, 'Stop. The notes go onto the trace, and the capture uploads.')
still(10, f'{SHOTS}/06-capture.png', 4.5, 'On the server: replay, the reviewer\'s notes, console, network and actions.')
still(11, f'{SHOTS}/13-folder-readme.png', 5, 'What the agent reads: .feedback/<id>/README.md, pulled with one curl line.')
card(12, 3.5, 'Fix the problem reported in <share link>', 'Claude Code, Opus 5.5, no MCP. The skill was installed from the server.')
term(13, 'Claude Code pulls the folder, reads README.md, then the response body it names.')
card(14, 6, 'Fixed: seed.ts --adopt', 'The repo\'s lessons were right. The deploy\'s database held an old module\nthat the seed skipped. Tested on a throwaway Postgres, feedback resolved\nwith the re-seed command. Nuru\'s deployment was not changed.')
open(f'{D}/list.txt', 'w').write(''.join(f"file '{s}'\n" for s in segs))
run(['-f', 'concat', '-safe', '0', '-i', f'{D}/list.txt', '-c', 'copy', '-movflags', '+faststart', '/home/dev/toolbar/docs/demo/nuru-demo.mp4'])
