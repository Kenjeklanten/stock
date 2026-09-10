# Besteltool — JE Concept

Telformulier voor de stock per locatie. Wat er staat wordt geteld — **volle pakken en losse stuks
apart** — de tool vergelijkt dat met de **basisstock** in het systeem en zet het verschil om in een
**bestelling**: een bestelbon in PDF en een CSV-bestand, per leverancier.

De tool bedient **meerdere bedrijven** (STVV, Bistro het Vinne, …). Elk bedrijf heeft zijn eigen
locaties, leveranciers en productenset; er wordt niets tussen bedrijven gedeeld. Bovenaan elk scherm
kies je met welk bedrijf je werkt.

Cloudflare Pages-applicatie (project `jeconcept-stock`) met een D1-database, achter Cloudflare
Access. Geen framework, geen dependencies in de runtime: statische HTML, vanilla JS-modules en
Pages Functions.

## De rekenregel

```
geteld        = volle pakken × inhoud van een pak + losse stuks
tekort        = basisstock − geteld                (nooit negatief)
te bestellen  = tekort, naar boven afgerond op een volledige verpakking
```

Voorbeeld: basisstock 48 flessen, bak van 24, geteld 1 pak + 6 los = 30 → tekort 18 → **1 bak (24)**.

* Een product waar je **niets** invult, komt niet op de bestelling (het telt niet als "0 in huis").
* Een verpakking van 1 betekent: hele stuks; dan toont het formulier één veld in plaats van twee.
* Basisstock, verpakking en productnaam worden **mee bewaard in de telling**. Pas je later de
  basisstock aan, dan blijft een oude bestelbon tonen wat er toen gold.

## Schermen

| Pagina | Waarvoor |
|---|---|
| `/` | Bedrijf en locatie kiezen, per product de volle pakken en losse stuks invullen. Toont meteen wat besteld wordt. Zoeken, groeperen per categorie of leverancier, "enkel niet-getelde tonen". Het ingevulde blijft lokaal bewaard (klad), dus een verbroken verbinding kost niets. |
| `/bestelling?id=…` | Het resultaat: bestelregels per leverancier, met knoppen voor de bestellijst in Excel (één telling of de hele dag), de bestelbon in PDF, CSV, het volledige telblad, en "markeer als besteld". |
| `/historiek` | Alle tellingen van het gekozen bedrijf; opnieuw downloaden of aanpassen kan altijd. |
| `/beheer` | Producten met basisstock per locatie, locaties, leveranciers, CSV-import/export, en de bedrijven zelf (naam, adres, BTW, voettekst — die komen op de bestelbon). |

## Producten inladen

Het snelst gaat het via **Beheer → Import / export**, per bedrijf. Kolommen (hoofdletters en accenten
maken niet uit):

```
Product;Artikelnummer;Eenheid;Verpakking;Verpakkingsnaam;Categorie;Leverancier;Bar tribune 1;Magazijn
Pils 25cl;P25;fles;24;bak van 24;Bier;Drankencentrale;48;144
Chips paprika;CP;zak;1;;Snacks;Groothandel;20;
```

* `Verpakking` is het aantal stuks in één volle verpakking — dat is ook de besteleenheid.
* Elke kolom **na** `Leverancier` is een locatie; de waarde is de basisstock van dat product daar.
* Een **lege cel** betekent: dit product hoort niet in die locatie en verschijnt daar niet op het telformulier.
* Onbekende locaties en leveranciers worden aangemaakt **binnen het gekozen bedrijf**.
* Eerst *Controleren* (toont wat er zou gebeuren), daarna pas *Importeren*.
* De export gebruikt exact dezelfde kolommen: exporteren → aanpassen in Excel → opnieuw importeren.

## De bestellijst in Excel

`GET /api/export/xlsx?company_id=…&date=JJJJ-MM-DD` (of `?count_id=…`) geeft de bestellijst in
dezelfde vorm als de lijst die vandaag met de hand wordt ingevuld:

* **één tabblad per leverancier** (tabbladnaam = naam van de leverancier);
* rij 1 `Bestelbon:` met de datum; rij 3 de **locaties als kolommen** met achteraan `Totaal`;
  rij 4 `Artikel`; daaronder per product het **te bestellen aantal per locatie**;
* per categorie een leeg rij en een nieuwe kopregel met de categorie in kolom A (zoals `PET` en
  `EXTRA` in de bestaande lijst);
* de kolom `Totaal` is een echte `=SUM(...)`-formule, dus je kan in Excel gerust bijsturen;
* een tabblad toont enkel de locaties waar producten van die leverancier geteld worden — een
  leverancier die alleen voor het hele huis levert, krijgt dus één kolom;
* bestandsnaam: `2026_09_09_Bestellijst_STVV.xlsx`.

De hele dag exporteren telt de tellingen van alle locaties van dat bedrijf samen in één werkboek.

## Vormgeving

`app/css/tokens.css` is het hele design-system: palet, rollen (`--surface-*`, `--text-*`,
`--action-*`, `--status-*`), typografie, ruimte, vorm, schaduwen en beweging. `app/css/app.css`
bevat enkel componenten en gebruikt uitsluitend die tokens — er staat geen enkele vaste kleur in.

De waarden die er nu in staan zijn **sober ingevuld in afwachting van de JE Concept-huisstijl**:
vervang het palet en de fonts in `tokens.css` (en zet eventuele eigen fontbestanden in
`app/assets/fonts/` met een `@font-face` bovenaan datzelfde bestand) en de hele tool volgt mee.

### Het logo in de kop

