#!/usr/bin/env python3
"""Eenmalige opruiming: het oude Pages-project `jeconcept-bestel` verwijderen.

Dat project werd vanuit de Feestbeest-repository aangemaakt toen de besteltool daar nog in
zat. Het staat niet achter Cloudflare Access en hangt aan dezelfde D1-database, dus het moet
weg. De D1-database zelf blijft bestaan: die is van dit project.

Doet niets als het project er niet (meer) is. Deze stap mag uit de workflow zodra ze één keer
gedraaid heeft.
"""
import json
import os
import sys
import urllib.error
import urllib.request

TOKEN = os.environ.get("CF_TOKEN", "").strip()
ACCOUNT = os.environ.get("CF_ACCOUNT", "").strip()
OLD_PROJECT = "jeconcept-bestel"
API = "https://api.cloudflare.com/client/v4"

if not TOKEN or not ACCOUNT:
    sys.exit("CLOUDFLARE_API_TOKEN en CLOUDFLARE_ACCOUNT_ID ontbreken.")


def api(method, path):
    req = urllib.request.Request(
        f"{API}/accounts/{ACCOUNT}/pages/projects/{path}",
        method=method,
        headers={"Authorization": f"Bearer {TOKEN}", "User-Agent": "jeconcept-besteltool-cleanup"},
    )
    try:
        with urllib.request.urlopen(req) as res:
            return res.status, json.load(res)
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", "replace")
        try:
            return err.code, json.loads(body)
        except json.JSONDecodeError:
            return err.code, {"errors": [{"message": body[:300]}]}


status, result = api("GET", OLD_PROJECT)
if status == 404:
    print(f"Project '{OLD_PROJECT}' bestaat niet (meer) — niets te doen.")
    sys.exit(0)
if not result.get("success"):
    print(f"::warning::Kon '{OLD_PROJECT}' niet opvragen: {result.get('errors')}")
    sys.exit(0)

domains = (result.get("result") or {}).get("domains") or []
status, deleted = api("DELETE", OLD_PROJECT)
if deleted.get("success"):
    print(f"Project '{OLD_PROJECT}' verwijderd (domeinen: {', '.join(domains) or 'geen'}). "
          "Alle deployments en preview-adressen ervan zijn weg; de D1-database blijft.")
else:
    print(f"::warning::Verwijderen van '{OLD_PROJECT}' mislukt: {deleted.get('errors')}")
