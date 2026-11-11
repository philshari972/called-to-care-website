// Shared helpers for the server functions. No outside packages: everything uses fetch.
// Secrets come from Netlify environment variables (Site configuration -> Environment variables).
export const env = (k, d = '') => (globalThis.Netlify?.env?.get?.(k) ?? process.env[k] ?? d);

export const SITE_URL = () => env('SITE_URL', 'https://wearecalledtocare.com').replace(/\/$/, '');
export const DINNER_YEAR = 2027;

// ---------- prices live on the server so nobody can change them in the browser ----------
export const SPONSOR_LEVELS = {
  legacy: { name: 'Legacy Sponsor', level: 'Legacy', price: 15000 },
  gold: { name: 'Gold Sponsor', level: 'Gold', price: 10000 },
  platinum: { name: 'Platinum Sponsor', level: 'Platinum', price: 5000 },
  diamond: { name: 'Diamond Sponsor', level: 'Diamond', price: 2500 },
  sapphire: { name: 'Sapphire Sponsor', level: 'Sapphire', price: 1500 },
  ruby: { name: 'Ruby Sponsor', level: 'Ruby', price: 750 },
  friend: { name: 'Friend Sponsor', level: 'Friend', price: 250 },
  appetizer: { name: 'Appetizer Table Sponsor', level: 'Appetizer Table', price: 1000, limit: 1 },
  dessert: { name: 'Dessert Table Sponsor', level: 'Dessert Table', price: 1000, limit: 2 },
  flowers: { name: 'Flowers Sponsor', level: 'Flowers', price: 1000, limit: 2 },
};
export const TICKET_PRICE = 100, TABLE_PRICE = 1000;
// Regular dinner tickets open on their own at noon (Chicago) on Dec 15, 2026. Turning tickets on in the admin opens them sooner.
export const TICKETS_OPEN_AT = Date.parse('2026-12-15T18:00:00Z');
export const ticketsOpen = async (now = Date.now()) => now >= TICKETS_OPEN_AT || !!(await setting('tickets_on', false));
export const CHECK_ADDRESS = ['Called to Care', '15450 State Route 47', 'Newark, IL 60541'];

// ---------- responses ----------
const CORS = { 'content-type': 'application/json', 'cache-control': 'no-store' };
export const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: CORS });
export const fail = (msg, status = 400) => json({ ok: false, error: msg }, status);