Zet het JE Concept-logo als **`app/logo.svg`** (`logo.png` of `logo.webp` mag ook) in de repository.
Bij het bouwen komt het dan automatisch in de kop van elk scherm, in plaats van de tekst
"Besteltool JE Concept"; er is verder niets aan te passen. Zolang het bestand er niet staat, blijft
de tekst staan — zo hangt er nooit een kapotte afbeelding in de kop. `build.py` zegt bij elke bouw
welk van de twee het geworden is.

Het logo wordt getoond op 40 pixels hoog (32 op een telefoon). Omdat het JE Concept-logo
donkerblauw is en de kopbalk dat ook, staat het op een licht plaatje; lever je ooit een
uitgespaarde (witte) versie, dan mag `.brand--logo { background: … }` in `app.css` weg. Een SVG
heeft de voorkeur boven een PNG: die blijft scherp op elk scherm en weegt bijna niets.

## Structuur

```
schema.sql             D1-schema (idempotent; draait bij elke deploy)
seed.sql               voorbeelddata om lokaal mee te spelen
build.py               app/ → dist/ met een inhoudshash op CSS en JS
app/
  css/tokens.css       het volledige design-system: kleuren, fonts, ruimte, vorm
  css/app.css          de componenten van de tool (gebruikt enkel tokens)
  js/                  vanilla modules per scherm + xlsx-read.js (xlsx inlezen in de browser)
functions/
  _middleware.js       Cloudflare Access-JWT controleren, beheerrechten bepalen
  _lib/                rekenregel, D1-queries, CSV, PDF-schrijver, XLSX-schrijver, bestellijst
  api/                 /api/session, /api/catalog, /api/counts…, /api/export/xlsx, /api/admin/…
scripts/dev-db.mjs     schema (en seed) op de lokale D1 zetten
test/                  node --test: API, bestelbon, bestellijst, import, scheiding tussen bedrijven
```

## Lokaal draaien

```bash
npm ci
npm run dev          # bouwt en start http://127.0.0.1:8788 met een lokale D1
# in een tweede terminal, één keer:
npm run seed         # schema + voorbeelddata   (npm run db = schema alleen)
npm test             # de testen
```

Lokaal staat er geen Access voor: de tool draait dan open en zegt dat ook in de kop.

## Deploy

`.github/workflows/deploy.yml` draait bij elke push naar `main` (en naar `claude/**`): testen →
bouwen → D1-database aanmaken indien nodig → schema toepassen → binding `DB` en de
Access-variabelen op het Pages-project zetten → publiceren naar Pages-project `jeconcept-stock`.

Zet in deze repository de **GitHub secrets**:

| Secret | Waarde |
|---|---|
| `CLOUDFLARE_API_TOKEN` | API-token met *Cloudflare Pages: Edit* **en** *D1: Edit* |
| `CLOUDFLARE_ACCOUNT_ID` | Account-ID uit het Cloudflare-dashboard |
| `ACCESS_TEAM_DOMAIN` | bv. `jeconcept.cloudflareaccess.com` (zie hieronder) |
| `ACCESS_AUD` | Application Audience-tag van de Access-applicatie |
| `ADMIN_EMAILS` | optioneel: wie mag beheren |

Staat de database nog in een oudere vorm (versie 1, van vóór de bedrijven), dan bouwt de deploy ze
opnieuw op — maar alleen als er nog geen producten of tellingen in staan. Zit er wel data in, dan
stopt de deploy met een melding in plaats van iets te wissen.

### Cloudflare Access instellen (eenmalig)

1. Cloudflare-dashboard → **Zero Trust** → *Access* → *Applications* → **Add an application** →
   *Self-hosted*.
2. Domein: `jeconcept-stock.pages.dev` (en later je eigen domein, bv. `stock.jeconcept.be`).
3. Policy: *Allow* → *Emails* met de adressen van wie mag tellen.
4. Noteer bij de applicatie de **Application Audience (AUD) tag** en je **team domain**
   (`<team>.cloudflareaccess.com`).
5. Zet die als GitHub secrets: `ACCESS_AUD`, `ACCESS_TEAM_DOMAIN` en optioneel `ADMIN_EMAILS`
   (komma-gescheiden; wie daar niet in staat mag tellen maar niet beheren — laat je het leeg, dan
   mag iedereen met toegang ook beheren). De volgende deploy zet ze op het Pages-project.

Zolang `ACCESS_TEAM_DOMAIN` niet gezet is, controleert de tool de Access-sessie niet zelf en toont
ze bovenaan een waarschuwing. Access aan de rand blijft dan de enige beveiliging.

### Eigen domein

Pages → project `jeconcept-stock` → *Custom domains* → bv. `stock.jeconcept.be`. Voeg dat domein
daarna ook toe aan de Access-applicatie.

## Variabelen op het Pages-project

| Variabele | Waarvoor |
|---|---|
| `DB` (D1-binding) | de database; wordt automatisch door de workflow gezet |
| `ACCESS_TEAM_DOMAIN` | bv. `jeconcept.cloudflareaccess.com` — leeg = geen eigen JWT-controle |
| `ACCESS_AUD` | Application Audience-tag van de Access-applicatie |
| `ADMIN_EMAILS` | wie het beheerscherm mag gebruiken; leeg = iedereen met toegang |

## Back-up

De database staat in D1. Een export van de catalogus haal je per bedrijf uit **Beheer →
Import / export**; tellingen en bestellingen download je per stuk als CSV of PDF. Een volledige
back-up maak je met `npx wrangler d1 export besteltool --remote --output=besteltool.sql`.
