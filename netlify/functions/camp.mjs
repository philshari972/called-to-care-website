// POST /.netlify/functions/camp  { action: 'send_followup', id }   (from the admin; needs a signed-in staff member with Camp edit access)
import { env, db, json, fail } from './_lib.mjs';
import { sendFollowup, newToken, patchAdmin } from './_camp.mjs';

async function campLevel(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return 0;
  const r = await fetch(`${env('SUPABASE_URL').replace(/\/$/, '')}/rest/v1/rpc/level_for`, {
    method: 'POST', headers: { apikey: env('SUPABASE_PUBLISHABLE_KEY') || env('SUPABASE_SERVICE_ROLE_KEY'), authorization: `Bearer ${token}`, 'content-profile': 'site', 'accept-profile': 'site', 'content-type': 'application/json' },
    body: JSON.stringify({ p_section: 'camp' }) });
  if (!r.ok) return 0;
  return Number(await r.json()) || 0;
}

export default async (req) => {
  if (req.method === 'GET') {   // prefill the follow-up form from a private link
    const [id, tok] = String(new URL(req.url).searchParams.get('ref') || '').split('.');
    if (!/^[0-9a-f-]{36}$/.test(id || '') || !tok) return fail('Not found', 404);
    try {
      const [a] = await db(`submissions?id=eq.${id}&form=eq.camp&select=data,admin`);
      if (!a || a.admin?.followup_token !== tok) return fail('Not found', 404);
      const d = a.data || {};
      return json({ ok: true, youth: [d.youth_preferred_name || d.youth_first, d.youth_last].filter(Boolean).join(' '), guardian: [d.adult_first, d.adult_last].filter(Boolean).join(' '), email: d.email || '', camp: d.camp_name || '', dates: d.camp_dates || '' });
    } catch { return fail('Not found', 404); }
  }
  if (req.method !== 'POST') return fail('Use POST', 405);
  if ((await campLevel(req)) < 3) return fail('You need edit access to Camp Scholarships.', 403);
  let b; try { b = await req.json(); } catch { return fail('Invalid request'); }
  if (b.action !== 'send_followup' || !/^[0-9a-f-]{36}$/.test(b.id || '')) return fail('Unknown request');
  try {
    let [app] = await db(`submissions?id=eq.${b.id}&form=eq.camp&select=*`);
    if (!app) return fail('Application not found', 404);
    if (!app.admin?.followup_token) app.admin = await patchAdmin(app.id, { followup_token: newToken() });
    const to = await sendFollowup(app, 'request');
    const admin = await patchAdmin(app.id, { followup_requested_at: new Date().toISOString() });
    return json({ ok: true, to, admin });
  } catch (e) { console.error('camp', e.message); return fail(e.message, 500); }
};
