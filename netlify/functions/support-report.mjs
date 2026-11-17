// Wednesday and Friday at 7 AM Central, plus 7 AM on the day of a Support Night: email the numbers
// (moms registered, kids by age group) to the team.
// Who gets it is the "support_report_email" setting (Admin -> Settings); the addresses below are the starting list.
import { db, setting, sendEmail, emailShell, p, btn, esc, isEmail, SITE_URL } from './_lib.mjs';
import { AGES, ageLabel, cleanKids, when } from './_support.mjs';

// Netlify schedules run on UTC, and 7 AM in Illinois is 13:00 UTC in winter and 12:00 UTC in summer.
// So this wakes at both hours on Wed, Thu and Fri, and due() below only lets the 7 AM one through.
export const config = { schedule: '0 12,13 * * 3,4,5' };
export const DEFAULT_TO = ['shari@wearecalledtocare.com', 'mattieellapatrick@gmail.com', 'phil@wearecalledtocare.com', 'jen@wearecalledtocare.com'];
const NAVY = '#1D4766', TEAL = '#1E5F82', PINK = '#E2197A', LINE = '#E4E9EE', MUTED = '#5E6B78', SKYL = '#E8F1F6';
const chiDay = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const chi = (d) => { const o = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(d).map((x) => [x.type, x.value])); return { day: o.weekday, hour: Number(o.hour) % 24 }; };
// Is a report due right now? Wednesday and Friday at 7 AM; Thursday at 7 AM only when a Support Night is that day.
export function due(now, evs) { const { day, hour } = chi(now); if (hour !== 7) return false;
  if (day === 'Wed' || day === 'Fri') return true;
  return evs.some((e) => chiDay(e.starts_at) === chiDay(now)); }
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// The numbers for one Support Night.
export function tally(subs, ratios, now = new Date()) {
  const live = subs.filter((s) => s.status !== 'Cancelled'); const kids = live.flatMap((s) => cleanKids(s.data?.children));
  const r = Array.isArray(ratios) && ratios.length === 3 ? ratios.map((x) => Math.max(1, Number(x) || 1)) : [1, 2, 2];
  const groups = AGES.map((a, i) => { const n = kids.filter((k) => k.age_group === a).length; return { label: ageLabel(a), kids: n, volunteers: Math.ceil(n / r[i]) }; });
  const unknown = kids.filter((k) => !AGES.includes(k.age_group)).length;
  if (unknown) groups.push({ label: 'Age not given', kids: unknown, volunteers: Math.ceil(unknown / r[2]) });
  const week = now.getTime() - 7 * 864e5;
  return { moms: live.length, kids: kids.length, groups, volunteers: groups.reduce((a, g) => a + g.volunteers, 0),
    fresh: live.filter((s) => new Date(s.created_at).getTime() >= week).length, cancelled: subs.length - live.length };
}

const big = (n, label) => `<td width="33%" align="center" valign="top" style="padding:16px 6px;"><div style="font-family:'Instrument Serif',Georgia,serif;font-size:46px;line-height:46px;color:${NAVY};">${n}</div><div style="font-size:13px;line-height:18px;color:${MUTED};font-weight:600;margin-top:4px;">${label}</div></td>`;
const cell = (t, extra = '') => `<td style="padding:11px 14px;border-top:1px solid ${LINE};font-size:15px;${extra}">${t}</td>`;
// The list of who is coming: one row per mom, with how many kids and their age groups (no children's names).
export function roster(subs) {
  const live = subs.filter((s) => s.status !== 'Cancelled').map((s) => { const d = s.data || {}; const kids = cleanKids(d.children);
    const ages = AGES.map((a) => { const n = kids.filter((k) => k.age_group === a).length; return n ? `${n > 1 ? n + ' × ' : ''}${ageLabel(a)}` : ''; }).filter(Boolean);
    const unknown = kids.filter((k) => !AGES.includes(k.age_group)).length; if (unknown) ages.push(`${unknown > 1 ? unknown + ' × ' : ''}age not given`);
    return { first: String(d.first_name || '').trim(), last: String(d.last_name || '').trim(), kids: kids.length, ages }; })
    .sort((a, b) => a.last.localeCompare(b.last, 'en', { sensitivity: 'base' }) || a.first.localeCompare(b.first, 'en', { sensitivity: 'base' }));
  if (!live.length) return '';
  const head = (t, align = 'left') => `<td align="${align}" style="padding:11px 14px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${TEAL};font-weight:700;">${t}</td>`;
  return `<p style="margin:4px 0 8px;font-size:17px;color:${NAVY};"><b>Who is registered</b></p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:12px;margin:0 0 22px;">
<tr>${head('#')}${head('Name')}${head('Kids in childcare')}</tr>
${live.map((m, i) => `<tr>${cell(i + 1, `color:${MUTED};width:28px;`)}${cell(esc(`${m.first} ${m.last}`.trim() || 'Name not given'), `color:${NAVY};font-weight:600;`)}${cell(m.kids ? `${m.kids}: ${esc(m.ages.join(', '))}` : '<span style="color:' + MUTED + '">None</span>', 'font-size:14px;')}</tr>`).join('')}</table>`;
}

