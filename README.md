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
| `/dashboard` | Overzicht van de dag: welke locaties geteld zijn, wat er vandaag te bestellen is per leverancier, en elke levering die nog nagekeken moet worden — ook als er nog niet op "markeer als besteld" geduwd is. |
| `/` | Bedrijf en locatie kiezen, per product de volle pakken en losse stuks invullen. Toont meteen wat besteld wordt. Werkt ook zonder verbinding. |
| `/bestelling?id=…` | Het resultaat: bestelregels per leverancier, met de bestellijst in Excel (één telling of de hele dag), de bestelbon in PDF, CSV en "markeer als besteld". |
| `/leveringen` | Alle bestellingen die nog nagekeken moeten worden, en de leveringen die al afgesloten zijn met hun afwijkingen. |
| `/ontvangst?id=…` | Levering inboeken: wat er effectief geleverd is, met het verschil tegenover de bestelling. |
| `/historiek` | Alle tellingen van het gekozen bedrijf; opnieuw downloaden of aanpassen kan altijd. |
| `/stock` | Wat er nu in huis is per toog, met de tijdlijn per product en het boeken van bewegingen die niet uit een telling of levering volgen. |
| `/verkoop` | Kassarapport inlezen, de kassanamen koppelen aan producten en togen, en het verschil tussen verbruik en verkoop bekijken. |
| `/beheer` | Producten met basisstock per locatie, locaties, leveranciers (met hun WhatsApp-nummer), redenen, het WhatsApp-bericht en logboek, de toegangscodes en de bedrijven. |

## Van bestelling naar levering

Een telling wordt een bestelling, en die bestelling wordt nagekeken als de bakken binnenkomen.

1. Tel op `/`. Wat onder de basisstock staat, komt op de bestelling.
2. Geef de bestelling door met de bestelbon (PDF) of de bestellijst (Excel) en zet ze op
   **Markeer als besteld**.
3. Als de leverancier gelost heeft, ga je naar **Leveringen** en kies je *Levering inboeken*.
   Per product vul je in wat er effectief binnenkwam, op dezelfde manier als bij het tellen:
   volle pakken + losse stuks. Naast elke regel staat meteen of het klopt met wat besteld was.
   Meestal klopt alles: met **Alles zoals besteld** vul je een hele leverancier in één klik in
   en pas je enkel de uitzonderingen aan. Wat je al ingevuld had, blijft staan.
4. **Levering afsluiten** zet de telling op *geleverd* en houdt bij wie wanneer nagekeken heeft.
   Regels die leeg blijven staan, blijven "nog niet nagekeken" en tellen niet mee als geleverde
   stock; de tool waarschuwt daarvoor bij het afsluiten.

De afwijkingen komen terug op de bestelling zelf, op het dashboard onder *Leveringen die niet
klopten*, en in de CSV van de telling. Wat effectief geleverd is, telt mee in de huidige stock —
niet wat besteld was.

## De bestelling doorgeven via WhatsApp

Verschillende leveranciers nemen hun bestelling via WhatsApp aan. De tool stelt dat bericht op uit
de berekende bestelling, per leverancier apart, en zet het klaar op de bestelpagina onder
**Doorgeven via WhatsApp**. Je kan het bericht daar nog aanpassen voor je het verstuurt.

Wat er waar staat:

* **Beheer → Leveranciers**: het WhatsApp-nummer, een schakelaar per leverancier, en een eigen
  bericht dat dat van het bedrijf overschrijft. Zonder nummer valt er niets te versturen, dus gaat
  de schakelaar dan mee uit. Nummers mag je intikken zoals je ze kent (`0479 21 64 33`); ze worden
  bewaard in de vorm die WhatsApp verwacht.
* **Beheer → Locaties**: een schakelaar per toog. Staat die uit, dan gaat er van die toog niets
  buiten, ook niet naar leveranciers waar WhatsApp wél aanstaat.
* **Beheer → WhatsApp**: het bericht dat voor het hele bedrijf geldt, en het logboek van wat er
  verstuurd is — met wie het verstuurd heeft en wat WhatsApp antwoordde.

In het bericht wordt tussen accolades ingevuld: `{bedrijf}`, `{leverancier}`, `{locatie}`,
`{datum}`, `{regels}`, `{aantal}` en `{totaal}`. `{regels}` is verplicht; zonder dat staat de
bestelling niet in het bericht en wordt het geweigerd.

