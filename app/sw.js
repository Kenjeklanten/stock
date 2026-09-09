/**
 * Service worker: de tool blijft werken waar het bereik wegvalt.
 *
 * Aan de toog en in de kelders van Stayen is er niet altijd netwerk. Daarom:
 *   - de schermen zelf (HTML, CSS, JS) komen uit de cache zodra ze één keer geladen zijn;
 *   - de productenlijst van een locatie (GET /api/catalog) wordt bewaard, zodat je ook zonder
 *     verbinding kan tellen;
 *   - al de rest van /api/ gaat altijd naar de server: bewaren zonder verbinding lukt niet,
 *     en dat handelt het telformulier zelf af (het zet de telling in de wachtrij).
 *
 * De versie hieronder wordt bij het bouwen ingevuld (build.py). Bij elke nieuwe versie komt er
 * een nieuwe cache en verdwijnt de oude, zodat niemand op een oud scherm blijft hangen.
 */
const VERSION = '__VERSION__';
const CACHE = `besteltool-${VERSION}`;
const SHELL = __ASSETS__;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Eén ontbrekend bestand mag de installatie niet tegenhouden.
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

/** Bij het wisselen van toegangscode wordt alles wat bewaard is, gewist. */
self.addEventListener('message', (event) => {
  if (event.data === 'wis-cache') event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
});

const cacheFirst = async (request) => (await caches.match(request)) || fetch(request);

async function networkFirst(request, { bewaar = true } = {}) {
  try {
    const response = await fetch(request);
    if (bewaar && response.ok) (await caches.open(CACHE)).put(request, response.clone());
    return response;
  } catch (err) {
    const hit = await caches.match(request);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    // enkel de catalogus is zinvol om te bewaren; de rest heeft verse gegevens nodig
    if (url.pathname === '/api/catalog') event.respondWith(networkFirst(request));
    return;
  }
  if (url.pathname.startsWith('/css/') || url.pathname.startsWith('/js/') || url.pathname.startsWith('/icon-')) {
    return event.respondWith(cacheFirst(request));
  }
  if (request.mode === 'navigate') {
    return event.respondWith(networkFirst(request).catch(async () =>
      (await caches.match(request, { ignoreSearch: true })) || (await caches.match('/')) ||
      new Response('<!doctype html><meta charset="utf-8"><title>Geen verbinding</title>'
        + '<p style="font:16px system-ui;padding:2rem">Geen verbinding, en dit scherm is nog niet bewaard op dit toestel.</p>',
        { headers: { 'content-type': 'text/html; charset=utf-8' } })));
  }
  event.respondWith(networkFirst(request));
});