export function section(ev, t, now = new Date()) {
  const days = Math.round((new Date(chiDay(ev.starts_at)) - new Date(chiDay(now))) / 864e5);
  const away = days <= 0 ? 'tonight' : days === 1 ? 'tomorrow' : `${days} days away`;
  return `<p style="margin:0 0 4px;font-size:17px;color:${NAVY};"><b>${esc(when(ev.starts_at))}</b> <span style="color:${MUTED};font-size:14px;">(${away})</span></p>
<p style="margin:0 0 14px;font-size:14px;color:${MUTED};">${esc(ev.location || 'Called to Care')}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SKYL};border-radius:12px;margin:0 0 16px;"><tr>${big(t.moms, 'Moms registered')}${big(t.kids, 'Kids in childcare')}${big(t.volunteers, 'Childcare volunteers needed')}</tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:12px;margin:0 0 14px;">
<tr><td style="padding:11px 14px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${TEAL};font-weight:700;">Age group</td><td align="right" style="padding:11px 14px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${TEAL};font-weight:700;">Kids</td><td align="right" style="padding:11px 14px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${TEAL};font-weight:700;">Volunteers</td></tr>
${t.groups.map((g) => `<tr>${cell(esc(g.label), `color:${NAVY};font-weight:600;`)}${cell(g.kids).replace('<td', '<td align="right"')}${cell(g.volunteers).replace('<td', '<td align="right"')}</tr>`).join('')}
<tr>${cell('Total', `color:${NAVY};font-weight:700;`)}${cell(`<b>${t.kids}</b>`).replace('<td', '<td align="right"')}${cell(`<b>${t.volunteers}</b>`).replace('<td', '<td align="right"')}</tr></table>
<p style="margin:0 0 22px;font-size:14px;color:${MUTED};">${t.fresh ? `<b style="color:${PINK};">${plural(t.fresh, 'new registration', 'new registrations')}</b> in the last 7 days.` : 'No new registrations in the last 7 days.'}${t.cancelled ? ` ${plural(t.cancelled, 'cancellation', 'cancellations')} so far (not counted above).` : ''}</p>`;
}

const upcoming = async (now) => (await db(`events?kind=eq.support_night&select=*&starts_at=gte.${now.toISOString()}&order=starts_at.asc`)).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at)).slice(0, 3);
export async function build(now = new Date(), evs = null) {
  evs = evs || await upcoming(now);
  if (!evs.length) return null;
  const ratios = await setting('childcare_ratios', [1, 2, 2]);
  const names = (await setting('support_report_names', true)) !== false;   // Settings switch: list who is coming, or numbers only
  const parts = [];
  for (const ev of evs) { const subs = await db(`submissions?form=eq.support&event_id=eq.${ev.id}&select=status,data,created_at`); parts.push({ ev, t: tally(subs, ratios, now), list: names ? roster(subs) : '' }); }
  // Always show the next one; later ones only once people have signed up.
  const show = parts.filter((x, i) => i === 0 || x.t.moms > 0); const first = show[0];
  const html = emailShell({
    preheader: `${plural(first.t.moms, 'mom', 'moms')} and ${plural(first.t.kids, 'kid', 'kids')} registered for ${when(first.ev.starts_at).split(' · ')[0]}.`,
    heading: 'Support Night registrations',
    bodyHtml: p(chiDay(first.ev.starts_at) === chiDay(now) ? '<b>Support Night is tonight.</b> Here are the final numbers as of this morning.' : 'Here is where registrations stand this morning.') + show.map((x) => section(x.ev, x.t, now) + x.list).join(`<hr style="border:0;border-top:1px solid ${LINE};margin:4px 0 22px;">`)
      + btn(names ? 'Open Support Night in the Admin' : 'See Who Is Registered', `${SITE_URL()}/admin/#support`)
      + (names ? '' : p(`<span style="font-size:13px;color:${MUTED}">Names are kept in the admin, not in this email.</span>`)),
    reason: 'Support Night report from the Called to Care website, sent Wednesday and Friday mornings and the morning of Support Night.' });
  return { subject: `Support Night ${when(first.ev.starts_at).split(' · ')[0].replace(/^\w+, /, '')}: ${plural(first.t.moms, 'mom', 'moms')}, ${plural(first.t.kids, 'kid', 'kids')}`, html, first };
}

// scheduled = true is the timer waking up (send only if it is one of the 7 AM slots); false sends right away.
export async function run(now = new Date(), scheduled = false) {
  const evs = await upcoming(now); if (!evs.length) return { sent: 0, reason: 'No Support Night on the calendar' };
  if (scheduled && !due(now, evs)) return { sent: 0, reason: 'Not a report morning' };
  const out = await build(now, evs);
  const to = [...new Set([].concat(await setting('support_report_email', DEFAULT_TO)).map((x) => String(x || '').trim().toLowerCase()).filter(isEmail))];
  let sent = 0;
  for (const email of to) { try { await sendEmail({ to: email, subject: out.subject, html: out.html, template: 'support-report' }); sent += 1; } catch (e) { console.error('support report', email, e.message); } }
  return { sent, to };
}
export default async () => { const r = await run(new Date(), true); console.log('support report:', JSON.stringify(r)); return new Response(JSON.stringify(r)); };