### Twee wegen naar buiten

**Met de hand, werkt meteen.** De tool geeft een `wa.me`-link met het bericht er al in. Eén tik
opent WhatsApp, jij duwt op verzenden. Dit werkt met de gewone nummers waar nu al naartoe gestuurd
wordt, zonder token en zonder goedkeuring van Meta. Duw daarna op **Doorgegeven**, dan staat het in
het logboek.

**Automatisch, via de WhatsApp Cloud API.** Zet `WHATSAPP_TOKEN` en `WHATSAPP_PHONE_ID` en de knop
*Versturen* wordt actief; *Alles versturen* doet in één keer alle leveranciers van die bestelling.
Daar hangt wel een regel van Meta aan vast: een **vrij bericht mag enkel binnen 24 uur** nadat de
leverancier zelf iets gestuurd heeft. Daarbuiten weigert WhatsApp het (foutcode 131047) en zegt de
tool dat met zoveel woorden. Voor een bestelling die op elk moment moet kunnen vertrekken, laat je
bij Meta een **template** goedkeuren en zet je de naam in `WHATSAPP_TEMPLATE`. De bestelregels gaan
dan als één parameter mee, op één lijn met `·` ertussen, want een templateparameter mag geen
regeleindes bevatten.

Hiervoor is een WhatsApp Business-nummer nodig: een apart nummer in een Meta Business-account, niet
het gsm-nummer dat vandaag gebruikt wordt. Meta rekent per bericht af.

### Wat er gebeurt bij het versturen

Een leverancier die wordt overgeslagen, verdwijnt niet stil: op het scherm staat waarom (geen
nummer, schakelaar uit, locatie uit, of producten zonder leverancier). Lukt het versturen bij één
leverancier niet, dan gaan de andere gewoon door. Zodra er iets vertrokken is, gaat de telling op
*besteld* — een mislukte poging doet dat niet. Alles komt in het logboek, gelukt of niet.

## Stock die niet via een telling beweegt

Drank die naar het Rode Kruis of de bussen gaat, breuk, personeel, een verhuis tussen togen: die
boek je bij **Stock → "Drank uit de stock nemen of toevoegen"**, met een reden erbij. De redenen
zelf staan in Beheer → Redenen.

Wat er nu in huis zou moeten zijn, wordt daaruit afgeleid:

```
nu in huis = laatste telling
           + wat er bij die telling geleverd is
           + de bewegingen sinds die telling
           − de verkoop van op of na de dag van die telling
```

Elk van die vier staat apart in de tabel, en de **tijdlijn** per product toont elke telling,
levering, beweging en verkoopdag met de stand erna. Een telling zet de stand vast: vanaf dan begint
de rekening opnieuw.

## Toegang

Er zijn twee deuren.

**Een cijfercode**, voor wie aan de toog telt. Geen account nodig; de code bepaalt meteen wat
iemand mag (Beheer → Toegang):

| | rol `teller` | rol `beheerder` |
|---|---|---|
| **zonder bedrijf** | alle bedrijven zien en tellen | alles, ook bedrijven en codes beheren |
| **met een bedrijf** | dat bedrijf zien en tellen | dat bedrijf zien, tellen en beheren |

De browser onthoudt een ingevoerde code dertig dagen, via een ondertekende cookie die de code zelf
niet bevat. Er blijft altijd minstens één code met volledige toegang bestaan; sluit je jezelf toch
buiten, zet dan `APP_PIN` als variabele op het Pages-project.

**Een Google-account**, voor wie de tool beheert. Dat loopt via Cloudflare Access: wie aanmeldt met
een adres van `ADMIN_DOMAIN` (standaard `kenjeklanten.be`) krijgt standaard volledige toegang,
zonder code. De knop staat op het aanmeldscherm zodra `ACCESS_TEAM_DOMAIN` gezet is.

Wil je iemand beperken tot één bedrijf, zet zijn adres dan in **Beheer → Toegang → Beheerders met
een Google-account**. Wie daar staat, mag enkel wat er in zijn rij staat; wie er niet staat, mag
alles. Een adres weer uit die lijst halen geeft die persoon dus opnieuw toegang tot alles — het is
geen manier om iemand buiten te zetten. Dat doe je bij de Access-policy in Cloudflare.

### Cloudflare Access instellen (eenmalig)

