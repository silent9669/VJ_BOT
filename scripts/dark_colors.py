#!/usr/bin/env python3
"""Dark-mode color map. Literal hex colors in the stylesheets are written as var(--c-<hex>, #<hex>);
this script collects them and rewrites the generated block in static/dark.css (lightness inverted, hue kept).
Run: python3 scripts/dark_colors.py [--wrap]   (--wrap first rewrites plain hex colors in the stylesheets)."""
import colorsys, glob, re, sys

SKIP = ('landing.css', 'mascot.css', 'motion.css', 'ios.css', 'dark.css')
PROPS = re.compile(r'((?:^|[;{\s])(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline(?:-color)?|fill|stroke|text-decoration-color|caret-color)\s*:)([^;}{]*)', re.I)
HEX = re.compile(r'(?<![\w-])#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b(?!\s*,\s*#)')
files = [f for f in glob.glob('static/*.css') if not f.endswith(SKIP)]

def norm(h):
    h = h.lower()
    return h if len(h) == 6 else ''.join(c * 2 for c in h)

def wrap_value(value):
    if 'var(' in value and '--c-' in value: return value
    return HEX.sub(lambda m: f'var(--c-{norm(m.group(1))},#{m.group(1)})', value)

if '--wrap' in sys.argv:
    for f in files:
        css = open(f).read()
        out = PROPS.sub(lambda m: m.group(1) + wrap_value(m.group(2)), css)
        if out != css: open(f, 'w').write(out)

used = set()
for f in glob.glob('static/*.css'):
    if f.endswith('dark.css'): continue
    used |= set(re.findall(r'--c-([0-9a-f]{6})\b', open(f).read()))

def invert(h):
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    hh, l, s = colorsys.rgb_to_hls(r, g, b)
    l2 = 1 - l
    l2 = 0.12 + l2 * 0.78 if l2 < 0.5 else 0.36 + l2 * 0.6  # keep surfaces off pure black, text off pure white
    r, g, b = colorsys.hls_to_rgb(hh, l2, s * 0.85)
    return '#%02x%02x%02x' % (round(r * 255), round(g * 255), round(b * 255))

block = ':root[data-theme=dark] {\n' + '\n'.join(f'  --c-{h}: {invert(h)};' for h in sorted(used)) + '\n}\n'
path = 'static/dark.css'
css = open(path).read()
start, end = '/* BEGIN generated colors */\n', '/* END generated colors */\n'
if start in css:
    css = re.sub(re.escape(start) + r'.*?' + re.escape(end), lambda _: start + block + end, css, flags=re.S)
else:
    css += '\n' + start + block + end
open(path, 'w').write(css)
print(len(used), 'colors')
