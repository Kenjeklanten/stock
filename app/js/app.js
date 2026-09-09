// Gedeelde helpers voor alle schermen van de besteltool.

export async function api(path, options = {}, retry = true) {
  const res = await fetch(path, {
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json().catch(() => ({})) : {};
  // Zonder toegangscode antwoordt de server 401; dan vragen we ze en proberen we opnieuw.
  if (res.status === 401 && data.code === 'pin' && retry) {
    await askForCode();
    return api(path, options, false);
  }
  if (!res.ok) throw new Error(data.error || `Er ging iets mis (HTTP ${res.status}).`);
  return data;
}

/** Vraagt de toegangscode en lost pas op als ze klopt. */
export function askForCode() {
  const existing = qs('#code-gate');
  if (existing) return existing._wait;

  let done;
  const wait = new Promise((resolve) => { done = resolve; });
  const input = el('input', {
    type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: '8',
    id: 'code-input', 'aria-label': 'Toegangscode', placeholder: '••••',
  });
  const melding = el('p', { class: 'small', role: 'alert' });
  const knop = el('button', { class: 'btn', text: 'Openen' });

  const probeer = async () => {
    const code = input.value.trim();
    if (!code) return;
    knop.disabled = true;
    try {
      await api('/api/pin', { method: 'POST', body: { code } }, false);
      gate.remove();
      done();
    } catch (err) {
      melding.textContent = err.message;
      input.value = '';
      input.focus();
    } finally {
      knop.disabled = false;
    }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') probeer(); });
  knop.addEventListener('click', probeer);

  const gate = el('div', { id: 'code-gate', class: 'gate' }, [
    el('div', { class: 'gate__card' }, [
      el('h2', { text: 'Toegangscode' }),
      el('p', { class: 'small muted', text: 'Geef de cijfercode van de besteltool.' }),
      input, melding, knop,
    ]),
  ]);
  gate._wait = wait;
  document.body.append(gate);
  setTimeout(() => input.focus(), 50);
  return wait;
}

let toastTimer;
export function toast(message, isError = false) {
  let box = document.getElementById('toast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  box.textContent = message;
  box.classList.toggle('error', !!isError);
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), isError ? 6000 : 3000);
}

/** Getal tonen met Belgisch decimaalteken en zonder overbodige nullen. */
export const fmt = (n) => {
  const v = Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  if (!Number.isFinite(v)) return '';
  return Number.isInteger(v) ? String(v) : String(v).replace('.', ',');
};

/** "1 regel" / "3 regels" */
export const plural = (n, one, many) => `${n} ${Number(n) === 1 ? one : many}`;

export const num = (v, fallback = null) => {
  if (v === '' || v === null || v === undefined) return fallback;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
};

export const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const dateNl = (iso) => {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(iso || ''))) return String(iso || '');
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${Number(d)}/${Number(m)}/${y}`;
};

/** Elementen bouwen zonder innerHTML (geen HTML-injectie via productnamen). */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };
export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Kladversie van een telling lokaal bewaren, zodat een verbroken verbinding niets kost. */
export const draft = {
  key: (locationId, date) => `bestel:draft:${locationId}:${date}`,
  save(locationId, date, values) {
    try { localStorage.setItem(this.key(locationId, date), JSON.stringify({ at: Date.now(), values })); } catch { /* privémodus */ }
  },
  load(locationId, date) {
    try {
      const raw = localStorage.getItem(this.key(locationId, date));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
  clear(locationId, date) {
    try { localStorage.removeItem(this.key(locationId, date)); } catch { /* niets */ }
  },
};

export const params = () => new URLSearchParams(location.search);

/** Het gekozen bedrijf blijft per browser bewaard. */
export const company = {
  key: 'bestel:company',
  get() {
    try { return Number(localStorage.getItem(this.key)) || null; } catch { return null; }
  },
  set(id) {
    try { localStorage.setItem(this.key, String(id)); } catch { /* privémodus */ }
  },
};

/**
 * Navigatie markeren, tonen wie ingelogd is en de bedrijfskiezer vullen.
 * Geeft { user, companies, companyId } terug; companyId is null zolang er geen bedrijf bestaat.
 */
export async function mountHeader(active) {
  qsa('.topbar nav a').forEach((a) => {
    if (a.dataset.page === active) a.setAttribute('aria-current', 'page');
  });

  const result = { user: null, companies: [], companyId: null };
  const data = await api('/api/catalog');
  result.user = data.user;
  result.companies = data.companies || [];

  const who = qs('.who');
  if (who && data.user) {
    if (data.user.protected && data.user.email) who.textContent = `Aangemeld als ${data.user.email}${data.user.admin ? '' : ' · geen beheerrechten'}`;
    else if (!data.user.protected) who.textContent = 'Let op: deze omgeving staat niet achter Cloudflare Access.';
  }
  const select = qs('#company');
  const active_companies = result.companies.filter((c) => c.active);
  const chosen = active_companies.find((c) => c.id === company.get()) || active_companies[0] || null;
  result.companyId = chosen ? chosen.id : null;
  if (chosen) company.set(chosen.id);

  // Mag deze persoon het gekozen bedrijf beheren? Zo niet: de beheerlinks verdwijnen.
  const manageable = (data.user && data.user.manageable) || 'all';
  result.canManage = manageable === 'all' || (result.companyId !== null && manageable.includes(result.companyId));
  result.superAdmin = !data.user || data.user.super_admin !== false;
  if (!result.canManage) qsa('[data-admin-only]').forEach((n) => n.classList.add('hidden'));

  if (select) {
    clear(select);
    if (!active_companies.length) {
      select.append(el('option', { value: '', text: 'Nog geen bedrijf' }));
      select.disabled = true;
    } else {
      for (const c of active_companies) select.append(el('option', { value: String(c.id), text: c.name }));
      select.value = String(result.companyId);
      select.addEventListener('change', () => {
        company.set(select.value);
        location.href = location.pathname;   // ander bedrijf: scherm opnieuw opbouwen
      });
    }
  }
  return result;
}
