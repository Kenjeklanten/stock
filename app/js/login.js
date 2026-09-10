// Het aanmeldscherm: één cijfercode, meer niet.
//
// Achter de vakjes zit één echt invoerveld. Dat houdt plakken, de cijfertoetsen van een telefoon
// en het automatisch invullen van een wachtwoordbeheerder heel; de vakjes zijn enkel de weergave.
const qs = (sel) => document.querySelector(sel);

const invoer = qs('#code');
const vakken = qs('#code-boxes');
const melding = qs('#code-error');
const knop = qs('#code-submit');

const VAKJES = 4;   // de meeste codes zijn vier cijfers; langer laat het veld gewoon groeien

function teken() {
  const cijfers = invoer.value.split('');
  const aantal = Math.max(VAKJES, cijfers.length);
  const bestaande = [...vakken.querySelectorAll('.code__box')];

  for (let i = bestaande.length; i < aantal; i++) {
    const vak = document.createElement('span');
    vak.className = 'code__box';
    vakken.append(vak);
  }
  for (let i = aantal; i < bestaande.length; i++) bestaande[i].remove();

  [...vakken.querySelectorAll('.code__box')].forEach((vak, i) => {
    vak.textContent = cijfers[i] || '';
    vak.classList.toggle('code__box--vol', !!cijfers[i]);
    vak.classList.toggle('code__box--nu', i === cijfers.length && document.activeElement === invoer);
  });
  knop.disabled = cijfers.length < 4;
}

invoer.addEventListener('input', () => {
  const opgekuist = invoer.value.replace(/\D/g, '').slice(0, 8);
  if (opgekuist !== invoer.value) invoer.value = opgekuist;
  melding.textContent = '';
  teken();
});
invoer.addEventListener('focus', teken);
invoer.addEventListener('blur', teken);
vakken.addEventListener('click', () => invoer.focus());

/** Waar de gebruiker naartoe wilde voor hij hier belandde. */
function volgende() {
  const gevraagd = new URLSearchParams(location.search).get('next') || '/';
  // enkel binnen deze site, zodat een link van buitenaf niemand kan omleiden
  return gevraagd.startsWith('/') && !gevraagd.startsWith('//') ? gevraagd : '/';
}

async function probeer(event) {
  if (event) event.preventDefault();
  const code = invoer.value.trim();
  if (code.length < 4) return;

  knop.disabled = true;
  knop.textContent = 'Even kijken…';
  try {
    const res = await fetch('/api/pin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Er ging iets mis (HTTP ${res.status}).`);
    document.body.classList.add('login--ok');
    location.href = volgende();
  } catch (err) {
    melding.textContent = err.message;
    invoer.value = '';
    invoer.focus();
    teken();
    vakken.classList.remove('code--fout');
    void vakken.offsetWidth;          // de animatie opnieuw laten starten
    vakken.classList.add('code--fout');
  } finally {
    knop.textContent = 'Openen';
    teken();
  }
}

qs('#code-form').addEventListener('submit', probeer);

// Is er helemaal geen code ingesteld, dan valt er hier niets te doen.
fetch('/api/pin')
  .then((r) => r.json())
  .then((d) => { if (d && (d.required === false || d.unlocked === true)) location.href = volgende(); })
  .catch(() => { /* geen verbinding: het scherm blijft gewoon staan */ });

teken();
invoer.focus();
