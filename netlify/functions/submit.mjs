// POST /.netlify/functions/submit  { form, data, website (honeypot), t (page-load time) }
// Saves any website form, tags the person, emails them a confirmation, and alerts staff.
import crypto from 'node:crypto';
import { campEnd, newToken, savePhoto, patchAdmin } from './_camp.mjs';
import { cleanKids, ageLabel } from './_support.mjs';
import { setting, db, upsertContact, sendEmail, alertStaff, emailShell, p, btn, box, json, fail, clean, isEmail, fmtPhone, esc, looksLikeBot, SITE_URL } from './_lib.mjs';

// Extra people who get the staff alert for one kind of form (on top of the main staff alert list). Editable in admin Settings.
const EXTRA_ALERTS = { camp: ['camp_alert_email', ['wendy@wearecalledtocare.com']], placements: ['placement_alert_email', ['jen@wearecalledtocare.com']] };
const year = () => new Date().getFullYear();
const cleanDeep = (v, depth = 0) => {
  if (depth > 4) return null;
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => cleanDeep(x, depth + 1));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).slice(0, 80).map(([k, x]) => [clean(k, 60), cleanDeep(x, depth + 1)]));
  if (typeof v === 'string') return v.startsWith('data:image/png;base64,') ? v.slice(0, 200000) : clean(v, 4000);
  return typeof v === 'number' || typeof v === 'boolean' ? v : null;
};
const splitName = (full) => { const s = clean(full, 120).split(/\s+/); return { first: s[0] || '', last: s.slice(1).join(' ') }; };

