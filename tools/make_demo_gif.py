#!/usr/bin/env python3
"""Render docs/images/before-after.gif: a SIMULATED walk through bedroom, bathroom and office.

Not a recording. "Before" reproduces the errors measured in 48 h of Radar Replay data
(bedroom radar ~40% too wide sideways, office radar mounted on its side and plotting ~1 m short,
two dots whenever the radars disagree by more than RMM's 0.4 m merge distance, a stale ghost).
"After" is what a calibrated pair with per-radar room limits should look like.

Usage: python3 tools/make_demo_gif.py   (from the repo root; needs Pillow + ffmpeg)
"""
import math, os, random, subprocess, tempfile
from PIL import Image, ImageDraw, ImageFont

random.seed(7)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'docs', 'images', 'before-after.gif')
SS = 2                      # supersample
PX = 58 * SS                # px per metre
W, H = 760 * SS, 730 * SS
FPS = 10
BG = (30, 35, 38); SURF = (41, 48, 52); LINE = (63, 73, 78); INK = (237, 242, 239); MUTE = (167, 180, 177)
SEA = (140, 189, 181); BLUSH = (230, 188, 182); BAD = (255, 154, 165); WARN = (245, 215, 110)

def F(size, w='Regular'):
    return ImageFont.truetype(os.path.join(HERE, 'fonts', f'IBMPlexSans-{w}.ttf'), size * SS)

ALCOVE = (2.8, 1.3, 3.55, 3.2)   # old robe, doors off, part of the bedroom
ROOMS = {'Bedroom': (0, 0, 2.8, 3.4), 'Bathroom': (0, 3.45, 2.8, 5.5), 'Office': (0, 5.55, 2.8, 8.45)}
BED_R = (3.55, 2.4)          # bedroom radar, robe back wall, facing the bedhead wall (-x)
OFF_R = (1.4, 8.45)          # office radar, middle of the bottom wall, facing the bathroom (-y)
OFF_R_OLD = (2.5, 8.2)       # where it sat before (corner box, on its side)

ROUTE = [((1.2, 1.4), 0), ((2.1, 2.5), 0), ((1.35, 3.25), 0), ((1.4, 4.3), 0), ((0.65, 4.15), 12),
         ((0.6, 5.0), 18), ((1.35, 5.7), 0), ((1.6, 6.8), 0), ((0.85, 7.5), 22), ((1.35, 5.7), 0),
         ((1.35, 3.3), 0), ((1.2, 1.6), 6)]
SPEED = 0.06                 # metres per frame (0.6 m/s)

def route():
    pts = []
    for i in range(len(ROUTE) - 1):
        (a, pa), (b, _) = ROUTE[i], ROUTE[i + 1]
        pts += [a] * pa
        n = max(1, int(math.dist(a, b) / SPEED))
        pts += [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(n)]
    return pts + [ROUTE[-1][0]] * 10

def room_of(p):
    for name, (x0, y0, x1, y1) in ROOMS.items():
        if x0 <= p[0] <= x1 and y0 <= p[1] <= y1:
            return name
    x0, y0, x1, y1 = ALCOVE
    return 'Bedroom' if x0 <= p[0] <= x1 and y0 <= p[1] <= y1 else None

def jit(s=0.08):
    return random.gauss(0, s)

def before(p):
    """Return list of (point, colour) the old setup would show, plus ghost list."""
    dots = []
    rm = room_of(p)
    # bedroom radar: sees bedroom + edge of bathroom; lateral (y) axis 40% too wide
    if rm == 'Bedroom' or (rm == 'Bathroom' and p[1] < 4.6 and random.random() < 0.6):
        dots.append(((p[0] + jit(), BED_R[1] + (p[1] - BED_R[1]) * 1.4 + jit()), SEA))
    # office radar on its side: bathroom pulled ~1 m toward it, desk mostly missed
    if rm == 'Bathroom' or (rm == 'Office' and (p[1] < 7.0 or random.random() < 0.25)):
        q = (p[0] + (OFF_R_OLD[0] - p[0]) * 0.3 + jit(0.12), p[1] + (OFF_R_OLD[1] - p[1]) * 0.3 + jit(0.12))
        dots.append((q, BLUSH))
    if len(dots) == 2 and math.dist(dots[0][0], dots[1][0]) < 0.4:
        dots = [(((dots[0][0][0] + dots[1][0][0]) / 2, (dots[0][0][1] + dots[1][0][1]) / 2), SEA)]
    return dots

def after(p):
    rm = room_of(p)
    if rm is None:            # in a doorway: whichever radar is closer keeps you
        rm = 'Bedroom' if p[1] < 3.45 else 'Office'
    col = SEA if rm == 'Bedroom' else BLUSH
    return [((p[0] + jit(0.05), p[1] + jit(0.05)), col)]

def zones_from(dots):
    z = {k: False for k in ROOMS}
    for q, _ in dots:
        r = room_of(q)
        if r: z[r] = True
    return z

