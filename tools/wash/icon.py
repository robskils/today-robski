"""Paints Kaya's app icon, email mark and favicon: the serif 'k.' on the night sky.

The wordmark is 'kaya.' (Cormorant Garamond 500, ivory, gold full stop); the app
mark is just its first letter, 'k.', on the same painted night wash the app uses.

Usage: python3 tools/wash/icon.py public   (needs pillow, fonttools, brotli;
run paint.py first so public/wash/night.webp exists)
"""
import sys
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen

OUT = sys.argv[1]
S = 2048                       # draw big, shrink for clean edges
IVORY = (244, 241, 232, 255)
GOLD = (226, 186, 104, 255)
IVORY_HEX = '#F4F1E8'
GOLD_HEX = '#E2BA68'
TILE_BG = '#141B31'            # flat night for the favicon (reads at 16px)
WOFF2 = f'{OUT}/fonts/CormorantGaramond-500.woff2'

# Cormorant Garamond 500, the brand face. PIL can't read woff2, so decompress
# it to an in-memory/temp ttf once.
_tt = TTFont(WOFF2)
_tt.flavor = None
_TTF = f'{OUT}/brand/_cormorant-500.ttf'
_tt.save(_TTF)


def background():
    """The moodiest corner of the night wash, filling the square - unchanged."""
    sky = Image.open(f'{OUT}/wash/night.webp').convert('RGB')
    w, h = sky.size
    side = min(w, int(h * 0.42))
    base = sky.crop((w - side, 0, w, side)).resize((S, S), Image.LANCZOS)
    return Image.eval(base, lambda v: min(255, int(v * 1.28))).convert('RGBA')


def mark(target_frac=0.60, nudge_y=-0.02):
    """'k.' drawn tight, scaled so its height = target_frac*S, then centred."""
    font = ImageFont.truetype(_TTF, int(S * 0.9))
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    bx, by = S * 0.2, S * 0.6
    adv_k = d.textlength('K', font=font)
    d.text((bx, by), 'K', font=font, fill=IVORY, anchor='ls')
    d.text((bx + adv_k, by), '.', font=font, fill=GOLD, anchor='ls')
    content = layer.crop(layer.getbbox())
    th = int(target_frac * S)
    tw = int(content.width * th / content.height)
    content = content.resize((tw, th), Image.LANCZOS)
    final = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    final.paste(content, ((S - tw) // 2, (S - th) // 2 + int(nudge_y * S)), content)
    return final


def favicon_svg():
    """A crisp vector 'k.' on a flat night tile, for the browser tab."""
    tt = TTFont(WOFF2)
    cmap = tt.getBestCmap()
    gs = tt.getGlyphSet()
    hmtx = tt['hmtx']

    def glyph(ch):
        gname = cmap[ord(ch)]
        sp = SVGPathPen(gs)
        gs[gname].draw(sp)
        bp = BoundsPen(gs)
        gs[gname].draw(bp)
        return sp.getCommands(), bp.bounds, hmtx[gname][0]

    k_d, k_b, k_adv = glyph('K')
    p_d, p_b, _ = glyph('.')
    # Combined bounds in font units, with the dot shifted to follow the k.
    x0 = min(k_b[0], p_b[0] + k_adv)
    x1 = max(k_b[2], p_b[2] + k_adv)
    y0 = min(k_b[1], p_b[1])
    y1 = max(k_b[3], p_b[3])
    cw, ch = x1 - x0, y1 - y0
    target = 300.0                      # mark ~0.59 of the 512 tile
    s = target / max(cw, ch)
    tx = (512 - s * cw) / 2
    ty = (512 - s * ch) / 2
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
        f'<rect width="512" height="512" fill="{TILE_BG}"/>'
        f'<g transform="translate({tx:.2f} {ty:.2f}) scale({s:.5f} {-s:.5f}) translate({-x0:.1f} {-y1:.1f})">'
        f'<path d="{k_d}" fill="{IVORY_HEX}"/>'
        f'<g transform="translate({k_adv} 0)"><path d="{p_d}" fill="{GOLD_HEX}"/></g>'
        f'</g></svg>\n'
    )


art = Image.alpha_composite(background(), mark()).convert('RGB')
for name, size in (('icon-192.v23.png', 192), ('icon-512.v23.png', 512), ('apple-touch-icon.v23.png', 180),
                   ('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180),
                   ('email-mark.png', 184), ('brand/kaya-appicon-1024.png', 1024)):
    art.resize((size, size), Image.LANCZOS).save(f'{OUT}/{name}', optimize=True)

with open(f'{OUT}/favicon.svg', 'w') as f:
    f.write(favicon_svg())

import os
os.remove(_TTF)
print('icons + favicon written')
