#!/usr/bin/env python3
"""Zet een volledige back-up van de D1-database in een R2-bucket.

Draait wekelijks vanuit .github/workflows/backup.yml (en met de hand via workflow_dispatch).
Er komen twee bestanden in de bucket:

    besteltool/besteltool-JJJJ-MM-DD.sql   de back-up van die dag
    besteltool/laatste.sql                 altijd de meest recente

Terugzetten:
    npx wrangler d1 execute besteltool --remote --file=laatste.sql

De dump wordt met gewone queries opgebouwd (zie d1dump.py), niet met de export-API van D1:
die werkt met pollen op een bookmark en gaf "Not currently exporting anything" terug zodra
de export klaar was vóór de eerste poll.

Omgeving: CF_TOKEN, CF_ACCOUNT, D1_NAME, R2_BUCKET.
Het token heeft D1:Edit én R2:Edit nodig. Ontbreekt R2, dan stopt het script met een
duidelijke melding in plaats van met een stacktrace.
"""
import datetime
import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from d1dump import dump  # noqa: E402

TOKEN = os.environ.get("CF_TOKEN", "").strip()
ACCOUNT = os.environ.get("CF_ACCOUNT", "").strip()
D1_NAME = os.environ.get("D1_NAME", "besteltool")
BUCKET = os.environ.get("R2_BUCKET", "besteltool-backups")
API = "https://api.cloudflare.com/client/v4"

if not TOKEN or not ACCOUNT:
    sys.exit("CLOUDFLARE_API_TOKEN en CLOUDFLARE_ACCOUNT_ID ontbreken.")


def api(method, path, payload=None, raw=None, content_type="application/json"):
    data = raw if raw is not None else (json.dumps(payload).encode() if payload is not None else None)
    req = urllib.request.Request(
        f"{API}/accounts/{ACCOUNT}{path}",
        method=method,
        data=data,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": content_type,
                 "User-Agent": "jeconcept-besteltool-backup"},
    )
    try:
        with urllib.request.urlopen(req) as res:
            body = res.read()
            try:
                return res.status, json.loads(body)
            except json.JSONDecodeError:
                return res.status, {"success": True, "raw": body}
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", "replace")
        try:
            return err.code, json.loads(body)
        except json.JSONDecodeError:
            return err.code, {"success": False, "errors": [{"message": f"HTTP {err.code}: {body[:300]}"}]}


def reasons(result):
    return "; ".join(e.get("message", "?") for e in (result.get("errors") or [])) or "onbekende fout"


# 1. de database vinden ----------------------------------------------------------
status, listing = api("GET", "/d1/database?per_page=100")
if not listing.get("success"):
    sys.exit(f"D1-lijst opvragen mislukt: {reasons(listing)}")
database = next((d for d in listing.get("result", []) if d.get("name") == D1_NAME), None)
if not database:
    sys.exit(f"Database '{D1_NAME}' bestaat niet.")
uuid = database["uuid"]


# 2. de databank uitlezen --------------------------------------------------------
def query(sql):
    status, out = api("POST", f"/d1/database/{uuid}/query", {"sql": sql})
    if not out.get("success"):
        raise RuntimeError(f"Query mislukt ({sql[:70]}…): {reasons(out)}")
    blokken = out.get("result") or []
    return (blokken[0].get("results") or []) if blokken else []


try:
    sql, rijen = dump(query)
except RuntimeError as err:
    sys.exit(f"Back-up mislukt: {err}")

payload = sql.encode("utf-8")
print(f"Dump klaar: {len(payload) / 1024:.1f} kB SQL, {rijen} rijen.")
if len(payload) < 500:
    sys.exit("De dump is verdacht klein; er wordt niets weggeschreven.")

# 3. in R2 zetten ----------------------------------------------------------------
status, made = api("POST", "/r2/buckets", {"name": BUCKET})
if made.get("success"):
    print(f"Bucket '{BUCKET}' aangemaakt.")
elif status in (400, 409):
    pass  # bestaat al
else:
    print(f"::warning::Bucket '{BUCKET}' kon niet aangemaakt worden: {reasons(made)}")

today = datetime.date.today().isoformat()
for key in (f"besteltool/besteltool-{today}.sql", "besteltool/laatste.sql"):
    status, put = api("PUT", f"/r2/buckets/{BUCKET}/objects/{key}", raw=payload, content_type="application/sql")
    if put.get("success"):
        print(f"Bewaard als r2://{BUCKET}/{key}")
    else:
        message = reasons(put)
        if "authentication" in message.lower() or status in (401, 403):
            sys.exit("Het API-token heeft geen R2-rechten. Voeg 'R2: Edit' toe aan het token "
                     "(Cloudflare-dashboard → My Profile → API Tokens) en draai deze workflow opnieuw.")
        sys.exit(f"Wegschrijven naar R2 mislukt: {message}")
