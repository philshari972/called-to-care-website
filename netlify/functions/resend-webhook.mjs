// Resend tells us when an address bounces or someone marks an email as spam, so we stop emailing them.
// Set up once in Resend: Webhooks -> Add -> https://wearecalledtocare.com/.netlify/functions/resend-webhook,
// events "email.bounced" and "email.complained"; put its signing secret in Netlify as RESEND_WEBHOOK_SECRET.
import crypto from 'node:crypto';
import { db, env, json, fail, clean, isEmail } from './_lib.mjs';

export function verify(secret, id, timestamp, body, header) {
  if (!secret || !id || !timestamp || !header) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 600) return false;        // older than 10 minutes: ignore
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const want = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();
  return header.split(' ').some((part) => { const [v, sig] = part.split(','); if (v !== 'v1' || !sig) return false; const got = Buffer.from(sig, 'base64'); return got.length === want.length && crypto.timingSafeEqual(got, want); });
}

export default async (req) => {
  if (req.method !== 'POST') return fail('Use POST', 405);
  const body = await req.text();
  if (!verify(env('RESEND_WEBHOOK_SECRET'), req.headers.get('svix-id'), req.headers.get('svix-timestamp'), body, req.headers.get('svix-signature'))) return fail('Bad signature', 401);
  let ev; try { ev = JSON.parse(body); } catch { return fail('Invalid request'); }
  const d = ev.data || {}; const to = clean([].concat(d.to || [])[0], 200).toLowerCase();
  const permanent = ev.type === 'email.bounced' && !/transient|temporary/i.test(`${d.bounce?.type || ''}`);
  const reason = ev.type === 'email.complained' ? 'Marked as spam' : permanent ? 'Bounced' : '';
  try {
    if (reason && isEmail(to)) {
      await db(`contacts?email=ilike.${encodeURIComponent(to)}&do_not_email=is.false`, { method: 'PATCH', body: { do_not_email: true, do_not_email_reason: reason, email_ok: false } });
      if (d.email_id) await db(`email_sends?provider_id=eq.${encodeURIComponent(d.email_id)}`, { method: 'PATCH', body: { status: 'failed', error: reason } });
    }
  } catch (e) { console.error('resend-webhook', e); return fail('Could not save', 500); }
  return json({ ok: true });
};
