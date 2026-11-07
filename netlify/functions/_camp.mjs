// Camp scholarship helpers: camp end dates, follow-up links, follow-up emails, photo storage.
import crypto from 'node:crypto';
import { env, db, sendEmail, emailShell, p, btn, esc, SITE_URL } from './_lib.mjs';

const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
// Best guess at the LAST day of camp from free text like "7/20-7/24 and 7/27-7/31", "June 21-27", "Nov 7-9", "July 19 to 23".
export function campEnd(text, ref = new Date()) {
  const t = String(text || '').toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1');
  let best = null; const year = ref.getFullYear();
  const put = (y, m, d) => { if (m < 0 || m > 11 || d < 1 || d > 31) return; const dt = new Date(y || year, m, d); if (!best || dt > best) best = dt; };
  for (const m of t.matchAll(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g)) put(m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : 0, +m[1] - 1, +m[2]);
  let lastMonth = -1;
  for (const m of t.matchAll(/([a-z]{3,9})\.?\s+(\d{1,2})(?:\s*(?:-|–|to|through)\s*(?:([a-z]{3,9})\.?\s+)?(\d{1,2}))?/g)) {
    const mo = MON[m[1].slice(0, 3)]; if (mo === undefined) continue; lastMonth = mo;
    const mo2 = m[3] && MON[m[3].slice(0, 3)] !== undefined ? MON[m[3].slice(0, 3)] : mo;
    put(0, mo2, +(m[4] || m[2]));
  }
  if (!best && lastMonth < 0) { const m = t.match(/^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/); if (m) return null; }
  if (best && /week of/.test(t)) best = new Date(best.getFullYear(), best.getMonth(), best.getDate() + 4);
  return best ? `${best.getFullYear()}-${String(best.getMonth() + 1).padStart(2, '0')}-${String(best.getDate()).padStart(2, '0')}` : null;
}
export const newToken = () => crypto.randomBytes(12).toString('hex');
export const followupLink = (app) => `${SITE_URL()}/?cf=${app.id}.${app.admin?.followup_token || ''}#camp-followup`;
export const youthOf = (d) => (d.youth_preferred_name || d.youth_first || 'your camper').trim();

export async function sendFollowup(app, kind = 'request') {
  const d = app.data || {}; const youth = esc(youthOf(d)); const camp = esc(d.camp_name || 'camp');
  const link = followupLink(app);
  const subject = kind === 'reminder' ? `We'd love to hear about ${youthOf(d)}'s week at camp` : `How was camp, ${youthOf(d)}?`;
  const body = (kind === 'reminder'
    ? p(`Camp may be over, but we'd still love to hear about it! We hope ${youth} had a wonderful time at <b>${camp}</b>, and we're so grateful we got to help make it happen.`)
    : p(`We hope ${youth} had an amazing time at <b>${camp}</b>! Thank you for letting Called to Care be part of this summer.`))
    + p(`Would you take five minutes to tell us about it? Share a favorite memory in ${youth}'s own words, a few thoughts from you, and up to five photos.`)
    + btn('Share Camp Photos & Stories', link)
    + p(`<span style="font-size:14px;color:#5E6B78">Your story helps our donors see what their gifts make possible, and helps us send more kids to camp next year. Photos are only shared publicly if you gave permission on your application.</span>`);
  const html = emailShell({ preheader: `Share a favorite memory and a few photos from ${youthOf(d)}'s week at camp.`, heading: `How was camp, ${youth}?`, bodyHtml: body,
    reason: "You're receiving this because you applied for a Called to Care camp scholarship." });
  const to = String(d.email || '').trim().toLowerCase();
  if (!to) throw new Error('This application has no email address.');
  await sendEmail({ to, subject, html, template: `camp-followup-${kind}`, contactId: app.contact_id });
  return to;
}

// Save one photo (data URL) to the private camp-photos bucket; returns its path.
export async function savePhoto(folder, i, dataUrl) {
  const m = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64'); if (buf.length > 8 * 1024 * 1024) return null;
  const ext = m[1].split('/')[1].replace('jpeg', 'jpg'); const path = `${folder}/${i + 1}.${ext}`;
  const r = await fetch(`${env('SUPABASE_URL').replace(/\/$/, '')}/storage/v1/object/camp-photos/${path}`, {
    method: 'POST', headers: { authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`, apikey: env('SUPABASE_SERVICE_ROLE_KEY'), 'content-type': m[1], 'x-upsert': 'true' }, body: buf });
  if (!r.ok) { console.error('photo upload failed', r.status, (await r.text()).slice(0, 200)); return null; }
  return path;
}

// Merge staff fields on a submission
export async function patchAdmin(id, changes, extra = {}) {
  const [row] = await db(`submissions?id=eq.${id}&select=admin`);
  const admin = { ...(row?.admin || {}), ...changes };
  await db(`submissions?id=eq.${id}`, { method: 'PATCH', body: { admin, ...extra } });
  return admin;
}