Access staat voor **één enkel pad**: `/aanmelden`. Zo krijgt wie enkel telt nooit een
Google-aanmeldscherm te zien, terwijl een beheerder zich in één klik aanmeldt — de cookie die
Access daarna zet, geldt voor het hele domein, en de tool leest ze op elk scherm.

1. Cloudflare-dashboard → **Zero Trust** → *Settings* → *Authentication* → **Add new** → **Google**
   (of *Google Workspace*). Volg de stappen; je hebt daarvoor een OAuth-client in de Google Cloud
   Console nodig. Test de aanmeldmethode.
2. **Zero Trust** → *Access controls* → *Applications* → **Add an application** → *Self-hosted*.
   * Naam: `Besteltool beheer`
   * Domein: `stock.jeconcept.be`, **pad**: `aanmelden`
   * Identity provider: enkel **Google** aanvinken.
3. Policy: *Allow* → *Include* → **Emails ending in** → `@kenjeklanten.be`.
4. Noteer bij de applicatie de **Application Audience (AUD) tag**, en bij *Settings* je
   **team domain** (`<team>.cloudflareaccess.com`).
5. Zet die als GitHub secrets: `ACCESS_AUD`, `ACCESS_TEAM_DOMAIN` en desgewenst `ADMIN_DOMAIN`.
   De volgende deploy zet ze op het Pages-project.

Daarna staat er op `/login` een knop **Aanmelden met Google**. Afmelden gaat via de link bovenaan,
die naar `/cdn-cgi/access/logout` wijst.

Zolang `ACCESS_TEAM_DOMAIN` niet gezet is, blijft de knop verborgen en werkt alles op codes.

De variabelen komen op het Pages-project te staan bij de **eerstvolgende deploy**, niet op het
moment dat je ze als secret zet. Verschijnt de knop niet, kijk dan eerst of er sindsdien een
deploy gedraaid heeft.

Lokaal testen kan met een bestand `.dev.vars` naast `package.json` (staat in `.gitignore`):

```
ACCESS_TEAM_DOMAIN="jeconcept.cloudflareaccess.com"
ADMIN_DOMAIN="kenjeklanten.be"
```

Daarmee verschijnt de knop op `/login`; echt aanmelden lukt lokaal niet, want Access staat enkel
voor het adres op internet.

## De volgorde van lijsten

Locaties, leveranciers, producten en bedrijven staan in de volgorde waarin ze op het telformulier
en de bestelbon verschijnen. Die volgorde stel je in door de rijen te **verslepen** (of met de
pijltjes ernaast, voor op een tablet of met het toetsenbord). Er is geen volgordekolom meer.

## Producten inladen

De catalogus wordt rechtstreeks in de databank gezet, niet via een importscherm: `seed.sql` bevat de
producten, locaties, leveranciers en de basisstock per locatie van een bedrijf. Voor een nieuw
bedrijf komt daar een gelijkaardig bestand bij, dat eenmalig uitgevoerd wordt op de databank.

`seed-vinne.sql` is zo'n bestand: de volledige bestellijst van Bistro het Vinne — 12 leveranciers en
142 producten, in de volgorde van de tabbladen van hun lijst. De dranken horen bij de Bar, de keuken-,
droge-waren- en diepvriesartikelen bij de Keuken; verhuizen kan gewoon in Beheer. De basisstock komt
uit de kolom *Minimum stock/week*. De dranken hebben die kolom niet en staan dus op 0: ze worden wel
geteld, maar er wordt niets van besteld tot er een basisstock ingevuld is.

## De bestellijst in Excel

`GET /api/export/xlsx?company_id=…&date=JJJJ-MM-DD` (of `?count_id=…`) geeft de bestellijst in
dezelfde vorm als de lijst die vandaag met de hand wordt ingevuld:

* **één tabblad per leverancier** (tabbladnaam = naam van de leverancier);
* rij 1 `Bestelbon:` met de datum; rij 3 de **locaties als kolommen** met achteraan `Totaal`;
  rij 4 `Artikel`; daaronder per product het **te bestellen aantal per locatie**;
* de kolom `Totaal` is een echte `=SUM(...)`-formule, dus je kan in Excel gerust bijsturen;
* een tabblad toont enkel de locaties waar producten van die leverancier geteld worden — een
  leverancier die alleen voor het hele huis levert, krijgt dus één kolom;
* bestandsnaam: `2026_09_09_Bestellijst_STVV.xlsx`.

