#!/usr/bin/env python3
"""Bouwt de besteltool: kopieert app/ naar dist/ en hangt een inhoudshash aan de CSS/JS-URL's,
zodat een nieuwe versie nooit achter een oude browsercache blijft steken.

    python3 build.py dist
"""
import hashlib
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

    for page in out.glob("*.html"):
        html = page.read_text(encoding="utf-8")
        html = re.sub(r'(href="/css/[^"?]+\.css)"', rf'\1?v={version}"', html)
        html = re.sub(r'(src="/js/[^"?]+\.js)"', rf'\1?v={version}"', html)
        page.write_text(html, encoding="utf-8")

    # De modules importeren elkaar met een kale naam; ook die krijgen de versie mee.
    for script in (out / "js").glob("*.js"):
        code = script.read_text(encoding="utf-8")
        code = re.sub(r"from '(\./[^']+\.js)'", rf"from '\1?v={version}'", code)
        script.write_text(code, encoding="utf-8")

    for extra in ("_headers", "_redirects", "robots.txt"):
        source = ROOT / extra
        if source.exists():
            shutil.copy2(source, out / extra)

    pages = sorted(p.name for p in out.glob("*.html"))
    print(f"besteltool gebouwd in {out} (versie {version}): {', '.join(pages)}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "dist")