def draw_panel(d, ox, oy, title, sub, dots, ghosts, zones, radar_old):
    S = lambda x, y: (ox + x * PX, oy + y * PX)
    d.text((ox, oy - 62 * SS), title, font=F(20, 'Bold'), fill=INK)
    d.text((ox, oy - 36 * SS), sub, font=F(12), fill=MUTE)
    for name, (x0, y0, x1, y1) in ROOMS.items():
        d.rectangle([S(x0, y0), S(x1, y1)], fill=SURF)
        d.text(S(x0 + 0.12, y0 + 0.1), name, font=F(11, 'SemiBold'), fill=MUTE)
    # walls (with door gaps at x 1.0-1.7 on the bathroom walls)
    w = 4 * SS
    for y in (3.43, 5.52):
        d.line([S(0, y), S(1.0, y)], fill=INK, width=w); d.line([S(1.7, y), S(2.8, y)], fill=INK, width=w)
    d.rectangle([S(ALCOVE[0], ALCOVE[1]), S(ALCOVE[2], ALCOVE[3])], fill=SURF)
    d.line([S(2.8, 0), S(2.8, ALCOVE[1]), S(ALCOVE[2], ALCOVE[1]), S(ALCOVE[2], ALCOVE[3]), S(2.8, ALCOVE[3]), S(2.8, 8.45)], fill=INK, width=w, joint='curve')
    d.line([S(2.8, 0), S(0, 0), S(0, 8.45), S(2.8, 8.45)], fill=INK, width=w, joint='curve')
    # radars
    br = BED_R
    d.rounded_rectangle([S(br[0] - 0.08, br[1] - 0.2), S(br[0] + 0.08, br[1] + 0.2)], radius=3 * SS, fill=SEA)
    orr = OFF_R_OLD if radar_old else OFF_R
    d.rounded_rectangle([S(orr[0] - 0.2, orr[1] - 0.08), S(orr[0] + 0.2, orr[1] + 0.08)], radius=3 * SS, fill=BLUSH)
    for q, _ in ghosts:
        x, y = S(*q); r = 9 * SS
        d.ellipse([x - r, y - r, x + r, y + r], outline=MUTE, width=2 * SS)
        d.text((x + 12 * SS, y - 8 * SS), 'ghost', font=F(10), fill=MUTE)
    for q, col in dots:
        x, y = S(*q); r = 9 * SS
        d.ellipse([x - r, y - r, x + r, y + r], fill=col, outline=BG, width=2 * SS)
    # zone pills
    px = ox; py = oy + 8.45 * PX + 18 * SS
    n = len(dots)
    for name, on in zones.items():
        txt = name; tw = d.textlength(txt, font=F(11, 'SemiBold')) + 18 * SS
        d.rounded_rectangle([px, py, px + tw, py + 24 * SS], radius=12 * SS, fill=SEA if on else LINE)
        d.text((px + 9 * SS, py + 4 * SS), txt, font=F(11, 'SemiBold'), fill=BG if on else MUTE)
        px += tw + 6 * SS
    count_col = BAD if n > 1 else (MUTE if n == 0 else INK)
    d.text((ox, py + 32 * SS), f'people counted: {n}', font=F(12, 'SemiBold'), fill=count_col)

def main():
    pts = route()
    tmp = tempfile.mkdtemp()
    ghost = []; ghost_ttl = 0; flips = {'b': 0, 'a': 0}; last = {'b': None, 'a': None}
    for i, p in enumerate(pts):
        img = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(img)
        bd = before(p); ad = after(p)
        # before: leave a ghost in the bathroom once you walk out of it
        if room_of(p) == 'Office' and last['b'] == 'Bathroom' and not ghost:
            ghost = [((1.9, 4.9), MUTE)]; ghost_ttl = 120
        last['b'] = room_of(p)
        if ghost_ttl: ghost_ttl -= 1
        else: ghost = []
        bz = zones_from(bd + ghost); az = zones_from(ad)
        draw_panel(d, 70 * SS, 150 * SS, 'Before', 'bedroom radar 40% too wide, office radar on its side', bd, ghost, bz, True)
        draw_panel(d, 410 * SS, 150 * SS, 'After', 'calibrated, each radar limited to its rooms', ad, [], az, False)
        # true position marker (small cross) on both
        for ox in (70, 410):
            x, y = ox * SS + p[0] * PX, 150 * SS + p[1] * PX
            d.line([x - 5 * SS, y, x + 5 * SS, y], fill=WARN, width=2 * SS); d.line([x, y - 5 * SS, x, y + 5 * SS], fill=WARN, width=2 * SS)
        d.text((70 * SS, 22 * SS), 'Two LD2450s, one person walking: bedroom, bathroom, office desk, back', font=F(15, 'SemiBold'), fill=INK)
        d.text((70 * SS, 44 * SS), 'Simulation from 48 h of Radar Replay data. Yellow cross = where the person really is.', font=F(11), fill=MUTE)
        img.resize((W // SS, H // SS), Image.LANCZOS).save(f'{tmp}/f{i:04d}.png')
    pal = f'{tmp}/pal.png'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', f'{tmp}/f%04d.png', '-vf', 'palettegen=max_colors=96', pal], check=True)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', f'{tmp}/f%04d.png', '-i', pal,
                    '-lavfi', 'paletteuse=dither=none', '-loop', '0', OUT], check=True)
    print('wrote', OUT, len(pts), 'frames')

if __name__ == '__main__':
    main()
