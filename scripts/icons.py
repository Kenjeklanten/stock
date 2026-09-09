#!/usr/bin/env python3
"""Maakt de app-iconen voor het beginscherm van een telefoon.

Zelfde tekening als favicon.svg — een tellijst met een accentbol — maar als PNG, want
Android wil PNG's van 192 en 512 pixels voor "toevoegen aan beginscherm". Er komt ook een
maskable versie: die vult het hele vierkant, zodat het systeem er zijn eigen vorm uit mag
knippen zonder de tekening aan te snijden.

    python3 scripts/icons.py          # schrijft app/icon-*.png
"""
import struct
import zlib
from pathlib import Path

NAVY = (0x10, 0x49, 0x5F)
WHITE = (0xFF, 0xFF, 0xFF)
AMBER = (0xF0, 0xB3, 0x57)
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


def draw(size, maskable=False):
    """Tekent het icoon op een grid van size×size en geeft de RGB-rijen terug."""
    unit = size / 64
    inset = 0 if maskable else 0
    # bij een maskable icoon staat de tekening kleiner, binnen de veilige zone (80%)
    scale = 0.62 if maskable else 1.0
    offset = (64 - 64 * scale) / 2

    def t(v):
        return (offset + v * scale) * unit

    achtergrond = (rounded_rect(0, 0, size, size, 0) if maskable
                   else rounded_rect(0, 0, size, size, 14 * unit))
    def balk(x0, x1, midden):
        dik = 5 * scale * unit
        return rounded_rect(t(x0), t(midden - 2.5), (x1 - x0) * scale * unit, dik, dik / 2)

    balken = [balk(18, 46, 20), balk(18, 46, 32), balk(18, 36, 44)]
    bol = circle(t(46), t(44), 7 * scale * unit)

    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            r = g = b = 0
            for sy in range(SS):
                for sx in range(SS):
                    px = x + (sx + 0.5) / SS
                    py = y + (sy + 0.5) / SS
                    if bol(px, py):
                        kleur = AMBER
                    elif any(bar(px, py) for bar in balken):
                        kleur = WHITE
                    elif achtergrond(px, py):
                        kleur = NAVY
                    else:
                        kleur = NAVY if maskable else None
                    if kleur is None:
                        kleur = NAVY  # buiten de afronding: dezelfde kleur, geen transparantie
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