// ---------- Supabase (service role, "site" schema) ----------
export async function db(path, { method = 'GET', body, prefer, schema = 'site' } = {}) {
  const url = env('SUPABASE_URL'), key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Database is not configured');
  const headers = { apikey: key, authorization: `Bearer ${key}`, 'accept-profile': schema, 'content-profile': schema, 'content-type': 'application/json' };
  if (prefer) headers.prefer = prefer;
  const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`Database ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
export const rpc = (fn, args = {}) => db(`rpc/${fn}`, { method: 'POST', body: args });

// Access level (0 none, 1 view, 2 notes, 3 edit) of the signed-in staff member calling a function from the admin.
export async function staffLevel(req, section) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token || !env('SUPABASE_URL')) return 0;
  const r = await fetch(`${env('SUPABASE_URL').replace(/\/$/, '')}/rest/v1/rpc/level_for`, {
    method: 'POST', headers: { apikey: env('SUPABASE_PUBLISHABLE_KEY') || env('SUPABASE_SERVICE_ROLE_KEY'), authorization: `Bearer ${token}`, 'content-profile': 'site', 'accept-profile': 'site', 'content-type': 'application/json' },
    body: JSON.stringify({ p_section: section }) }).catch(() => null);
  if (!r?.ok) return 0;
  return Number(await r.json()) || 0;
}

// ---------- input cleanup ----------
export const clean = (v, max = 500) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
export const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
export const digits = (p) => String(p || '').replace(/\D/g, '').slice(-10);
export const fmtPhone = (p) => { const d = digits(p); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : clean(p, 30); };
export const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Bots fill hidden fields and submit instantly.
export function looksLikeBot(body) {
  if (body?.website) return true;                         // hidden honeypot field
  const t = Number(body?.t || 0);
  if (t < 0) return -t < 2000;                            // newer pages send time on page (no clock needed)
  return t > 0 && Date.now() - t < 2500 && Date.now() - t > -60000;   // older pages: submitted < 2.5s after load
}

// ---------- contacts: one person per email, tags added (never removed) ----------
export async function upsertContact({ email, first, last, phone, street, city, state, zip, org, kind, tags = [], source = '' }) {
  email = clean(email, 200).toLowerCase();
  const fields = Object.fromEntries(Object.entries({
    first_name: clean(first, 80), last_name: clean(last, 80), phone: phone ? fmtPhone(phone) : '', street: clean(street, 200),
    city: clean(city, 80), state: clean(state, 2).toUpperCase(), zip: clean(zip, 10), org: clean(org, 150),
  }).filter(([, v]) => v));
  if (kind) fields.kind = kind;
  let row = email ? (await db(`contacts?select=id,tags&email=ilike.${encodeURIComponent(email)}&limit=1`))[0] : null;
  if (row) {
    const merged = [...new Set([...(row.tags || []), ...tags])];
    await db(`contacts?id=eq.${row.id}`, { method: 'PATCH', body: { ...fields, tags: merged } });
    return row.id;
  }
  const [created] = await db('contacts', { method: 'POST', prefer: 'return=representation', body: { email: email || null, ...fields, tags, source } });
  return created.id;
}

export async function setting(key, fallback) {
  try { const r = await db(`settings?key=eq.${encodeURIComponent(key)}&select=value`); return r[0] ? r[0].value : fallback; }
  catch { return fallback; }
}

// ---------- email (Resend) ----------
export async function sendEmail({ to, subject, html, template, contactId, replyTo, attachments }) {
  const key = env('RESEND_API_KEY');
  const from = env('EMAIL_FROM', 'We Are Called to Care <hello@wearecalledtocare.com>');
  if (!key) { console.log('[email skipped: no RESEND_API_KEY]', template, to); return null; }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html, reply_to: replyTo || env('EMAIL_REPLY_TO', 'shari@wearecalledtocare.com'), ...(attachments?.length ? { attachments } : {}) }),
  });
  const out = await r.json().catch(() => ({}));
  try { await db('email_log', { method: 'POST', body: { to_email: to, template, subject, contact_id: contactId || null, provider_id: out.id || null, status: r.ok ? 'sent' : 'failed' } }); } catch {}
  if (!r.ok) console.error('Resend error', r.status, JSON.stringify(out).slice(0, 300));
  return out.id || null;
}

// Branded email shell (same look as the email templates; tables + inline styles for every inbox).
const NAVY = '#1D4766', PINK = '#E2197A', SKY = '#B5CFDC', INK = '#2B3440', MUTED = '#5E6B78', LINE = '#E4E9EE';
const SERIF = "'Instrument Serif', Georgia, 'Times New Roman', serif", SANS = "Figtree, 'Helvetica Neue', Arial, sans-serif";
export function emailShell({ preheader = '', heading, bodyHtml, reason = "You're receiving this because you contacted We Are Called to Care." }) {
  const logo = `${SITE_URL()}/assets/logo-white.png`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting">
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Figtree:wght@400;600;700&display=swap" rel="stylesheet">
<style>@media (max-width:620px){.wrap{width:100%!important}.px{padding-left:24px!important;padding-right:24px!important}}</style></head>
<body style="margin:0;padding:0;background:#FBF8F4;">
<div style="display:none;max-height:0;overflow:hidden;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF8F4;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#fff;border-radius:14px;overflow:hidden;">
<tr><td align="center" style="background:${NAVY};padding:26px 24px 22px;"><img src="${logo}" width="210" alt="We Are Called to Care" style="display:block;width:210px;height:auto;border:0;color:#ffffff;font-family:Georgia,serif;font-size:22px;"></td></tr>
<tr><td class="px" style="padding:36px 44px 30px;">
<h1 style="margin:0 0 16px;font-family:${SERIF};font-weight:400;font-size:40px;line-height:44px;color:${NAVY};">${heading}</h1>
<div style="font-family:${SANS};font-size:16px;line-height:26px;color:${INK};">${bodyHtml}</div>
</td></tr>
<tr><td class="px" align="center" style="background:${NAVY};padding:26px 40px 30px;font-family:${SANS};font-size:12px;line-height:19px;color:#9fb6c7;">
<div style="font-family:${SERIF};font-style:italic;font-size:20px;color:#fff;margin-bottom:10px;">&ldquo;Let us love in deed and in truth.&rdquo; <span style="font-style:normal;font-size:12px;color:#F6C3DA;">1 John 3:18</span></div>
Called to Care &middot; 15450&#8203; State Route&#8203; 47 &middot; New&#8203;ark, IL 605&#8203;41<br>${esc(reason).replace(/wearecalledtocare\.com/g, 'wearecalled&#8203;tocare&#8203;.com')}<br>
<a href="${SITE_URL()}" style="color:${SKY};">wearecalledtocare.com</a></td></tr>
</table></td></tr></table></body></html>`;
}
export const p = (t) => `<p style="margin:0 0 14px;">${t}</p>`;
export const btn = (t, href) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;"><tr><td style="background:${PINK};border-radius:999px;"><a href="${href}" style="display:inline-block;padding:14px 28px;font-family:${SANS};font-size:15px;font-weight:700;color:#fff;text-decoration:none;">${t} &rarr;</a></td></tr></table>`;
export const box = (rows) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:12px;margin:6px 0 18px;">${rows.map(([k, v]) => `<tr><td style="padding:9px 18px;font-family:${SANS};font-size:14px;color:${MUTED};">${esc(k)}</td><td align="right" style="padding:9px 18px;font-family:${SANS};font-size:14px;color:${NAVY};font-weight:600;">${v}</td></tr>`).join('')}</table>`;

