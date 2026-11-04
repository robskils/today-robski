"""Paints the time-of-day washes behind Koyeba (public/wash/*.webp).

Usage: python3 tools/wash/paint.py public/wash   (needs numpy and pillow)
Prints the worst-case contrast of each text colour against its wash; every
figure must stay at 4.5 or above, because the wash sits behind all text.
"""
import sys
import numpy as np
from PIL import Image, ImageFilter

W, H = 1800, 2400
OUT = sys.argv[1]


def fbm(rng, base, octaves=5, falloff=0.55):
    out = np.zeros((H, W))
    amp, total = 1.0, 0.0
    cell = base
    for _ in range(octaves):
        gw, gh = max(2, W // cell + 2), max(2, H // cell + 2)
        grid = (rng.random((gh, gw)) * 255).astype('uint8')
        out += np.asarray(Image.fromarray(grid).resize((W, H), Image.BICUBIC), dtype=float) / 255 * amp
        total += amp
        amp *= falloff
        cell = max(2, cell // 2)
    out /= total
    return (out - out.min()) / (out.max() - out.min())


def blur(a, r):
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype('uint8'))
    return np.asarray(im.filter(ImageFilter.GaussianBlur(r)), dtype=float) / 255


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def hexrgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], dtype=float) / 255


def lum(rgb):
    c = np.where(rgb <= 0.03928, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    return c[..., 0] * 0.2126 + c[..., 1] * 0.7152 + c[..., 2] * 0.0722


def contrast(text, field):
    a, b = lum(hexrgb(text)), lum(field)
    return (np.maximum(a, b) + 0.05) / (np.minimum(a, b) + 0.05)


def paint(seed, ground, pig_a, pig_b, blobs, inks, name):
    rng = np.random.default_rng(seed)
    g, a, b = hexrgb(ground), hexrgb(pig_a), hexrgb(pig_b)
    dark = g.sum() < 1.0

    x = np.linspace(0, 1, W)[None, :] * np.ones((H, W))
    y = np.linspace(0, 1, H)[:, None] * np.ones((H, W))
    wx = x + 0.34 * (fbm(rng, 700, 5, 0.55) - 0.5)
    wy = y + 0.20 * (fbm(rng, 700, 5, 0.55) - 0.5)
    field = np.zeros((H, W))
    for cx, cy, rx, ry, amp in blobs:
        field += amp * np.exp(-(((wx - cx) / rx) ** 2 + ((wy - cy) / ry) ** 2))
    field = np.clip(field, 0, 1.1)

    flow = fbm(rng, 460, 6, 0.6)
    grain = fbm(rng, 5, 3, 0.7) - 0.5
    tooth = fbm(rng, 3, 2, 0.6) - 0.5

    # wet-in-wet body, then a few lost-and-found drying edges rather than one skyline
    density = field * (0.62 + 0.62 * flow)
    found = smooth(0.52, 0.72, fbm(rng, 500, 4, 0.5))
    for thr in (0.2, 0.45):
        mask = smooth(thr - 0.006, thr + 0.006, field + 0.12 * (flow - 0.5))
        edge = np.clip(mask - blur(mask, 8), 0, 1) * 2.0
        density += edge * found * (-0.05 if dark else 0.15)
    bloom = smooth(0.615, 0.62, fbm(rng, 240, 6, 0.62))
    density += field * np.clip(bloom - blur(bloom, 6), 0, 1) * (-0.08 if dark else 0.22)
    density -= field * blur(bloom, 22) * 0.22
    density += (field + 0.03) * grain * 0.20
    density = np.clip(density, 0, 1.0)

    mix = smooth(0.34, 0.66, fbm(rng, 620, 4, 0.5))[..., None]
    pigment = a * (1 - mix) + b * mix
    lg, lp = np.log(g + 0.004), np.log(pigment + 0.004)
    rgb = np.exp(lg + (lp - lg) * density[..., None]) - 0.004
    rgb = np.clip(rgb * (1 + tooth[..., None] * (0.022 if dark else 0.03)), 0, 1)  # paper tooth everywhere

    Image.fromarray((rgb * 255).astype('uint8')).save(f'{OUT}/{name}.webp', quality=84, method=6)

    report = [f"{label} {np.percentile(contrast(colour, rgb), 0.5):.1f}" for label, colour in inks.items()]
    print(name, ' | '.join(report))
    return rgb



SETS = [
    # seed, ground, two pigments, blobs (x, y, x-reach, y-reach, strength), text colours, name
    (11, '#3B2B36', '#A9685F', '#7C6383', [(0.25, -0.02, 1.0, 0.30, 0.72), (0.9, 0.18, 0.55, 0.16, 0.56), (0.5, 0.62, 0.85, 0.16, 0.3), (0.1, 0.9, 0.6, 0.14, 0.24)],
     {'ink': '#FFFFFF', 'mute': '#F3EAE6', 'goldt': '#FAE6B8'}, 'dawn'),
    (23, '#F8F5EE', '#A9C7DA', '#EBD8BF', [(0.95, 0.0, 0.85, 0.26, 1.0), (0.5, 0.2, 0.45, 0.1, 0.42), (0.08, 0.7, 0.5, 0.14, 0.15)],
     {'ink': '#211D14', 'mute': '#4C4636', 'goldt': '#6E4C0C'}, 'morning'),
    (37, '#F7F6EF', '#7FB0D4', '#EFE3CC', [(0.75, 0.0, 0.8, 0.24, 1.0), (0.1, 0.16, 0.42, 0.14, 0.85), (0.5, 0.42, 0.42, 0.11, 0.7), (0.92, 0.58, 0.36, 0.12, 0.75), (0.15, 0.74, 0.42, 0.11, 0.6), (0.65, 0.95, 0.5, 0.1, 0.55)],
     {'ink': '#12110C', 'mute': '#37342C', 'goldt': '#523906'}, 'midday'),
    (53, '#343E4C', '#7A8FA3', '#94897C', [(0.7, 0.0, 0.95, 0.24, 0.8), (0.1, 0.18, 0.5, 0.15, 0.62), (0.55, 0.45, 0.5, 0.12, 0.42), (0.92, 0.62, 0.4, 0.12, 0.4), (0.15, 0.78, 0.45, 0.12, 0.3)],
     {'ink': '#FFFFFF', 'mute': '#EEF1F4', 'goldt': '#F6DFA8'}, 'overcast'),
    (41, '#2E2230', '#A95F48', '#6E4A78', [(0.4, -0.04, 1.15, 0.2, 0.74), (0.95, 0.16, 0.45, 0.08, 0.36), (0.05, 0.82, 0.6, 0.14, 0.2)],
     {'ink': '#F6EADF', 'mute': '#EFE3DD', 'goldt': '#F5D593'}, 'dusk'),
    (83, '#0D1220', '#515A84', '#30294F', [(0.84, 0.05, 0.30, 0.075, 1.0), (0.35, 0.03, 0.95, 0.16, 0.62), (0.75, 0.24, 0.6, 0.09, 0.3), (0.15, 0.62, 0.6, 0.13, 0.2), (0.85, 0.88, 0.6, 0.12, 0.16)],
     {'ink': '#EEF0F5', 'mute': '#C6CAD8', 'goldt': '#E6C67C'}, 'night'),
]
for s in SETS:
    paint(*s)
