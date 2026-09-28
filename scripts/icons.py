#!/usr/bin/env python3
"""Maakt de app-iconen voor het beginscherm van een telefoon.

Zelfde tekening als favicon.svg: het zeshoekmotief van het merkteken, in de navy van het
designsysteem. Als PNG, want Android wil 192 en 512 pixels voor "toevoegen aan beginscherm".
Er komt ook een maskable versie: die vult het hele vierkant, zodat het systeem er zijn eigen
vorm uit mag knippen zonder de tekening aan te snijden.

De zeshoek volgt --clip-hex uit het designsysteem: punt boven en onder.

    python3 scripts/icons.py          # schrijft app/icon-*.png
"""
import struct
import zlib
from pathlib import Path

# de kleuren van het designsysteem
NAVY_950 = (0x00, 0x17, 0x2E)   # de grond
NAVY_100 = (0xDC, 0xE4, 0xF0)   # de lichte zeshoek uit het logo
NAVY_800 = (0x00, 0x30, 0x60)   # de merkinkt
SS = 4  # supersampling: vier keer zo fijn tekenen en dan uitmiddelen


def rounded_rect(x, y, w, h, r):
    """Zit (x, y) binnen de afgeronde rechthoek?"""
    def inside(px, py):
        if not (x <= px <= x + w and y <= py <= y + h):
            return False
        cx = min(max(px, x + r), x + w - r)
        cy = min(max(py, y + r), y + h - r)
        return (px - cx) ** 2 + (py - cy) ** 2 <= r * r
    return inside


def circle(cx, cy, r):
    return lambda px, py: (px - cx) ** 2 + (py - cy) ** 2 <= r * r


def hexagon(cx, cy, w, h):
    """De zeshoek van --clip-hex: punten op 50%/0% en 50%/100%, zijden op 25% en 75%."""
    punten = [(cx, cy - h / 2), (cx + w / 2, cy - h / 4), (cx + w / 2, cy + h / 4),
              (cx, cy + h / 2), (cx - w / 2, cy + h / 4), (cx - w / 2, cy - h / 4)]

    def inside(px, py):
        binnen = False
        for i in range(len(punten)):
            x1, y1 = punten[i]
            x2, y2 = punten[(i + 1) % len(punten)]
            if (y1 > py) != (y2 > py) and px < x1 + (py - y1) / (y2 - y1) * (x2 - x1):
                binnen = not binnen
        return binnen
    return inside


def draw(size, maskable=False):
    """Tekent het icoon op een grid van size×size en geeft de RGB-rijen terug."""
    mid = size / 2
    # bij een maskable icoon staat de tekening kleiner, binnen de veilige zone
    groot = size * (0.58 if maskable else 0.76)
    klein = groot * 0.66

    buiten = hexagon(mid, mid, groot * 0.92, groot)
    binnen = hexagon(mid, mid, klein * 0.92, klein)

    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            r = g = b = 0
            for sy in range(SS):
                for sx in range(SS):
                    px = x + (sx + 0.5) / SS
                    py = y + (sy + 0.5) / SS
                    if binnen(px, py):
                        kleur = NAVY_800
                    elif buiten(px, py):
                        kleur = NAVY_100
                    else:
                        kleur = NAVY_950
                    r += kleur[0]; g += kleur[1]; b += kleur[2]
            n = SS * SS
            row += bytes((r // n, g // n, b // n))
        rows.append(bytes(row))
    return rows


def write_png(path, rows, size):
    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    path.write_bytes(png)
    print(f"{path.name}: {size}×{size}, {len(png) / 1024:.1f} kB")


if __name__ == "__main__":
    app = Path(__file__).resolve().parent.parent / "app"
    for size in (192, 512):
        write_png(app / f"icon-{size}.png", draw(size), size)
    write_png(app / "icon-maskable-512.png", draw(512, maskable=True), 512)
