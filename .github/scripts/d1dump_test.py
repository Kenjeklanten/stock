#!/usr/bin/env python3
"""Bewijst dat een dump de databank identiek terugzet, vóór er een back-up gemaakt wordt.

Bouwt een lokale sqlite met schema.sql (en seed.sql als die er is), dumpt die met dezelfde
code als de back-up, zet de dump terug in een lege databank en vergelijkt alles: rijen per
tabel, indexen, views, triggers en de tellers van AUTOINCREMENT.

    python3 .github/scripts/d1dump_test.py
"""
import os
import sqlite3
import sys

HIER = os.path.dirname(os.path.abspath(__file__))
WORTEL = os.path.abspath(os.path.join(HIER, "..", ".."))
sys.path.insert(0, HIER)
from d1dump import dump  # noqa: E402

VERGEEFLIJK = ("duplicate column", "no such column", "cannot drop")


def voer_uit(db, pad):
    """schema.sql bevat migraties die al gebeurd kunnen zijn; die fouten zijn geen fouten."""
    for stuk in open(pad, encoding="utf-8").read().split(";\n"):
        s = "\n".join(l for l in stuk.split("\n") if not l.strip().startswith("--")).strip()
        if not s:
            continue
        try:
            db.executescript(s + ";")
        except sqlite3.OperationalError as err:
            if any(w in str(err).lower() for w in VERGEEFLIJK):
                continue
            raise
    db.commit()


def tabellen(db):
    return sorted(r[0] for r in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"))


def objecten(db, soort):
    return sorted(r[0] for r in db.execute(
        f"SELECT sql FROM sqlite_master WHERE type='{soort}' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'"))


def main():
    bron = sqlite3.connect(":memory:")
    bron.row_factory = sqlite3.Row
    for bestand in ("schema.sql", "seed.sql", "seed-vinne.sql"):
        pad = os.path.join(WORTEL, bestand)
        if os.path.exists(pad):
            voer_uit(bron, pad)

    # tekens die een dump kapot maken als er niet goed ontsnapt wordt
    bron.execute("INSERT INTO settings (key, value) VALUES ('dumptest', ?)",
                 ("apostrof ' en '' , \" dubbel, \\ backslash, regel\neinde, ünïcode 漢字",))
    bron.commit()

    # kleine pagina's, zodat het pagineren mee getest wordt
    sql, rijen = dump(lambda q: [dict(r) for r in bron.execute(q).fetchall()], pagina=7)

    doel = sqlite3.connect(":memory:")
    doel.row_factory = sqlite3.Row
    doel.executescript(sql)

    fouten = []
    if tabellen(bron) != tabellen(doel):
        fouten.append(f"andere tabellen: {tabellen(bron)} vs {tabellen(doel)}")
    for t in tabellen(bron):
        a = sorted(repr(tuple(r)) for r in bron.execute(f'SELECT * FROM "{t}"'))
        b = sorted(repr(tuple(r)) for r in doel.execute(f'SELECT * FROM "{t}"'))
        if a != b:
            fouten.append(f"tabel {t}: {len(a)} rijen in de bron, {len(b)} teruggezet")
    for soort in ("index", "view", "trigger"):
        if objecten(bron, soort) != objecten(doel, soort):
            fouten.append(f"{soort}en verschillen")

    seq_a = {r[0]: r[1] for r in bron.execute("SELECT name, seq FROM sqlite_sequence")}
    seq_b = {r[0]: r[1] for r in doel.execute("SELECT name, seq FROM sqlite_sequence")}
    if seq_a != seq_b:
        fouten.append(f"sqlite_sequence verschilt: {seq_a} vs {seq_b}")
    elif seq_a.get("products"):
        # na terugzetten moet een nieuwe rij een vers id krijgen, geen hergebruikt
        doel.execute("INSERT INTO products (company_id, name) VALUES (1, 'controle na herstel')")
        nieuw = doel.execute("SELECT MAX(id) FROM products").fetchone()[0]
        if nieuw != seq_a["products"] + 1:
            fouten.append(f"de id-teller is niet hersteld: nieuw product kreeg id {nieuw}")

    if fouten:
        for f in fouten:
            print(f"  {f}")
        sys.exit("De dump zet de databank niet identiek terug.")
    print(f"Rondrit geslaagd: {len(tabellen(bron))} tabellen, {rijen} rijen, "
          f"{len(sql) / 1024:.1f} kB SQL, alles identiek teruggezet.")


if __name__ == "__main__":
    main()