De hele dag exporteren telt de tellingen van alle locaties van dat bedrijf samen in één werkboek.

## Vormgeving

De tool draait op het **designsysteem JE Concept** (claude.ai/design). Drie bestanden:

| Bestand | Wat |
|---|---|
| `app/css/tokens.css` | de tokens van het systeem — kleuren, typografie, ruimte, vorm, elevatie, beweging — plus onderaan een brug naar de rolnamen die `app.css` gebruikt |
| `app/css/components.css` | `tokens/components.css` van het systeem, **onveranderd**. Niet met de hand aanpassen |
| `app/css/app.css` | de onderdelen van deze tool, uitsluitend in die tokens uitgedrukt |

Er staat geen enkele vaste kleur, maat of vorm in `app.css`. Verandert het systeem, dan vervang je
`tokens.css` en `components.css` en volgt de hele tool mee.

### Waar de tool afwijkt, en waarom

Het systeem is gemaakt voor vier oppervlakken: website, voorstel, klantenportaal en social. Deze
tool is een werkscherm waarop aan de toog geteld wordt. Het **klantenportaal** is daarom de
maatstaf, niet de website: paneelkoppen als eyebrow (12 px caps) in plaats van een kop van 22 px,
24 px vulling in plaats van 32, rijtekst op 14 px, en rijen gescheiden door een haarlijn in plaats
van elk in hun eigen kaart. Een productnaam staat niet in kapitalen — "24x33cl" moet leesbaar
blijven.

Twee dingen uit het systeem kunnen hier niet, allebei door de CSP (`script-src 'self'`,
`style-src 'self'`), en die blijft zoals ze is:

* **Fonts.** Het systeem laadt Oswald, Source Sans 3, Parisienne en Prata bij Google Fonts. Die
  staan hier lokaal in `app/fonts/` — de originele woff2-bestanden van Google, per subset apart,
  zodat een browser enkel ophaalt wat een scherm echt gebruikt. Oswald en Source Sans (latin) zitten
  in de offline-voorraad; de rest komt vanzelf. Komen er ooit gelicentieerde merkfonts, dan hoeven
  enkel die bestanden en de `@font-face`-regels bovenaan `tokens.css` te wijzigen.
* **Iconen.** Het systeem gebruikt Lucide via een CDN. Dat kan niet, en natekenen mag niet van het
  systeem zelf. De tool gebruikt vandaag geen iconen; komen ze er, dan worden de echte
  Lucide-bestanden lokaal meegeleverd.

### Het logo in de kop

`app/logo.png` is het merkteken uit het designsysteem. Bij het bouwen komt het automatisch in de kop
van elk scherm in plaats van het woordmerk. In de kopbalk staat het **uitgespaard in wit**
(`filter: brightness(0) invert(1)`) — dat is de enige behandeling die het systeem toestaat. Op het
aanmeldscherm staat het in kleur op de witte kaart.

Het bestand is een PNG van 375 px, afgeleid van een JPEG; bij grote formaten zijn de randen zacht.
Een **SVG** zou dat oplossen: zet die als `app/logo.svg` en `build.py` pikt hem vanzelf op.

### De night-scope

`.je-night` zet een heel vlak om naar donkere navy. Het aanmeldscherm gebruikt die scope; de
kopbalk is vast donker. Meer donkere vlakken heeft de tool niet, en het systeem kent geen
automatische donkere modus.

## Structuur

