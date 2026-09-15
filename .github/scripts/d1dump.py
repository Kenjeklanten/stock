#!/usr/bin/env python3
"""Een volledige SQL-dump van een D1-database maken met gewone queries.

De export-API van D1 werkt met pollen op een bookmark en gaf in de praktijk
"Not currently exporting anything" terug zodra de export klaar was voor de eerste poll.
Deze databank is klein genoeg om ze gewoon uit te lezen: schema uit sqlite_master, rijen
per tabel. Dat is één rechte lijn zonder wachten, en het resultaat is een bestand dat
`wrangler d1 execute --file` zo terugzet.

`dump(query)` verwacht één functie die SQL uitvoert en een lijst rijen (dicts) teruggeeft,
zodat dezelfde code tegen D1 én tegen een lokale sqlite getest kan worden.
"""

PAGINA = 2000        # rijen per query; D1 geeft niet graag alles in één keer terug
MAX_RIJEN = 500_000  # veiligheidsrem: hierboven stopt de dump met een fout


def waarde(v):
    """Eén waarde als SQL-literal."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return repr(v)
    if isinstance(v, (bytes, bytearray)):
        return "X'" + bytes(v).hex() + "'"
    if isinstance(v, list):
        # de query-API geeft een BLOB terug als lijst bytes
        return "X'" + bytes(bytearray(int(b) & 0xFF for b in v)).hex() + "'"
    return "'" + str(v).replace("'", "''") + "'"


def naam(n):
    return '"' + str(n).replace('"', '""') + '"'


def dump(query, *, pagina=PAGINA):
    """Geeft de volledige databank terug als één string SQL."""
    objecten = query(
        "SELECT type, name, tbl_name, sql FROM sqlite_master "
        "WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' "
        "ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 1 "
        "WHEN 'index' THEN 2 ELSE 3 END, name"
    )
    tabellen = [o for o in objecten if o["type"] == "table"]
    if not tabellen:
        raise RuntimeError("De databank bevat geen tabellen; dit lijkt niet op de juiste databank.")

    regels = ["-- Back-up van de besteltool. Terugzetten:",
              "--   npx wrangler d1 execute besteltool --remote --file=laatste.sql",
              "PRAGMA foreign_keys=OFF;",
              "BEGIN TRANSACTION;"]

    # 1. tabellen aanmaken en vullen
    totaal = 0
    for tabel in tabellen:
        regels.append(f"DROP TABLE IF EXISTS {naam(tabel['name'])};")
        regels.append(tabel["sql"].strip() + ";")
        kolommen = [r["name"] for r in query(f"SELECT name FROM pragma_table_info({waarde(tabel['name'])})")]
        if not kolommen:
            continue
        lijst = ", ".join(naam(k) for k in kolommen)
        aantal = 0
        while True:
            rijen = query(f"SELECT {lijst} FROM {naam(tabel['name'])} "
                          f"LIMIT {int(pagina)} OFFSET {int(aantal)}")
            if not rijen:
                break
            for rij in rijen:
                velden = ", ".join(waarde(rij.get(k)) for k in kolommen)
                regels.append(f"INSERT INTO {naam(tabel['name'])} ({lijst}) VALUES ({velden});")
            aantal += len(rijen)
            totaal += len(rijen)
            if totaal > MAX_RIJEN:
                raise RuntimeError(f"Meer dan {MAX_RIJEN} rijen; de back-up is niet volledig.")
            if len(rijen) < pagina:
                break

    # 2. de tellers van AUTOINCREMENT mee terugzetten, anders krijgt de eerste nieuwe rij
    #    een id dat al bestaan heeft
    volgnummers = query("SELECT name, seq FROM sqlite_sequence ORDER BY name") if any(
        "AUTOINCREMENT" in (t["sql"] or "").upper() for t in tabellen) else []
    if volgnummers:
        regels.append("DELETE FROM sqlite_sequence;")
        for rij in volgnummers:
            regels.append("INSERT INTO sqlite_sequence (name, seq) VALUES "
                          f"({waarde(rij['name'])}, {waarde(rij['seq'])});")

    # 3. indexen, views en triggers achteraan, zodat ze niet bij elke INSERT bijgewerkt worden
    for obj in objecten:
        if obj["type"] == "table":
            continue
        soort = {"index": "INDEX", "view": "VIEW", "trigger": "TRIGGER"}.get(obj["type"], "")
        if soort:
            regels.append(f"DROP {soort} IF EXISTS {naam(obj['name'])};")
        regels.append(obj["sql"].strip() + ";")

    regels.append("COMMIT;")
    regels.append("PRAGMA foreign_keys=ON;")
    return "\n".join(regels) + "\n", totaal
