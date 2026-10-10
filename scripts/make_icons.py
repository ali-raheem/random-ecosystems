#!/usr/bin/env python3
"""Draw the app icons (icon.svg plus the PNG sizes) from one geometry: a meadow with a
lake, a small herd of pale grazers and a red hunter closing in. Pillow only."""
from pathlib import Path
import math
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent / 'icons'
MEADOW = (62, 120, 58)
WOOD = (30, 72, 40)
LAKE = (34, 70, 92)
GRAZER = (245, 235, 210)
HUNTER = (255, 90, 70)
# (x, y, heading in degrees) in a 0..1 square
HERD = [(0.52, 0.5, 200), (0.62, 0.58, 190), (0.47, 0.64, 215), (0.6, 0.43, 170), (0.7, 0.5, 185)]
HUNT = (0.24, 0.36, 20)


def ellipse_pts(cx, cy, rx, ry, ang, n=24):
    a = math.radians(ang)
    return [(cx + rx * math.cos(t) * math.cos(a) - ry * math.sin(t) * math.sin(a),
             cy + rx * math.cos(t) * math.sin(a) + ry * math.sin(t) * math.cos(a))
            for t in (2 * math.pi * i / n for i in range(n))]


def arrow_pts(cx, cy, ln, ang):
    a = math.radians(ang)
    pts = [(1.2 * ln, 0), (-0.8 * ln, 0.62 * ln), (-0.45 * ln, 0), (-0.8 * ln, -0.62 * ln)]
    return [(cx + x * math.cos(a) - y * math.sin(a), cy + x * math.sin(a) + y * math.cos(a)) for x, y in pts]


def shapes(s, inset):
    m = s * inset
    w = s - 2 * m
    P = lambda x, y: (m + x * w, m + y * w)
    lake = ellipse_pts(*P(0.72, 0.8), w * 0.24, w * 0.13, -12)
    wood = [ellipse_pts(*P(x, y), w * r, w * r, 0) for x, y, r in [(0.18, 0.78, 0.13), (0.3, 0.86, 0.1), (0.1, 0.62, 0.08)]]
    herd = [ellipse_pts(*P(x, y), w * 0.055, w * 0.032, a) for x, y, a in HERD]
    hunter = arrow_pts(*P(HUNT[0], HUNT[1]), w * 0.075, HUNT[2])
    return lake, wood, herd, hunter


def png(size, inset, rounded):
    s = size * 4
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle((0, 0, s - 1, s - 1), radius=s * 0.22, fill=MEADOW)
    else:
        d.rectangle((0, 0, s, s), fill=MEADOW)
    lake, wood, herd, hunter = shapes(s, inset)
    d.polygon(lake, fill=LAKE)
    for wd in wood:
        d.polygon(wd, fill=WOOD)
    for g in herd:
        d.polygon(g, fill=GRAZER)
    d.polygon(hunter, fill=HUNTER, outline=(30, 8, 8), width=max(2, s // 120))
    if rounded:
        mask = Image.new('L', (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, s - 1, s - 1), radius=s * 0.22, fill=255)
        img.putalpha(mask)
    return img.resize((size, size), Image.LANCZOS)


def svg():
    s = 512
    lake, wood, herd, hunter = shapes(s, 0.0)
    poly = lambda pts, fill, extra='': f'<polygon points="{" ".join(f"{x:.1f},{y:.1f}" for x, y in pts)}" fill="rgb{fill}"{extra}/>'
    body = poly(lake, LAKE) + ''.join(poly(w, WOOD) for w in wood) + ''.join(poly(g, GRAZER) for g in herd)
    body += poly(hunter, HUNTER, ' stroke="rgb(30,8,8)" stroke-width="4" stroke-linejoin="round"')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {s} {s}">'
            f'<clipPath id="c"><rect width="{s}" height="{s}" rx="{s * 0.22:.0f}"/></clipPath>'
            f'<g clip-path="url(#c)"><rect width="{s}" height="{s}" fill="rgb{MEADOW}"/>{body}</g></svg>\n')


ROOT.mkdir(exist_ok=True)
(ROOT / 'icon.svg').write_text(svg())
png(192, 0.0, True).save(ROOT / 'icon-192.png')
png(512, 0.0, True).save(ROOT / 'icon-512.png')
png(512, 0.12, False).save(ROOT / 'icon-maskable-512.png')
png(180, 0.04, False).convert('RGB').save(ROOT / 'apple-touch-icon.png')
print('wrote', ', '.join(sorted(p.name for p in ROOT.iterdir())))
