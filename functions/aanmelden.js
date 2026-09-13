/**
 * /aanmelden — het enige pad waar Cloudflare Access voor staat.
 *
 * Wie hierheen gaat, krijgt van Access het aanmeldscherm van Google. Komt hij terug met een
 * geldige sessie van het beheerdersdomein, dan heeft de middleware dat al vastgesteld en hoeft
 * hier enkel nog de omleiding te gebeuren naar waar hij heen wilde.
 *
 * Staat Access nog niet aan, of laat het iemand van een ander domein door, dan gaat hij terug
 * naar het gewone aanmeldscherm met een woordje uitleg.
 */
const veiligPad = (pad) => (typeof pad === 'string' && pad.startsWith('/') && !pad.startsWith('//') ? pad : '/dashboard');

export async function onRequestGet({ request, data }) {
  const url = new URL(request.url);
  const next = veiligPad(url.searchParams.get('next'));

  if (data.user && data.user.admin_login) {
    return new Response(null, { status: 302, headers: { location: next, 'cache-control': 'no-store' } });
  }

  const reden = data.user && data.user.admin_login_available
    ? `aanmelden-mislukt&domein=${encodeURIComponent((data.user && data.user.admin_domain) || '')}`
    : 'aanmelden-uit';
  return new Response(null, {
    status: 302,
    headers: { location: `/login?next=${encodeURIComponent(next)}&fout=${reden}`, 'cache-control': 'no-store' },
  });
}
