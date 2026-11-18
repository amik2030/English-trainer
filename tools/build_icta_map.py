#!/usr/bin/env python3
"""Build the static ICTA demo world-map geometry.

Reads Natural Earth 50m Admin-0 countries (public domain) and emits a compact
JS file with simplified SVG paths in an equirectangular projection.

    python3 tools/build_icta_map.py path/to/ne_50m_admin_0_countries.geojson

Country codes in the output are ISO 3166-1 alpha-2, except Kosovo = XKX
(Natural Earth uses ADM0_A3 "KOS" for Kosovo).
"""
import json
import math
import sys

W = 1000.0
LAT_TOP = 84.0
LAT_BOTTOM = -58.0
K = W / 360.0
H = (LAT_TOP - LAT_BOTTOM) * K

# ISO2 -> Natural Earth ADM0_A3 for the 45 demo entries (Kosovo is XKX/KOS).
EUROPE = {
    "AL": "ALB", "AD": "AND", "AT": "AUT", "BY": "BLR", "BE": "BEL",
    "BA": "BIH", "BG": "BGR", "HR": "HRV", "CZ": "CZE", "DK": "DNK",
    "EE": "EST", "FI": "FIN", "FR": "FRA", "DE": "DEU", "GR": "GRC",
    "HU": "HUN", "IS": "ISL", "IE": "IRL", "IT": "ITA", "XKX": "KOS",
    "LV": "LVA", "LI": "LIE", "LT": "LTU", "LU": "LUX", "MT": "MLT",
    "MD": "MDA", "MC": "MCO", "ME": "MNE", "NL": "NLD", "MK": "MKD",
    "NO": "NOR", "PL": "POL", "PT": "PRT", "RO": "ROU", "RU": "RUS",
    "SM": "SMR", "RS": "SRB", "SK": "SVK", "SI": "SVN", "ES": "ESP",
    "SE": "SWE", "CH": "CHE", "UA": "UKR", "GB": "GBR", "VA": "VAT",
}
BY_A3 = {v: k for k, v in EUROPE.items()}
MIN_AREA_DEMO = 0.02   # px² at world scale; below this a marker is used
MIN_AREA_OTHER = 1.2   # drop sub-pixel specks for neutral countries


def project(lon, lat):
    return ((lon + 180.0) * K, (LAT_TOP - lat) * K)


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        ax, ay = pts[i]
        bx, by = pts[j]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)
        far, idx = 0.0, -1
        for k in range(i + 1, j):
            px, py = pts[k]
            d = abs(dy * (px - ax) - dx * (py - ay)) / norm if norm else math.hypot(px - ax, py - ay)
            if d > far:
                far, idx = d, k
        if far > eps and idx > 0:
            keep[idx] = True
            stack.append((i, idx))
            stack.append((idx, j))
    return [p for p, k in zip(pts, keep) if k]


def ring_area(pts):
    s = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def split_antimeridian(ring):
    """Break a ring into runs of points that don't jump across +/-180."""
    runs, cur = [], [ring[0]]
    for prev, pt in zip(ring, ring[1:]):
        if abs(pt[0] - prev[0]) > 180:
            if len(cur) >= 3:
                runs.append(cur)
            cur = [pt]
        else:
            cur.append(pt)
    if len(cur) >= 3:
        runs.append(cur)
    return runs


