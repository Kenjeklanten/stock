#!/usr/bin/env python3
"""Zorgt dat de besteltool op Cloudflare alles heeft wat ze nodig heeft:

1. een D1-database (aangemaakt als ze nog niet bestaat);
2. het schema uit bestel/schema.sql (idempotent, CREATE TABLE IF NOT EXISTS);
3. de binding DB en de Access-variabelen op het Pages-project.

Alles verloopt via de Cloudflare API, zodat het bij elke deploy opnieuw kan draaien.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

TOKEN = os.environ.get("CF_TOKEN", "").strip()
ACCOUNT = os.environ.get("CF_ACCOUNT", "").strip()
PROJECT = os.environ.get("PROJECT", "jeconcept-stock")
D1_NAME = os.environ.get("D1_NAME", "besteltool")
API = "https://api.cloudflare.com/client/v4"

if not TOKEN or not ACCOUNT:
    sys.exit("CLOUDFLARE_API_TOKEN en CLOUDFLARE_ACCOUNT_ID ontbreken.")


def api(method, path, payload=None):
    req = urllib.request.Request(
        f"{API}/accounts/{ACCOUNT}{path}",
        method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "jeconcept-besteltool-deploy",
        },
    )
    try:
        with urllib.request.urlopen(req) as res:
            return json.load(res)
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", "replace")
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return {"success": False, "errors": [{"message": f"HTTP {err.code}: {body[:300]}"}]}


def errors(result):
    return "; ".join(e.get("message", "?") for e in (result.get("errors") or []))


# 1. Database zoeken of aanmaken -------------------------------------------------
listing = api("GET", "/d1/database?per_page=100")
if not listing.get("success"):
    sys.exit(f"D1-lijst opvragen mislukt: {errors(listing)}")

database = next((d for d in listing.get("result", []) if d.get("name") == D1_NAME), None)
if database is None:
    created = api("POST", "/d1/database", {"name": D1_NAME})
    if not created.get("success"):
        sys.exit(f"D1-database aanmaken mislukt: {errors(created)}")
    database = created["result"]
    print(f"D1-database '{D1_NAME}' aangemaakt.")
else:
    print(f"D1-database '{D1_NAME}' bestaat al.")

uuid = database["uuid"]

# 2. Oude schema-vorm opruimen ---------------------------------------------------
# Versie 1 kende nog geen bedrijven. Zo'n database kan niet zomaar met ALTER bijgewerkt
# worden (unieke indexen en NOT NULL-kolommen), dus bouwen we ze opnieuw op — maar alleen
# als er nog niets in staat. Staat er wel data in, dan stopt de deploy met een melding.
def query(sql):
    result = api("POST", f"/d1/database/{uuid}/query", {"sql": sql})
    if not result.get("success"):
        return None
    blocks = result.get("result") or []
    return (blocks[0].get("results") if blocks else []) or []


columns = query("SELECT name FROM pragma_table_info('products')")
if columns is not None and columns and not any(c.get("name") == "company_id" for c in columns):
    rows = query("SELECT (SELECT COUNT(*) FROM products) AS p, (SELECT COUNT(*) FROM counts) AS c") or [{}]
    products, counts = rows[0].get("p", 0), rows[0].get("c", 0)
    if products or counts:
        sys.exit(
            f"De database staat nog in de oude vorm (zonder bedrijven) en bevat gegevens "
            f"({products} producten, {counts} tellingen). Exporteer die eerst via Beheer → Import/export; "
            f"daarna kan de database opnieuw opgebouwd worden."
        )
    for table in ("count_lines", "counts", "par_levels", "products", "suppliers", "locations"):
        query(f"DROP TABLE IF EXISTS {table}")
    query("DELETE FROM settings WHERE key LIKE 'company_%'")
    print("Lege database in de oude vorm opgeruimd; ze wordt nu opnieuw opgebouwd.")

# 3. Schema toepassen ------------------------------------------------------------
schema = open("schema.sql", encoding="utf-8").read()


def clean(chunk):
    """Commentaarregels weglaten; wat overblijft is het echte statement."""
    body = "\n".join(line for line in chunk.splitlines() if not line.strip().startswith("--"))
    return body.strip()


statements = [c for c in (clean(part) for part in re.split(r";\s*\n", schema)) if c]
applied = 0
skipped = 0
for statement in statements:
    result = api("POST", f"/d1/database/{uuid}/query", {"sql": statement})
    if not result.get("success"):
        message = errors(result)
        # Een ALTER die al eerder liep, is geen fout: het schema is dan gewoon al bij.
        if statement.upper().startswith("ALTER TABLE") and any(
                hint in message.lower() for hint in ("duplicate column", "no such column", "cannot drop")):
            skipped += 1
            continue
        sys.exit(f"Schema toepassen mislukt op:\n{statement[:200]}\n{message}")
    applied += 1
print(f"{applied} schema-statements uitgevoerd, {skipped} migratie(s) waren al gebeurd.")

# 4. Binding en variabelen op het Pages-project ---------------------------------
env_vars = {}
for name in ("ACCESS_TEAM_DOMAIN", "ACCESS_AUD", "APP_PIN"):
    value = os.environ.get(name, "").strip()
    if value:
        env_vars[name] = {"type": "plain_text", "value": value}

config = {"d1_databases": {"DB": {"id": uuid}}}
if env_vars:
    config["env_vars"] = env_vars

patch = api("PATCH", f"/pages/projects/{PROJECT}", {"deployment_configs": {"production": config, "preview": config}})
if not patch.get("success"):
    sys.exit(f"Pages-project bijwerken mislukt: {errors(patch)}")
print(f"Binding DB → {D1_NAME} ({uuid}) gezet op {PROJECT}.")

if "ACCESS_TEAM_DOMAIN" not in env_vars:
    print("::warning::ACCESS_TEAM_DOMAIN/ACCESS_AUD zijn niet gezet: de besteltool controleert de "
          "Cloudflare Access-sessie dan niet zelf. Zet ze als GitHub secret zodra de Access-applicatie bestaat.")
