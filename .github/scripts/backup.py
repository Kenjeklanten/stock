#!/usr/bin/env python3
"""Zet een volledige export van de D1-database in een R2-bucket.

Draait wekelijks vanuit .github/workflows/backup.yml (en met de hand via workflow_dispatch).
Er komen twee bestanden in de bucket:

    besteltool/besteltool-JJJJ-MM-DD.sql   de back-up van die dag
    besteltool/laatste.sql                 altijd de meest recente

Omgeving: CF_TOKEN, CF_ACCOUNT, D1_NAME, R2_BUCKET.
Het token heeft hiervoor D1:Read (of Edit) én R2:Edit nodig. Ontbreekt R2, dan stopt het
script met een duidelijke melding in plaats van met een stacktrace.
"""
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.request

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

# 2. export vragen en afwachten --------------------------------------------------
status, started = api("POST", f"/d1/database/{uuid}/export", {"output_format": "polling"})
if not started.get("success"):
    sys.exit(f"Export starten mislukt: {reasons(started)}")

result = started.get("result") or {}
bookmark = result.get("at_bookmark")
signed = result.get("signed_url")
waited = 0
while not signed and waited < 300:
    time.sleep(3)
    waited += 3
    status, polled = api("POST", f"/d1/database/{uuid}/export",
                         {"output_format": "polling", "current_bookmark": bookmark})
    if not polled.get("success"):
        sys.exit(f"Export opvolgen mislukt: {reasons(polled)}")
    result = polled.get("result") or {}
    bookmark = result.get("at_bookmark", bookmark)
    signed = result.get("signed_url")
    if result.get("error"):
        sys.exit(f"Export mislukt: {result['error']}")
if not signed:
    sys.exit("De export was na vijf minuten nog niet klaar.")

with urllib.request.urlopen(signed) as res:
    dump = res.read()
print(f"Export klaar: {len(dump) / 1024:.1f} kB SQL.")

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
    status, put = api("PUT", f"/r2/buckets/{BUCKET}/objects/{key}", raw=dump, content_type="application/sql")
    if put.get("success"):
        print(f"Bewaard als r2://{BUCKET}/{key}")
    else:
        message = reasons(put)
        if "authentication" in message.lower() or status in (401, 403):
            sys.exit("Het API-token heeft geen R2-rechten. Voeg 'R2: Edit' toe aan het token "
                     "(Cloudflare-dashboard → My Profile → API Tokens) en draai deze workflow opnieuw.")
        sys.exit(f"Wegschrijven naar R2 mislukt: {message}")