// Each form: what is required, how it becomes a contact, tags, and the emails.
const FORMS = {
  support: {
    required: ['first_name', 'last_name', 'email'],
    contact: (d) => ({ first: d.first_name, last: d.last_name, email: d.email, phone: d.phone }),
    tags: (d) => ['Support Night', ...(d.family_type ? [clean(d.family_type, 40)] : [])],
    admin: () => ({ manage_token: newToken() }),
    confirm: (d) => ({ subject: "You're registered for Support Night", heading: `See you soon, ${esc(d.first_name)}!`,
      body: p(`You're registered for Support Night${d.event_label ? ` on <b>${esc(d.event_label)}</b>` : ''}.`)
        + ((d.children || []).length ? box([['Children in childcare', esc(cleanKids(d.children).map((k) => `${k.first} (${ageLabel(k.age_group)})`).join(', '))]]) : '')
        + p("We'll send a reminder two days before, with a link to change or cancel your RSVP.") + p('Come as you are. If something comes up, just reply to this email.') }),
    alert: (d) => [`${d.first_name} ${d.last_name} registered for Support Night${d.event_label ? ' (' + d.event_label + ')' : ''}.`, `Children coming: ${(d.children || []).length || 'none'}`],
    section: 'support',
  },
  placement: {
    required: ['first_name', 'last_name', 'email', 'phone', 'placement_date'],
    contact: (d) => ({ first: d.first_name, last: d.last_name, email: d.email, phone: d.phone, street: d.street, city: d.city, zip: d.zip, state: 'IL', kind: 'family' }),
    tags: () => ['Foster/Kinship Family', `Placement ${year()}`],
    confirm: (d) => ({ subject: "We've got you. Your care package is on the way", heading: `Welcome. We've got you, ${esc(d.first_name)}.`,
      body: p('Thank you for opening your home. We received your request and are putting together a care package for each child.')
        + box([['Children', String((d.children || []).length || 1)], ['Placement date', esc(d.placement_date)], ['Care package', 'Being packed']])
        + p('<b>We will call or text within one business day</b> to set a pickup or drop-off time. Need something sooner? Reply to this email or call 815-200-9086.') }),
    alert: (d) => [`New placement: ${d.first_name} ${d.last_name}, ${(d.children || []).length || 1} child(ren), placed ${d.placement_date}.`, `Phone: ${d.phone} · ${d.city || ''} ${d.county ? '(' + d.county + ' County)' : ''}`],
    section: 'placements',
  },
  christmas: {
    required: ['parent_name', 'email', 'phone'],
    contact: (d) => ({ ...splitName(d.parent_name), email: d.email, phone: d.phone, kind: 'family' }),
    tags: () => [`Christmas ${year()} Families`],
    confirm: (d) => ({ subject: 'We received your Christmas gift sign-up', heading: `Thank you, ${esc(splitName(d.parent_name).first)}!`,
      body: p(`We received gift details for ${(d.kids || []).length} ${(d.kids || []).length === 1 ? 'child' : 'children'}. Our community will shop for each one.`) + p("We'll email you a pickup time before Christmas. Questions? Just reply.") }),
    alert: (d) => [`Christmas sign-up: ${d.parent_name}, ${(d.kids || []).length} children.`],
    section: 'christmas',
  },
  camp: {
    required: ['adult_first', 'adult_last', 'email', 'youth_first'],
    contact: (d) => ({ first: d.adult_first, last: d.adult_last, email: d.email, phone: d.phone, street: d.address_street, city: d.address_city, state: d.address_state, zip: d.address_zip, kind: 'family' }),
    tags: () => ['Camp Family', `Camp ${year()}`],
    confirm: (d) => ({ subject: 'We received your camp scholarship application', heading: `Thank you, ${esc(d.adult_first)}.`,
      body: p(`We received ${esc(d.youth_first)}'s camp scholarship application. Our scholarship committee reviews applications and will contact you with a decision.`) }),
    alert: (d) => [`Camp scholarship application for ${d.youth_first} ${d.youth_last || ''} (${d.camp_name || 'camp not listed'}).`, `From ${d.adult_first} ${d.adult_last} · ${d.email}`],
    section: 'camp',
    admin: (d) => ({ camp_end: campEnd(d.camp_dates), followup_token: newToken() }),
  },
  camp_followup: {
    required: ['youth_name', 'guardian_name', 'email'],
    contact: (d) => ({ ...splitName(d.guardian_name), email: d.email, kind: 'family' }),
    tags: () => ['Camp Family'],
    confirm: (d) => ({ subject: 'Thank you for sharing camp with us', heading: `Thank you, ${esc(splitName(d.guardian_name).first)}!`,
      body: p(`We loved hearing about ${esc(d.youth_name)}'s time at camp${d.camp_name ? ' at <b>' + esc(d.camp_name) + '</b>' : ''}. Stories like yours remind our donors why camp scholarships matter.`) + p('With gratitude, the Called to Care team') }),
    alert: (d) => [`Camp recap from ${d.guardian_name} for ${d.youth_name} (${d.camp_name || 'camp'}).`, `${(d.photos || []).length} photo(s). ${d.youth_story ? 'Youth: “' + String(d.youth_story).slice(0, 200) + '”' : ''}`],
    section: 'camp',
  },
  volunteer: {
    required: ['first_name', 'last_name', 'email'],
    contact: (d) => ({ first: d.first_name, last: d.last_name, email: d.email, phone: d.phone }),
    tags: (d) => ['Volunteer', ...[].concat(d.interests || []).map((i) => `Volunteer: ${clean(i, 40)}`)],
    confirm: (d) => ({ subject: 'Thanks for volunteering with Called to Care', heading: `Thank you, ${esc(d.first_name)}!`,
      body: p(`We're so glad you want to help${[].concat(d.interests || []).length ? ' with <b>' + [].concat(d.interests).map(esc).join(', ') + '</b>' : ''}. A team member will reach out soon to walk you through next steps.`) }),
    alert: (d) => [`New volunteer: ${d.first_name} ${d.last_name} (${[].concat(d.interests || []).join(', ')}).`],
    section: 'volunteers',
  },
  message: {
    required: ['name', 'email', 'message'],
    contact: (d) => ({ ...splitName(d.name), email: d.email, phone: d.phone }),
    tags: (d) => (d.emaillist ? ['Newsletter'] : []),
    confirm: (d) => ({ subject: 'We got your message', heading: `Thanks, ${esc(splitName(d.name).first)}!`,
      body: p("We received your message and will get back to you soon, usually within one business day.") }),
    alert: (d) => [`Message from ${d.name} (${d.email}) about ${d.topic || 'a general question'}:`, esc(d.message)],
    section: 'messages',
  },
  emaillist: {
    required: ['email'],
    contact: (d) => ({ first: d.first_name, last: d.last_name, email: d.email }),
    tags: (d) => ['Newsletter', ...(d.segment ? [clean(d.segment, 40)] : [])],
    confirm: (d) => ({ subject: "You're on the list!", heading: `Welcome${d.first_name ? ', ' + esc(d.first_name) : ''}!`,
      body: p("Thanks for joining the Called to Care email list. You'll hear about events, needs, and stories from the families you help us serve.") + btn('Visit our website', SITE_URL()) }),
    alert: null,
    section: 'emaillist',
  },
};

