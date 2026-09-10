#!/usr/bin/env python3
"""Bouwt de besteltool: kopieert app/ naar dist/ en hangt een inhoudshash aan de CSS/JS-URL's,
zodat een nieuwe versie nooit achter een oude browsercache blijft steken.

    python3 build.py dist
"""
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
APP = ROOT / "app"


def digest(paths):
    h = hashlib.sha1()
    for path in sorted(paths):
        h.update(path.read_bytes())
    return h.hexdigest()[:10]


def main(target="dist"):
    out = Path(target)
    if not out.is_absolute():
        out = Path.cwd() / target
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(APP, out)

    assets = list((out / "css").glob("*.css")) + list((out / "js").glob("*.js"))
    version = digest(assets)

    # Staat er een logo in app/ (logo.svg, logo.png of logo.webp), dan komt dat in de kop in
    # plaats van de woordmerk-tekst. Zolang het er niet is, blijft de tekst staan — zo hangt er
    # nooit een kapotte afbeelding in de kop.
    logo = next((n for n in ("logo.svg", "logo.png", "logo.webp") if (APP / n).exists()), None)
    merk = ('<a class="brand" href="/">Besteltool <span>JE Concept</span></a>')
    if logo:
        merk_nieuw = f'<a class="brand brand--logo" href="/"><img src="/{logo}" alt="Besteltool JE Concept"></a>'

    for page in out.glob("*.html"):
        html = page.read_text(encoding="utf-8")
        if logo:
            html = html.replace(merk, merk_nieuw)
        html = re.sub(r'(href="/css/[^"?]+\.css)"', rf'\1?v={version}"', html)
        html = re.sub(r'(src="/js/[^"?]+\.js)"', rf'\1?v={version}"', html)
        page.write_text(html, encoding="utf-8")

    # De modules importeren elkaar met een kale naam; ook die krijgen de versie mee.
    for script in (out / "js").glob("*.js"):
        code = script.read_text(encoding="utf-8")
        code = re.sub(r"from '(\./[^']+\.js)'", rf"from '\1?v={version}'", code)
        script.write_text(code, encoding="utf-8")

    # De service worker krijgt de versie en de lijst met bestanden die vooraf bewaard mogen
    # worden; zo werkt de tool offline en hangt niemand op een oude versie.
    worker = out / "sw.js"
    if worker.exists():
        shell = ["/", "/dashboard", "/historiek", "/beheer", "/bestelling", "/ontvangst",
                 "/favicon.svg", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"]
        shell += sorted(f"/{a.relative_to(out).as_posix()}?v={version}" for a in assets)
        code = worker.read_text(encoding="utf-8")
        code = code.replace("__VERSION__", version).replace("__ASSETS__", json.dumps(shell, indent=2))
        worker.write_text(code, encoding="utf-8")

    for extra in ("_headers", "_redirects", "robots.txt"):
        source = ROOT / extra
        if source.exists():
            shutil.copy2(source, out / extra)

    pages = sorted(p.name for p in out.glob("*.html"))
    print(f"besteltool gebouwd in {out} (versie {version}): {', '.join(pages)}")
    print(f"kop: {'logo ' + logo if logo else 'tekst (zet app/logo.svg klaar voor het JE Concept-logo)'}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "dist")
