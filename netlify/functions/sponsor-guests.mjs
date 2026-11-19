// The private page a sponsor uses to tell us who is sitting in their seats:
//   wearecalledtocare.com/sponsor-guests?t=<private code>
//   GET  -> a short form with one box per seat, filled in with any names already saved
//   POST -> saves the names (they can come back and change them) and lets staff know
import { db, esc, alertStaff, sponsorLevel, SITE_URL, env } from './_lib.mjs';
import { nameList } from './_sponsor.mjs';
import { letterValues } from './_letter.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const page = (title, body, status = 200) => new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${title} · We Are Called to Care</title>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Figtree:wght@400;600;700&display=swap" rel="stylesheet">
<style>body{margin:0;background:#E6EFF4;font-family:Figtree,'Helvetica Neue',Arial,sans-serif;color:#2B3440;min-height:100vh;display:grid;place-items:center}
main{background:#fff;border-radius:22px;width:min(560px,calc(100% - 32px));margin:24px 16px;overflow:hidden}
header{background:#1D4766;padding:26px 24px 22px}header img{width:210px;height:auto;display:block;margin:0 auto}
section{padding:32px 32px 36px}.eyebrow{font-size:.76rem;letter-spacing:.16em;text-transform:uppercase;color:#E2197A;font-weight:700;margin:0 0 8px}
h1{font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:2.3rem;line-height:1.08;color:#1D4766;margin:0 0 12px}h1 i{color:#E2197A}
p{font-size:1rem;line-height:1.6;margin:0 0 16px}.note{font-size:.9rem;color:#5E6B78}
ol{list-style:none;margin:0 0 20px;padding:0;display:grid;gap:10px}li{display:grid;grid-template-columns:2.2rem 1fr;align-items:center}
li span{font-family:'Instrument Serif',Georgia,serif;font-size:1.5rem;color:#1E5F82}label.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
input{font:inherit;border:1.5px solid #D5E2EA;border-radius:10px;padding:12px 14px;width:100%;box-sizing:border-box}input:focus-visible{outline:3px solid #B5CFDC;border-color:#1E5F82}
button{font:inherit;font-weight:700;border:0;border-radius:999px;padding:15px 30px;background:#E2197A;color:#fff;cursor:pointer}button:focus-visible,a:focus-visible{outline:3px solid #1E5F82;outline-offset:3px}
.ok{background:#E6EFF4;border-radius:12px;padding:12px 16px;margin:0 0 18px;font-weight:600;color:#1D4766}a{color:#1E5F82}ul{margin:0 0 18px;padding-left:20px;line-height:1.7}</style></head>
<body><main><header><img src="${SITE_URL()}/assets/logo-white.png" alt="We Are Called to Care" width="778" height="189"></header><section>${body}</section></main></body></html>`,
  { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
const reply = () => env('EMAIL_REPLY_TO', 'shari@wearecalledtocare.com');
const notFound = () => page('Link not found', `<h1>This link didn't work.</h1><p>The link may be incomplete. Reply to the email we sent you, or write to <a href="mailto:${esc(reply())}">${esc(reply())}</a>, and we'll take care of your guest list.</p>`, 404);

export default async (req) => {
  const u = new URL(req.url); const t = u.searchParams.get('t') || '';
  if (!UUID.test(t)) return notFound();
  let sp; try { [sp] = await db(`sponsorships?guest_token=eq.${t}&select=*`); } catch { sp = null; }
  if (!sp) return notFound();
  const lv = sponsorLevel(sp.level); const seats = lv ? lv.seats : 0;
  if (!seats) return page('Your sponsorship', `<h1>Thank you for sponsoring.</h1><p>Your ${esc(sp.level)} sponsorship does not include reserved dinner seats, so there is no guest list to fill in. Questions? Write to <a href="mailto:${esc(reply())}">${esc(reply())}</a>.</p>`);
  let names = nameList(sp.guest_names); let saved = false;
  if (req.method === 'POST') {
    const form = new URLSearchParams(await req.text().catch(() => ''));
    names = nameList(form.getAll('guest').join('\n')).slice(0, seats);
    const was = nameList(sp.guest_names).join('\n');
    await db(`sponsorships?id=eq.${sp.id}`, { method: 'PATCH', body: { guest_names: names.join('\n'), guests_at: new Date().toISOString() } });
    saved = true;
    if (names.join('\n') !== was) await alertStaff(`Guest names from ${sp.sponsor_name || 'a sponsor'}: ${names.length} of ${seats}`,
      [`${esc(sp.sponsor_name || 'A sponsor')} (${esc(String(sp.year))} ${esc(sp.level)}) ${was ? 'updated' : 'sent'} their dinner guests:`, names.length ? names.map(esc).join('<br>') : '<i>No names yet</i>'], `${SITE_URL()}/admin/?dashboard=1#sponsors`).catch(() => {});
  }
  const v = await letterValues().catch(() => ({})); const left = seats - names.length;
  const boxes = Array.from({ length: seats }, (_, i) => `<li><span aria-hidden="true">${i + 1}</span><div><label class="sr" for="g${i}">Guest ${i + 1}</label><input id="g${i}" name="guest" value="${esc(names[i] || '')}" placeholder="First and last name" autocomplete="off" maxlength="80"></div></li>`).join('');
  return page('Your dinner guests', `<p class="eyebrow">${esc(String(sp.year))} Charity Dinner &amp; Auction</p><h1>Who is joining <i>you?</i></h1>
${saved ? `<p class="ok" role="status">Saved. ${left > 0 ? `You have ${left} more ${left === 1 ? 'seat' : 'seats'} to fill whenever you're ready.` : 'Your guest list is complete. Thank you!'}</p>` : ''}
<p>${esc(sp.sponsor_name || 'Your sponsorship')}: your <b>${esc(lv.name)}</b> sponsorship includes <b>${esc(lv.seating)}</b>${v.dinner_date ? ` on ${esc(v.dinner_date)}` : ''}. Count yourself if you're coming.</p>
<form method="post" action="/sponsor-guests?t=${t}"><ol>${boxes}</ol><button type="submit">${names.length ? 'Save Changes' : 'Save Guest Names'}</button></form>
<p class="note" style="margin:18px 0 0">Don't know everyone yet? Save the names you have and come back to this same link anytime.</p>`);
};
