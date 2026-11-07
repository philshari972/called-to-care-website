// Support Night: RSVP links, reminder emails.
import crypto from 'node:crypto';
import { db, sendEmail, emailShell, p, btn, box, esc, SITE_URL } from './_lib.mjs';

export const AGES = ['Newborn-2 years', '3 years-5 years', '1st Grade - 5th Grade'];
export const ageLabel = (a) => ({ 'Newborn-2 years': 'Newborn–2 years', '3 years-5 years': '3–5 years', '1st Grade - 5th Grade': '1st–5th grade' }[a] || a || '');
export const newToken = () => crypto.randomBytes(12).toString('hex');
export const rsvpLink = (sub) => `${SITE_URL()}/?r=${sub.id}.${sub.admin?.manage_token || ''}#rsvp`;
export const when = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(' at ', ' · ');
export const cleanKids = (list) => (Array.isArray(list) ? list : []).slice(0, 8)
  .map((k) => ({ first: String(k.first || '').trim().slice(0, 40), age_group: AGES.includes(k.age_group) ? k.age_group : '' }))
  .filter((k) => k.first);

export async function ensureToken(sub) {
  if (sub.admin?.manage_token) return sub;
  const admin = { ...(sub.admin || {}), manage_token: newToken() };
  await db(`submissions?id=eq.${sub.id}`, { method: 'PATCH', body: { admin } });
  return { ...sub, admin };
}

export async function sendReminder(sub, ev) {
  const d = sub.data || {}; const kids = cleanKids(d.children);
  const link = rsvpLink(sub);
  const html = emailShell({
    preheader: `Support Night is ${when(ev.starts_at)}. Need to change or cancel? It only takes a moment.`,
    heading: `See you Thursday, ${esc(d.first_name || '')}!`,
    bodyHtml: p(`Just a reminder that you're registered for <b>Support Night</b>. We can't wait to see you.`)
      + box([['When', esc(when(ev.starts_at))], ['Where', esc(ev.location || 'Called to Care office, 1111 W South St, Plano')], ['Children in childcare', kids.length ? esc(kids.map((k) => `${k.first} (${ageLabel(k.age_group)})`).join(', ')) : 'None']])
      + p('Plans change, and that\'s okay. If you need to add or remove a child, or can\'t make it, please let us know so we can plan childcare.')
      + btn('Update or Cancel My RSVP', link)
      + p('<span style="font-size:14px;color:#5E6B78">Questions? Just reply to this email.</span>'),
    reason: "You're receiving this because you registered for Support Night on wearecalledtocare.com." });
  await sendEmail({ to: String(d.email || '').toLowerCase(), subject: `Reminder: Support Night ${when(ev.starts_at).split(' · ')[0]}`, html, template: 'support-reminder', contactId: sub.contact_id });
}
