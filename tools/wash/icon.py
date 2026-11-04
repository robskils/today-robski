"""Paints Koyeba's app icon and email mark: the Mandombe "ko" on the night sky.

Usage: python3 tools/wash/icon.py public   (needs numpy and pillow; run paint.py first)
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1]
S = 2048               # draw big, shrink for clean edges
IVORY = (244, 241, 232, 255)
GOLD = (226, 186, 104, 255)

# The real mark, from public/favicon.svg: runs of straight strokes, in its own units.
IVORY_RUNS = [[(237, 220), (275, 220)],
              [(237, 220), (237, 245), (272, 245), (272, 272), (237, 272)],
              [(237, 258), (200, 258), (200, 285), (237, 285), (237, 313), (200, 313)]]
GOLD_RUNS = [[(275, 220), (315, 220), (315, 272)], [(275, 245), (315, 272)]]
X0, X1, Y0, Y1 = 200, 315, 220, 313


def stroke(draw, pts, width, colour):
    draw.line(pts, fill=colour, width=width)
    half = width / 2
    for x, y in pts:   # square caps and mitred corners
        draw.rectangle([x - half, y - half, x + half, y + half], fill=colour)


def icon():
    sky = Image.open(f'{OUT}/wash/night.webp').convert('RGB')
    w, h = sky.size
    # The moodiest corner of the sky, filling the whole square.
    side = min(w, int(h * 0.42))
    base = sky.crop((w - side, 0, w, side)).resize((S, S), Image.LANCZOS)
    base = Image.eval(base, lambda v: min(255, int(v * 1.28))).convert('RGBA')

    # The mark, centred on the pane.
    scale = S * 0.56 / max(X1 - X0, Y1 - Y0)
    ox = S / 2 - (X0 + X1) / 2 * scale
    oy = S / 2 - (Y0 + Y1) / 2 * scale
    width = max(8, int(8 * scale))
    pt = lambda p: (p[0] * scale + ox, p[1] * scale + oy)
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    for run in IVORY_RUNS:
        stroke(ld, [pt(p) for p in run], width, IVORY)
    for run in GOLD_RUNS:
        stroke(ld, [pt(p) for p in run], width, GOLD)
    return Image.alpha_composite(base, layer).convert('RGB')


art = icon()
for name, size in (('icon-192.v21.png', 192), ('icon-512.v21.png', 512), ('apple-touch-icon.v21.png', 180),
                   ('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180),
                   ('email-mark.png', 184), ('brand/koyeba-appicon-1024.png', 1024)):
    art.resize((size, size), Image.LANCZOS).save(f'{OUT}/{name}', optimize=True)
