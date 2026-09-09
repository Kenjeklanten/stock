#!/usr/bin/env python3
"""Hangt het eigen domein aan het Pages-project en zet het DNS-record.

Beide stappen zijn idempotent: bestaat het domein of het record al, dan gebeurt er niets.
Heeft het API-token geen rechten op de DNS-zone, dan stopt het script niet met een fout maar
zegt het welk record je met de hand moet zetten.

Omgeving:
  CF_TOKEN, CF_ACCOUNT   zoals bij de andere stappen
  PROJECT                naam van het Pages-project
  CUSTOM_DOMAIN          bv. stock.jeconcept.be (leeg = niets doen)
"""
import json
import os
import sys
import urllib.error
import urllib.request

TOKEN = os.environ.get("CF_TOKEN", "").strip()
ACCOUNT = os.environ.get("CF_ACCOUNT", "").strip()
PROJECT = os.environ.get("PROJECT", "jeconcept-stock")
DOMAIN = os.environ.get("CUSTOM_DOMAIN", "").strip().lower()
API = "https://api.cloudflare.com/client/v4"

if not DOMAIN:
    print("Geen CUSTOM_DOMAIN ingesteld — overgeslagen.")
    sys.exit(0)
if not TOKEN or not ACCOUNT:
    sys.exit("CLOUDFLARE_API_TOKEN en CLOUDFLARE_ACCOUNT_ID ontbreken.")


def call(method, url, payload=None):
    req = urllib.request.Request(
        url,
        method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "jeconcept-besteltool-domain",
        },
    )
    try:
        with urllib.request.urlopen(req) as res:
            return res.status, json.load(res)
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", "replace")
        try:
            return err.code, json.loads(body)
        except json.JSONDecodeError:
            return err.code, {"success": False, "errors": [{"message": f"HTTP {err.code}: {body[:200]}"}]}


def reasons(result):
    return "; ".join(e.get("message", "?") for e in (result.get("errors") or []))


target = f"{PROJECT}.pages.dev"

# 1. het domein aan het Pages-project hangen ------------------------------------
status, existing = call("GET", f"{API}/accounts/{ACCOUNT}/pages/projects/{PROJECT}/domains")
known = [d.get("name") for d in (existing.get("result") or [])] if existing.get("success") else []
if DOMAIN in known:
    print(f"'{DOMAIN}' hangt al aan het project.")
else:
    status, added = call("POST", f"{API}/accounts/{ACCOUNT}/pages/projects/{PROJECT}/domains", {"name": DOMAIN})
    if added.get("success"):
        print(f"'{DOMAIN}' toegevoegd aan het Pages-project.")
    else:
        print(f"::warning::Kon '{DOMAIN}' niet aan het project hangen: {reasons(added)}")

# 2. het DNS-record zetten -------------------------------------------------------
zone_name = ".".join(DOMAIN.split(".")[-2:])
host = DOMAIN[: -len(zone_name) - 1] or "@"

status, zones = call("GET", f"{API}/zones?name={zone_name}")
if not zones.get("success") or not zones.get("result"):
    print(f"::warning::Zone '{zone_name}' niet gevonden met dit token ({reasons(zones) or 'geen zones teruggekregen'}). "
          f"Zet zelf een CNAME '{host}' → {target} (proxied) in de DNS van {zone_name}.")
    sys.exit(0)

zone_id = zones["result"][0]["id"]
status, records = call("GET", f"{API}/zones/{zone_id}/dns_records?name={DOMAIN}")
record = (records.get("result") or [None])[0] if records.get("success") else None
payload = {"type": "CNAME", "name": DOMAIN, "content": target, "proxied": True, "ttl": 1,
           "comment": "Besteltool JE Concept (Cloudflare Pages)"}

if record and record.get("content") == target and record.get("type") == "CNAME":
    print(f"DNS-record voor {DOMAIN} stond al goed ({target}).")
elif record:
    status, updated = call("PUT", f"{API}/zones/{zone_id}/dns_records/{record['id']}", payload)
    print(f"DNS-record voor {DOMAIN} bijgewerkt naar {target}." if updated.get("success")
          else f"::warning::Bijwerken van het DNS-record mislukt: {reasons(updated)}")
else:
    status, created = call("POST", f"{API}/zones/{zone_id}/dns_records", payload)
    print(f"DNS-record CNAME {DOMAIN} → {target} aangemaakt." if created.get("success")
          else f"::warning::Aanmaken van het DNS-record mislukt ({reasons(created)}). "
               f"Zet zelf een CNAME '{host}' → {target} (proxied).")
