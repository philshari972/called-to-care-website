// Send an email written in the admin to the email list (needs a staff member who can edit Contacts & Email List).
//   POST { action: 'test', subject, html, reply_to?, to: [up to 3 addresses] }  -> sends just to those addresses
//   POST { action: 'start', id }   -> lines up everyone in the draft's audience and marks it as sending
//   POST { action: 'batch', id }   -> sends to the next group; the admin calls this until nobody is left
//   POST { action: 'cancel', id }  -> stops a send that is under way (people already sent to stay sent)
import { db, rpc, json, fail, staffLevel, env, esc, clean, isEmail, SITE_URL } from './_lib.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FROM = () => env('EMAIL_FROM', 'We Are Called to Care <hello@wearecalledtocare.com>');
const REPLY = () => env('EMAIL_REPLY_TO', 'shari@wearecalledtocare.com');
const unsubUrl = (token) => `${SITE_URL()}/unsubscribe?t=${token}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fill in the per-person pieces of a finished email.
export function personalize(text, { first_name, unsub_token }, { html = true } = {}) {
  const first = clean(first_name, 80).split(/\s+/)[0] || 'Friend';
  return String(text).replaceAll('{{first_name}}', html ? esc(first) : first).replaceAll('{{unsubscribe_url}}', unsub_token ? unsubUrl(unsub_token) : `${SITE_URL()}/unsubscribe`);
}

async function resend(path, body, idem) {
  const headers = { authorization: `Bearer ${env('RESEND_API_KEY')}`, 'content-type': 'application/json' };
  if (idem) headers['idempotency-key'] = idem;
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://api.resend.com${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const out = await r.json().catch(() => ({}));
    const quota = r.status === 429 && /quota/i.test(`${out.name || ''} ${out.message || ''}`);
    if (r.status === 429 && !quota && attempt < 2) { await sleep(1100); continue; }   // too fast: wait and try again
    return { ok: r.ok, status: r.status, out, quota };
  }
}

const message = (c, person) => {
  const url = unsubUrl(person.unsub_token);
  return { from: FROM(), to: [person.email], subject: personalize(c.subject, person, { html: false }), html: personalize(c.html, person),
    reply_to: isEmail(c.reply_to) ? c.reply_to : REPLY(), headers: { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
};
const mark = (id, people, fields) => people.length
  ? db(`email_sends?campaign_id=eq.${id}&contact_id=in.(${people.map((p) => p.contact_id).join(',')})`, { method: 'PATCH', body: fields }) : null;

// Send one group. If the mail service rejects the group, split it to find the address it does not like.
async function sendGroup(c, people, deadline, state) {
  if (!people.length || state.stop) return;
  if (Date.now() > deadline) { await mark(c.id, people, { status: 'queued', claimed_at: null }); return; }
  const r = await resend('/emails/batch', people.map((p) => message(c, p)), `${c.id}:${people[0].contact_id}:${people.length}:${Math.floor(Date.now() / 3600000)}`);
  if (r.ok) {
    const ids = r.out.data || []; const at = new Date().toISOString();
    // one request saves everyone, each with their own id from the mail service
    await db('email_sends?on_conflict=campaign_id,contact_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
      body: people.map((p, i) => ({ campaign_id: c.id, contact_id: p.contact_id, email: p.email, status: 'sent', provider_id: ids[i]?.id || null, sent_at: at, error: '' })) });
    state.sent += people.length; return;
  }
  if (r.quota || r.status === 429 || r.status >= 500 || r.status === 401 || r.status === 403) {
    await mark(c.id, people, { status: 'queued', claimed_at: null });
    state.stop = r.quota ? 'Your email service (Resend) has reached its sending limit for today or this month. Everyone left is still lined up: come back and press Resume, or raise the limit on your Resend plan.'
      : r.status === 401 || r.status === 403 ? 'The email service refused the request. Check the Resend API key and that wearecalledtocare.com is verified in Resend.'
      : 'The email service is busy. Everyone left is still lined up: press Resume in a minute.';
    return;
  }
  if (people.length === 1) { await mark(c.id, people, { status: 'failed', error: clean(r.out.message || `Rejected (${r.status})`, 200) }); state.failed += 1; return; }
  const mid = Math.ceil(people.length / 2);
  await sleep(550); await sendGroup(c, people.slice(0, mid), deadline, state);
  await sleep(550); await sendGroup(c, people.slice(mid), deadline, state);
}

export default async (req) => {
  if (req.method !== 'POST') return fail('Use POST', 405);
  let b; try { b = await req.json(); } catch { return fail('Invalid request'); }
  if ((await staffLevel(req, 'emaillist')) < 3) return fail('You need edit access to Contacts & Email List to send email.', 403);
  if (!env('RESEND_API_KEY')) return fail('Email sending is not set up yet (no Resend key).', 500);
  try {
    if (b.action === 'test') {
      const to = [].concat(b.to || []).map((x) => clean(x, 200).toLowerCase()).filter(isEmail).slice(0, 3);
      const subject = clean(b.subject, 200), html = String(b.html || '');
      if (!to.length) return fail('Enter an email address to send the test to.');
      if (!subject || html.length < 50) return fail('Add a subject and some content first.');
      if (html.length > 400000) return fail('This email is too large.');
      const me = { first_name: clean(b.first_name, 80) || 'Friend', unsub_token: null };
      const r = await resend('/emails/batch', to.map((email) => ({ from: FROM(), to: [email], subject: `[Test] ${personalize(subject, me, { html: false })}`, html: personalize(html, me), reply_to: isEmail(b.reply_to) ? b.reply_to : REPLY() })));
      if (!r.ok) return fail(r.quota ? 'Your email service (Resend) has reached its sending limit.' : clean(r.out.message || 'The test could not be sent.', 200), 502);
      return json({ ok: true, sent: to.length });
    }
    if (!UUID.test(b.id || '')) return fail('Unknown email');
    const [c] = await db(`email_campaigns?id=eq.${b.id}&select=*`);
    if (!c) return fail('Email not found', 404);

    if (b.action === 'start') {
      if (c.status !== 'draft') return json({ ok: true, total: c.total, status: c.status });
      if (!clean(c.subject, 200)) return fail('Add a subject line first.');
      if (!c.html.includes('{{unsubscribe_url}}')) return fail('This email is missing its unsubscribe link. Open it, save it again, and try once more.');
      const total = await rpc('email_start', { p_campaign: c.id });
      if (!total) return fail('Nobody matches this audience, so there is no one to send to.');
      return json({ ok: true, total, status: 'sending' });
    }
    if (b.action === 'cancel') {
      if (c.status !== 'sending') return json({ ok: true, status: c.status });
      await db(`email_sends?campaign_id=eq.${c.id}&status=in.(queued,sending)`, { method: 'DELETE' });
      const t = await rpc('email_tally', { p_campaign: c.id });
      await db(`email_campaigns?id=eq.${c.id}`, { method: 'PATCH', body: { status: 'canceled', total: t.sent + t.failed, finished_at: new Date().toISOString() } });
      return json({ ok: true, status: 'canceled', ...t });
    }
    if (b.action === 'batch') {
      if (c.status !== 'sending') return json({ ok: true, done: true, status: c.status, sent: c.sent, failed: c.failed, left: 0 });
      const people = await rpc('email_claim', { p_campaign: c.id, p_n: 100 });
      const state = { sent: 0, failed: 0, stop: '' };
      const bad = people.filter((p) => !isEmail(p.email)), good = people.filter((p) => isEmail(p.email));
      if (bad.length) { await mark(c.id, bad, { status: 'failed', error: 'Not a valid email address' }); state.failed += bad.length; }
      await sendGroup(c, good, Date.now() + 7000, state);
      const t = await rpc('email_tally', { p_campaign: c.id });
      return json({ ok: true, done: t.left === 0, ...t, ...(state.stop ? { stop: state.stop } : {}) });
    }
    return fail('Unknown action');
  } catch (e) {
    console.error('email-send', e);
    return fail('Something went wrong while sending. Nothing was lost: try again in a moment.', 500);
  }
};
