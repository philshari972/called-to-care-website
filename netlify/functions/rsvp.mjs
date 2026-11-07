// GET  /.netlify/functions/rsvp?ref=ID.TOKEN          -> the family's Support Night RSVP
// POST /.netlify/functions/rsvp { ref, action: 'update'|'cancel', event_id, children }
import { db, json, fail, alertStaff, esc, SITE_URL } from './_lib.mjs';
import { cleanKids, when, ageLabel } from './_support.mjs';

async function find(ref) {
  const [id, tok] = String(ref || '').split('.');
  if (!/^[0-9a-f-]{36}$/.test(id || '') || !tok) return null;
  const [s] = await db(`submissions?id=eq.${id}&form=eq.support&select=*`);
  return s && s.admin?.manage_token === tok ? s : null;
}
const openNights = () => db(`events?kind=eq.support_night&registration_open=eq.true&starts_at=gte.${new Date(Date.now() - 3 * 36e5).toISOString()}&order=starts_at.asc&limit=4&select=id,starts_at,location`);

export default async (req) => {
  try {
    if (req.method === 'GET') {
      const s = await find(new URL(req.url).searchParams.get('ref'));
      if (!s) return fail('This link has expired. Please contact us to change your RSVP.', 404);
      const nights = await openNights();
      const d = s.data || {};
      return json({ ok: true, first: d.first_name || '', status: s.status, event_id: s.event_id, children: cleanKids(d.children),
        nights: nights.map((e) => ({ id: e.id, label: when(e.starts_at) })) });
    }
    if (req.method !== 'POST') return fail('Use POST', 405);
    const b = await req.json().catch(() => ({}));
    const s = await find(b.ref); if (!s) return fail('This link has expired. Please contact us to change your RSVP.', 404);
    const d = s.data || {}; const name = `${d.first_name || ''} ${d.last_name || ''}`.trim();
    if (b.action === 'cancel') {
      await db(`submissions?id=eq.${s.id}`, { method: 'PATCH', body: { status: 'Cancelled' } });
      await alertStaff(`Support Night cancellation: ${name}`, [`${esc(name)} can't make it${(d.children || []).length ? ` (${(d.children || []).length} child(ren) were registered)` : ''}.`], `${SITE_URL()}/admin/#support`).catch(() => {});
      return json({ ok: true, status: 'Cancelled' });
    }
    if (b.action !== 'update') return fail('Unknown request');
    const nights = await openNights();
    const ev = nights.find((e) => e.id === b.event_id) || nights.find((e) => e.id === s.event_id);
    const kids = cleanKids(b.children);
    const data = { ...d, children: kids, children_text: kids.map((k) => `${k.first} (${ageLabel(k.age_group)})`).join(', '), event_label: ev ? when(ev.starts_at) : d.event_label };
    await db(`submissions?id=eq.${s.id}`, { method: 'PATCH', body: { data, event_id: ev ? ev.id : s.event_id, status: s.status === 'Cancelled' ? 'Registered' : s.status } });
    await alertStaff(`Support Night RSVP updated: ${name}`, [`${esc(name)} · ${esc(data.event_label || '')}`, `Children: ${esc(data.children_text || 'none')}`], `${SITE_URL()}/admin/#support`).catch(() => {});
    return json({ ok: true, label: data.event_label });
  } catch (e) { console.error('rsvp', e.message); return fail('Sorry, something went wrong. Please try again.', 500); }
};
