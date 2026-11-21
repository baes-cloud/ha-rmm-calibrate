#!/usr/bin/env python3
"""Summarise a Radar Replay movement log (ha-rmm-replay .jsonl): where each radar's raw points land,
and how often two radars report the same person apart (duplicates RMM won't merge).

Usage: python3 tools/analyse_replay.py rmm_movement_history.jsonl rmm_backup.json [merge_m]
  rmm_backup.json = output of tools/rmm_dump.py (for zone polygons and map scale)
"""
import json, math, sys, collections

log, dump = sys.argv[1], sys.argv[2]
merge = float(sys.argv[3]) if len(sys.argv) > 3 else 0.4
d = json.load(open(dump))["data"]["maps"]["default"]
SX, SY = float(d["config"]["map_scale_x"]), float(d["config"]["map_scale_y"])
ROOMS = {z["name"]: z["points"] for z in d["zones"]["include_zones"]}

def pip(x, y, p):
    c = False; j = len(p) - 1
    for i in range(len(p)):
        (xi, yi), (xj, yj) = p[i], p[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c

def room(x, y):
    if not (-2 <= x <= 102 and -2 <= y <= 102): return "outside the plan"
    hits = [n for n, p in ROOMS.items() if pip(x, y, p)]
    return hits[0] if hits else "between zones"

cov = collections.defaultdict(collections.Counter); gaps = []; frames = 0
for line in open(log):
    f = json.loads(line); frames += 1
    r = f.get("r", [])
    for name, i, x, y in r: cov[name][room(x, y)] += 1
    by = collections.defaultdict(list)
    for name, i, x, y in r: by[name].append((x, y))
    names = list(by)
    for a in range(len(names)):
        for b in range(a + 1, len(names)):
            gaps.append(min(math.hypot((p[0] - q[0]) / SX, (p[1] - q[1]) / SY) for p in by[names[a]] for q in by[names[b]]))
print(f"{frames} frames")
for n, c in cov.items():
    t = sum(c.values()); print(f"\n{n}: {t} points")
    for k, v in c.most_common(): print(f"  {k:18s} {100 * v / t:5.1f}%")
if gaps:
    gaps.sort(); near = [g for g in gaps if g < 2.0]
    print(f"\nframes where two radars both report someone: {len(gaps)}")
    if near:
        print(f"  median gap {near[len(near) // 2]:.2f} m; {sum(g > merge for g in near) / len(near):.0%} further apart than the {merge} m merge distance (= two people on the map)")