// Staff alert (plain and short).
export async function alertStaff(subject, lines, link, { skip = [], also = [] } = {}) {
  // One address, a comma-separated list, or a JSON list of addresses.
  const raw = await setting('staff_alert_email', 'shari@wearecalledtocare.com');
  const skipSet = new Set(skip.map((x) => String(x).trim().toLowerCase()));
  const list = [].concat(raw).flatMap((x) => String(x).split(',')).map((x) => x.trim()).filter(isEmail).filter((x) => !skipSet.has(x.toLowerCase()));
  for (const x of [].concat(also || []).flatMap((y) => String(y).split(',')).map((y) => y.trim()).filter(isEmail)) if (!list.some((y) => y.toLowerCase() === x.toLowerCase())) list.push(x);
  const html = emailShell({ heading: esc(subject), bodyHtml: lines.map((l) => p(l)).join('') + (link ? btn('Open in admin', link) : ''), reason: 'Staff notification from the Called to Care website.' });
  for (const to of list) await sendEmail({ to, subject: `[Website] ${subject}`, html, template: 'staff-alert' });
}

// ---------- after a payment succeeds (Stripe webhook or PayPal capture) ----------
// Idempotent: does nothing if this payment was already finalized.
export async function finalizePayment(payment, { method } = {}) {
  if (!payment || payment.status === 'succeeded' && payment.receipt_sent_at) return;
  const meta = payment.meta || {};
  const receipt = payment.receipt_no || (await rpc('next_receipt'));
  await db(`payments?id=eq.${payment.id}`, { method: 'PATCH', body: { status: 'succeeded', paid_at: new Date().toISOString(), receipt_no: receipt, ...(method ? { method } : {}) } });

  if (payment.purpose === 'sponsorship' && payment.contact_id) {
    const lv = SPONSOR_LEVELS[meta.item] || {};
    await db('sponsorships', { method: 'POST', body: {
      contact_id: payment.contact_id, year: DINNER_YEAR, sponsor_name: meta.display_name || meta.name || '', level: lv.level || meta.item || '',
      amount: payment.amount, status: 'Paid in Full', received: payment.amount, method: method || payment.method || payment.provider,
      source: 'Website', program_name: meta.display_name || '', notes: meta.guests ? `Guest names: ${meta.guests}` : '' } });
  }
  if ((payment.purpose === 'tickets' || payment.purpose === 'table') && payment.contact_id) {
    await db('attendance?on_conflict=contact_id,year', { method: 'POST', prefer: 'resolution=merge-duplicates', body: {
      contact_id: payment.contact_id, year: DINNER_YEAR, present: false, ticket_type: payment.purpose === 'table' ? 'Table of 10' : 'Tickets',
      guests: Number(meta.qty || (payment.purpose === 'table' ? 10 : 1)), source: 'Website' } });
  }
  if (meta.basket_id) {   // a donor basket: mark it given on the Charity Dinner page
    await db(`baskets?id=eq.${meta.basket_id}`, { method: 'PATCH', body: { claimed_at: new Date().toISOString(), claimed_payment: payment.id,
      claimed_contact: payment.contact_id, claimed_name: meta.display_name || '', held_until: null, updated_at: new Date().toISOString() } }).catch((e) => console.error('basket', e.message));
  }
  const c = payment.contact_id ? (await db(`contacts?id=eq.${payment.contact_id}&select=email,first_name`))[0] : null;
  if (c?.email) {
    const org = await setting('org', { legal_name: 'We Are Called to Care, NFP', ein: '86-2900453' });
    const what = payment.description || 'Your gift';
    const goods = (payment.purpose === 'tickets' || payment.purpose === 'table')
      ? 'Dinner tickets include a meal; please ask us for the deductible amount for your records.'
      : 'No goods or services were provided in exchange for this gift.';
    const html = emailShell({
      preheader: 'Your receipt is inside.',
      heading: `Thank you, ${esc(c.first_name || 'friend')}.`,
      bodyHtml: p(meta.basket_id ? 'Thank you for giving an auction basket! Your gift fills the basket for the Charity Dinner auction, and every dollar raised goes to foster and adoptive families.'
               : payment.purpose === 'donation' ? 'Your gift goes straight to work for foster and adoptive families. We are so grateful you are in this with us.'
               : payment.purpose === 'sponsorship' ? `Thank you for sponsoring the ${DINNER_YEAR} Charity Dinner &amp; Auction. Shari will be in touch about your signage and program listing.`
               : `You're all set for the ${DINNER_YEAR} Charity Dinner &amp; Auction. We can't wait to see you.`)
        + box([['For', esc(what)], ['Amount', money(payment.amount)], ['Date', new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })], ['Paid with', esc(method || payment.method || payment.provider)], ['Receipt #', esc(receipt)]])
        + `<p style="margin:0;font-size:12px;line-height:18px;color:${MUTED};">${esc(org.legal_name)} is a 501(c)(3) nonprofit, EIN ${esc(org.ein)}. ${goods} Please keep this receipt for your tax records.</p>`,
      reason: 'You are receiving this receipt because you made a payment to We Are Called to Care.',
    });
    await sendEmail({ to: c.email, subject: 'Your receipt from We Are Called to Care', html, template: `receipt-${payment.purpose}`, contactId: payment.contact_id });
    await db(`payments?id=eq.${payment.id}`, { method: 'PATCH', body: { receipt_sent_at: new Date().toISOString() } });
  }
  // Donations: the people who get thank-you letters (Shari) don't also get the plain alert; everyone else still does.
  let skip = [];
  if (payment.purpose === 'donation') {
    const L = await import('./_letter.mjs');
    await L.donorLetterOnGift({ ...payment, status: 'succeeded', receipt_no: receipt, paid_at: new Date().toISOString() });
    skip = (await L.letterSettings().catch(() => ({ recipients: [] }))).recipients;
  }
  await alertStaff(`New ${payment.purpose}: ${money(payment.amount)}`, [esc(payment.description), `From: ${esc(c?.email || '')}`], `${SITE_URL()}/admin/#payments`, { skip }).catch(() => {});
}