def path_parts(geom, eps, min_area, demo=False):
    """Return (list_of_subpaths, label_centroid, total_area).

    Natural Earth rings can wrap the antimeridian; each ring is split into runs
    and runs far from the country's main landmass are dropped, so Russia and
    France don't get a straight line across the whole map (overseas parts).
    """
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    runs = []
    for poly in polys:
        for ri, ring in enumerate(poly):
            if len(ring) < 3:
                continue
            for run in split_antimeridian(ring):
                pts = [project(lon, lat) for lon, lat in run]
                a = ring_area(pts)
                if a < min_area:
                    continue
                cx = sum(p[0] for p in pts) / len(pts)
                cy = sum(p[1] for p in pts) / len(pts)
                runs.append((a, ri, pts, cx, cy))

    if not runs:
        return [], None, 0.0

    # Main landmass = biggest outer ring; keep only runs near it in longitude.
    outer = [r for r in runs if r[1] == 0] or runs
    main = max(outer, key=lambda r: r[0])
    main_lon = (main[3] / K) - 180.0
    total_area = sum(r[0] for r in runs if r[1] == 0)

    parts = []
    best = (0.0, None)
    for a, ri, pts, cx, cy in runs:
        lon = (cx / K) - 180.0
        if abs(lon - main_lon) > 25.0:
            continue
        xspan = max(p[0] for p in pts) - min(p[0] for p in pts)
        yspan = max(p[1] for p in pts) - min(p[1] for p in pts)
        if ri == 0 and a > best[0]:
            best = (a, (cx, cy))
        if demo and max(xspan, yspan) < 0.8:
            continue
        simp = rdp(pts, min(eps, 0.02) if a < 40 else eps)
        if len(simp) < 3:
            continue
        parts.append("M" + "L".join("%.1f %.1f" % (x, y) for x, y in simp) + "Z")

    return parts, (best[1] if best[1] else None), total_area


def main(src):
    gj = json.load(open(src))
    countries = []
    seen = set()
    total_chars = 0
    for f in gj["features"]:
        p = f["properties"]
        a3 = p.get("ADM0_A3") or ""
        code = BY_A3.get(a3)
        min_area = MIN_AREA_DEMO if code else MIN_AREA_OTHER
        parts, ctr, area = path_parts(f["geometry"], 0.3 if code else 0.8, min_area, bool(code))
        if not ctr:
            if not code:
                continue
            # Marker-only microstate: fall back to the largest ring's centroid.
            parts, ctr, area = path_parts(f["geometry"], 0.3, 0.0, True)
            if not ctr:
                continue
        if code:
            if code in seen:
                raise SystemExit("duplicate demo code %s" % code)
            seen.add(code)
        entry = {"c": code or "", "n": p.get("NAME_LONG") or p.get("NAME")}
        if parts:
            entry["d"] = "".join(parts)
        entry["x"] = round(ctr[0], 1)
        entry["y"] = round(ctr[1], 1)
        if not parts:
            entry["m"] = 1   # too small to draw -> rendered as a fixed-size marker dot
        countries.append(entry)
        total_chars += len(entry.get("d") or "")

    missing = sorted(set(EUROPE) - seen)
    if missing:
        raise SystemExit("missing demo countries: %s" % missing)

    # Fixed Europe framing: Iberia/Atlantic to the Urals, North Cape to Crete.
    view = None
    xs = [c["x"] for c in countries if c["c"]]
    ys = [c["y"] for c in countries if c["c"]]
    view = [round(project(-25, 0)[0], 1), round(project(0, 71.5)[1], 1),
            round((85 / 360.0) * W, 1), round((37.5 / 360.0) * W, 1)]

    out = (
        "/* ICTA demo map geometry — generated, do not edit by hand.\n"
        "   Geometry source: Natural Earth 50m Admin-0 countries (public domain),\n"
        "   https://www.naturalearthdata.com/ — simplified, equirectangular.\n"
        "   Regenerate with tools/build_icta_map.py. */\n"
        "window.ICTA_MAP=" + json.dumps({
            "w": round(W, 1), "h": round(H, 1), "eu": view, "countries": countries,
        }, ensure_ascii=False, separators=(",", ":")) + ";\n"
    )
    dest = "frontend/icta-map.js"
    open(dest, "w").write(out)
    print("wrote %s: %d countries, %.1f KB (svg path chars %d), eu view %s"
          % (dest, len(countries), len(out) / 1024.0, total_chars, view))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/ne50.geojson")