export default async (req) => {
  if (req.method !== 'POST') return fail('Use POST', 405);
  let body; try { body = await req.json(); } catch { return fail('Invalid request'); }
  if (looksLikeBot(body)) return json({ ok: true });   // pretend success for bots
  const spec = FORMS[body.form];
  if (!spec) return fail('Unknown form');
  const d = cleanDeep(body.data || {});
  const photos = Array.isArray(body.photos) ? body.photos.slice(0, 5) : [];
  if (body.form === 'support') { d.children = cleanKids(d.children); d.children_text = d.children.map((k) => `${k.first} (${ageLabel(k.age_group)})`).join(', '); }
  const missing = spec.required.filter((k) => !clean(d[k]));
  if (missing.length) return fail('Please fill in: ' + missing.join(', '));
  const c = spec.contact(d);
  if (!isEmail(clean(c.email))) return fail('Please enter a valid email address.');
  if (c.phone) c.phone = fmtPhone(c.phone);

  try {
    const contactId = await upsertContact({ ...c, tags: spec.tags(d), source: `Website: ${body.form}` });
    if (body.form === 'camp_followup' && photos.length) {
      const folder = `followups/${new Date().getFullYear()}/${crypto.randomUUID()}`;
      d.photos = (await Promise.all(photos.map((ph, i) => savePhoto(folder, i, ph)))).filter(Boolean);
    }
    const row = { form: body.form, contact_id: contactId, event_id: d.event_id || null, data: d };
    if (spec.admin) row.admin = spec.admin(d);
    let sub;
    try { [sub] = await db('submissions', { method: 'POST', prefer: 'return=representation', body: row }); }
    catch (e) { if (!row.admin || !/admin/.test(e.message)) throw e; delete row.admin; [sub] = await db('submissions', { method: 'POST', prefer: 'return=representation', body: row }); }
    if (body.form === 'camp_followup') await linkFollowup(sub, d, String(body.ref || ''));
    const m = spec.confirm(d);
    await sendEmail({ to: clean(c.email).toLowerCase(), subject: m.subject, html: emailShell({ preheader: m.subject, heading: m.heading, bodyHtml: m.body,
      reason: `You're receiving this because you filled out a form on wearecalledtocare.com.` }), template: `confirm-${body.form}`, contactId });
    if (spec.alert) await alertStaff(`${spec.section === 'messages' ? 'New message' : 'New ' + body.form + ' form'}: ${c.first || ''} ${c.last || ''}`.trim(), spec.alert(d).map(esc), `${SITE_URL()}/admin/#${spec.section}`,
      { also: EXTRA_ALERTS[spec.section] ? await setting(EXTRA_ALERTS[spec.section][0], EXTRA_ALERTS[spec.section][1]) : [] });
    return json({ ok: true, id: sub.id });
  } catch (e) {
    console.error('submit failed', body.form, e.message);
    return fail('Sorry, something went wrong saving your form. Please try again or email hello@wearecalledtocare.com.', 500);
  }
};

// Attach a camp recap to its application: by the private link first, otherwise by email + youth first name.
async function linkFollowup(sub, d, ref) {
  try {
    let app = null;
    const [id, tok] = ref.split('.');
    if (/^[0-9a-f-]{36}$/.test(id || '') && tok) {
      const [a] = await db(`submissions?id=eq.${id}&form=eq.camp&select=*`);
      if (a && a.admin?.followup_token === tok) app = a;
    }
    if (!app) {
      const email = String(d.email || '').toLowerCase();
      const apps = (await db(`submissions?form=eq.camp&select=*&order=created_at.desc`)).filter((a) => String(a.data?.email || '').toLowerCase() === email && !a.admin?.followup_id);
      const yf = String(d.youth_name || '').trim().split(/\s+/)[0].toLowerCase();
      const byName = apps.filter((a) => [a.data?.youth_first, a.data?.youth_preferred_name].some((n) => String(n || '').toLowerCase().startsWith(yf.slice(0, 3))));
      app = (byName.length ? byName : apps.length === 1 ? apps : [])[0] || null;
    }
    if (!app) return;
    await patchAdmin(app.id, { followup_id: sub.id, followup_at: new Date().toISOString() }, { status: 'Follow-up Received' });
    await db(`submissions?id=eq.${sub.id}`, { method: 'PATCH', body: { status: 'Linked', admin: { application_id: app.id } } });
  } catch (e) { console.error('linkFollowup', e.message); }
}