```
schema.sql             D1-schema (idempotent; draait bij elke deploy)
seed.sql               voorbeelddata om lokaal mee te spelen
seed-vinne.sql         de catalogus van Bistro het Vinne (eenmalig op de databank)
build.py               app/ → dist/ met een inhoudshash op CSS en JS
app/
  css/tokens.css       de tokens van het designsysteem + de brug naar app.css
  css/components.css   components.css van het designsysteem, onveranderd
  fonts/               Oswald, Source Sans 3, Parisienne, Prata (lokaal, per subset)
  logo.png             het merkteken; build.py zet het in de kop
  css/app.css          de componenten van de tool (gebruikt enkel tokens)
  js/                  vanilla modules per scherm + xlsx-read.js (kassabestand inlezen)
  sw.js                service worker: de tool blijft werken zonder bereik
functions/
  _middleware.js       toegangscode controleren, en de Cloudflare Access-JWT van een beheerder
  aanmelden.js         het pad waar Access voor staat; stuurt na aanmelden door
  _lib/                rekenregel, D1-queries, CSV, PDF-schrijver, XLSX-schrijver, bestellijst, verkoop
  api/                 /api/catalog, /api/counts…, /api/sales…, /api/export/xlsx, /api/admin/…
scripts/dev-db.mjs     schema (en seed) op de lokale D1 zetten
scripts/icons.py       de app-iconen tekenen
test/                  node --test: rekenregel, API, bestelbon, bestellijst, rechten, verkoop
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
| `ACCESS_TEAM_DOMAIN` | bv. `jeconcept.cloudflareaccess.com` — zet de Google-aanmelding aan |
| `ACCESS_AUD` | Application Audience-tag van de Access-applicatie op `/aanmelden` |
| `ADMIN_DOMAIN` | optioneel: het domein dat volledige toegang krijgt (standaard `kenjeklanten.be`) |
| `APP_PIN` | optioneel: een noodcode met volledige toegang |
| `WHATSAPP_TOKEN` | optioneel: permanent token van de WhatsApp Cloud API — zet automatisch versturen aan |
| `WHATSAPP_PHONE_ID` | optioneel: het Phone Number ID van het WhatsApp Business-nummer |
| `WHATSAPP_TEMPLATE` | optioneel: naam van een goedgekeurde template, nodig buiten het venster van 24 uur |
| `WHATSAPP_TAAL` | optioneel: taalcode van die template (standaard `nl`) |

Staat de database nog in een oudere vorm (versie 1, van vóór de bedrijven), dan bouwt de deploy ze
opnieuw op — maar alleen als er nog geen producten of tellingen in staan. Zit er wel data in, dan
stopt de deploy met een melding in plaats van iets te wissen.

### Cloudflare Access

Zie **Toegang** hierboven: Access staat enkel voor `/aanmelden` en dient om beheerders met een
Google-account binnen te laten. De rest van de tool werkt op cijfercodes.

### Eigen domein

Pages → project `jeconcept-stock` → *Custom domains* → bv. `stock.jeconcept.be`. Gebruik datzelfde
domein in de Access-applicatie op `/aanmelden`.

## Variabelen op het Pages-project

| Variabele | Waarvoor |
|---|---|
| `DB` (D1-binding) | de database; wordt automatisch door de workflow gezet |
| `ACCESS_TEAM_DOMAIN` | bv. `jeconcept.cloudflareaccess.com` — leeg = geen Google-aanmelding |
| `ACCESS_AUD` | Application Audience-tag van de Access-applicatie op `/aanmelden` |
| `ADMIN_DOMAIN` | het domein dat volledige toegang krijgt, standaard `kenjeklanten.be` |
| `APP_PIN` | noodcode met volledige toegang, voor als je jezelf buitensluit |

## Back-up

Elke maandagochtend zet `.github/workflows/backup.yml` een volledige kopie van de databank in een
R2-bucket: één bestand per week plus `laatste.sql`. Het API-token heeft daarvoor `R2: Edit` nodig
naast de rechten voor Pages en D1. Draaien kan ook met de hand, via *Run workflow* op het tabblad
Actions.

De dump wordt opgebouwd met gewone queries (`.github/scripts/d1dump.py`): schema uit
`sqlite_master`, rijen per tabel, en de tellers van `AUTOINCREMENT` erbij zodat een teruggezette
databank geen id's hergebruikt. De export-API van D1 wordt bewust niet gebruikt: die werkt met
pollen op een bookmark en antwoordt "Not currently exporting anything" zodra de export klaar is
vóór de eerste poll — waar de back-up eerder op vastliep.

Vóór elke back-up draait `.github/scripts/d1dump_test.py`: die bouwt een databank uit `schema.sql`,
dumpt ze, zet de dump terug in een lege databank en vergelijkt rijen, indexen en id-tellers. Loopt
dat mis, dan wordt er geen back-up weggeschreven. Je kan het zelf draaien:

```bash
python3 .github/scripts/d1dump_test.py
```

Terugzetten doe je met het bestand uit de bucket:

```bash
npx wrangler d1 execute besteltool --remote --file=laatste.sql
```

Met de hand een kopie maken kan ook:

```bash
npx wrangler d1 export besteltool --remote --output=besteltool.sql   # back-up
npx wrangler d1 execute besteltool --remote --file=besteltool.sql    # terugzetten
```

Tellingen en bestellingen download je daarnaast per stuk als CSV, PDF of Excel.
