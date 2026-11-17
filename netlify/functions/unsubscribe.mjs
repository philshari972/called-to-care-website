// The unsubscribe link at the bottom of every list email: wearecalledtocare.com/unsubscribe?t=<private code>
//   GET  -> a page asking the person to confirm (so mail scanners that open links can't unsubscribe anyone)
//   POST -> unsubscribes (also what "one-click unsubscribe" in Gmail and Apple Mail calls), or resubscribes with again=1
import { db, env, esc, SITE_URL } from './_lib.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const page = (title, body, status = 200) => new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${title} · We Are Called to Care</title>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Figtree:wght@400;600;700&display=swap" rel="stylesheet">
<style>body{margin:0;background:#E6EFF4;font-family:Figtree,'Helvetica Neue',Arial,sans-serif;color:#2B3440;min-height:100vh;display:grid;place-items:center}
main{background:#fff;border-radius:22px;max-width:520px;margin:24px 16px;overflow:hidden;text-align:center}
header{background:#1D4766;padding:26px 24px 22px}header img{width:210px;height:auto;display:block;margin:0 auto}
section{padding:34px 34px 38px}h1{font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:2.3rem;line-height:1.08;color:#1D4766;margin:0 0 14px}
p{font-size:1.02rem;line-height:1.6;margin:0 0 18px}.who{font-weight:700;color:#1D4766;overflow-wrap:anywhere}
button{font:inherit;font-weight:700;border:0;border-radius:999px;padding:15px 30px;background:#E2197A;color:#fff;cursor:pointer}
button.quiet{background:none;color:#1E5F82;text-decoration:underline;padding:10px}button:focus-visible,a:focus-visible{outline:3px solid #1E5F82;outline-offset:3px}
a{color:#1E5F82}</style></head><body><main><header><img src="${SITE_URL()}/assets/logo-white.png" alt="We Are Called to Care" width="778" height="189"></header><section>${body}</section></main></body></html>`,
  { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });

const notFound = () => page('Link not found', `<h1>This link didn't work.</h1><p>The unsubscribe link may be incomplete. Reply to any email from us, or write to <a href="mailto:${esc(env('EMAIL_REPLY_TO', 'shari@wearecalledtocare.com'))}">${esc(env('EMAIL_REPLY_TO', 'shari@wearecalledtocare.com'))}</a>, and we'll take you off the list.</p>`, 404);
const form = (t, label, extra = '', cls = '') => `<form method="post" action="/unsubscribe?t=${t}">${extra}<button class="${cls}" type="submit">${label}</button></form>`;

export default async (req) => {
  const u = new URL(req.url); const t = u.searchParams.get('t') || '';
  if (!UUID.test(t)) return notFound();
  let c;
  try { [c] = await db(`contacts?unsub_token=eq.${t}&select=id,email,do_not_email,do_not_email_reason`); } catch { c = null; }
  if (!c) return notFound();
  const who = `<span class="who">${esc(c.email || '')}</span>`;
  if (req.method === 'POST') {
    const text = await req.text().catch(() => '');
    const again = new URLSearchParams(text).get('again') === '1';
    if (again) {
      // Only people who unsubscribed themselves can switch back on here; bounced or spam-flagged addresses stay off.
      if (c.do_not_email && c.do_not_email_reason === 'Unsubscribed') await db(`contacts?id=eq.${c.id}`, { method: 'PATCH', body: { do_not_email: false, do_not_email_reason: '', email_ok: true } });
      return page('You are back on the list', `<h1>Welcome back.</h1><p>${who} will keep getting emails from We Are Called to Care.</p><p><a href="${SITE_URL()}">Go to wearecalledtocare.com</a></p>`);
    }
    if (!c.do_not_email) await db(`contacts?id=eq.${c.id}`, { method: 'PATCH', body: { do_not_email: true, do_not_email_reason: 'Unsubscribed', email_ok: false } });
    return page('You are unsubscribed', `<h1>You're unsubscribed.</h1><p>${who} won't get any more emails from our list. You'll still get receipts for gifts or tickets you buy.</p>${form(t, 'I unsubscribed by mistake. Put me back.', '<input type="hidden" name="again" value="1">', 'quiet')}`);
  }
  if (c.do_not_email) return page('You are unsubscribed', `<h1>You're already off the list.</h1><p>${who} isn't getting emails from our list.</p>${c.do_not_email_reason === 'Unsubscribed' ? form(t, 'Put me back on the list', '<input type="hidden" name="again" value="1">', 'quiet') : ''}`);
  return page('Unsubscribe', `<h1>Unsubscribe from our emails?</h1><p>We'll stop sending list emails to ${who}.</p>${form(t, 'Yes, unsubscribe me')}<p style="margin-top:18px"><a href="${SITE_URL()}">No, keep me on the list</a></p>`);
};
