// Printed thank-you letters for donors. When a gift comes in, the letter (PDF) is emailed to Shari
// (and anyone else listed in Settings) to print, sign, fold, and mail in a #10 single-window envelope.
// Monthly partners get a letter with their first gift, then again every 2 to 5 months (picked at random).
import { db, setting, sendEmail, emailShell, p, box, esc, money, isEmail, DINNER_YEAR } from './_lib.mjs';
import { PDF, wrap, textWidth } from './_pdf.mjs';
import { LOGO } from './_letterlogo.mjs';

const NAVY = '#1D4766', PINK = '#E2197A', INK = '#2B3440', MUTED = '#6B7785', SKY = '#B5CFDC';
const IN = 72;
const logoJpeg = Buffer.from(LOGO.b64, 'base64');

export const DEFAULT_UPDATES = [
  { title: 'Support Night', text: 'Foster and adoptive moms gather the first Thursday of every month to connect, share, and learn together, with childcare on site. Our next Support Night is {next_support_night}.', on: true, until: '' },
  { title: 'Christmas for kids in care', text: 'We are gathering Christmas presents so every child in our foster families has something special to open this year.', on: true, until: '2026-12-31' },
  { title: 'The Care Closet', text: 'When a child arrives in a new home, often with very little, a Called to Care bag shows up at the door with clothes and essentials. Our Amazon wish list keeps those shelves stocked.', on: true, until: '' },
  { title: 'Charity Dinner & Auction', text: 'Our 6th annual dinner is {dinner_date} at Whitetail Ridge Golf Club. We would love to see you there!', on: true, until: '' },
];
export const DEFAULT_SIGNER = { name: 'Shari Chapman', title: 'Executive Director' };
export const DEFAULT_RECIPIENTS = ['shari@wearecalledtocare.com'];

const chicagoDay = (d = new Date()) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });   // YYYY-MM-DD
const longDate = (d = new Date()) => new Date(d).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'long', day: 'numeric', year: 'numeric' });
const eventDay = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'long', day: 'numeric' });

export async function letterSettings() {
  const [recips, signer, updates] = await Promise.all([setting('letter_emails', DEFAULT_RECIPIENTS), setting('letter_signer', DEFAULT_SIGNER), setting('letter_updates', DEFAULT_UPDATES)]);
  return {
    recipients: [].concat(recips || []).flatMap((x) => String(x).split(',')).map((x) => x.trim().toLowerCase()).filter(isEmail),
    signer: { ...DEFAULT_SIGNER, ...(signer || {}) },
    updates: Array.isArray(updates) ? updates : DEFAULT_UPDATES,
  };
}

// Fill in {next_support_night} and {dinner_date}; drop a sentence whose date isn't known yet; skip hidden or expired items.
export async function letterValues(now = new Date()) {
  let events = [];
  try { events = await db(`events?starts_at=gte.${encodeURIComponent(now.toISOString())}&select=kind,starts_at&order=starts_at`); } catch {}
  const sn = events.find((e) => e.kind === 'support_night'), dn = events.find((e) => e.kind === 'dinner');
  return { next_support_night: sn ? eventDay(sn.starts_at) : '', dinner_date: dn ? eventDay(dn.starts_at) + ', ' + new Date(dn.starts_at).getFullYear() : (now < new Date('2027-03-14') ? 'Saturday, March 13, 2027' : '') };
}
export async function resolveUpdates(updates, now = new Date()) {
  const vals = await letterValues(now);
  const today = chicagoDay(now);
  return (updates || []).filter((u) => u && u.on !== false && String(u.text || '').trim() && (!u.until || u.until >= today)).map((u) => {
    const sentences = String(u.text).trim().split(/(?<=[.!?])\s+/);
    const text = sentences.filter((s) => [...s.matchAll(/\{(\w+)\}/g)].every((m) => vals[m[1]])).join(' ').replace(/\{(\w+)\}/g, (_, k) => vals[k]);
    return { title: String(u.title || '').trim(), text };
  }).filter((u) => u.text);
}

// Name and address lines for the envelope window
export function addressLines(c = {}) {
  const person = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
  const biz = ['business', 'church', 'foundation'].includes(c.kind) && c.org;
  const lines = biz ? [c.org, person ? `Attn: ${person}` : ''] : [c.household || person || c.org || ''];
  const cityLine = [c.city, [c.state, c.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return { lines: [...lines, c.street, cityLine].map((x) => String(x || '').trim()).filter(Boolean), hasAddress: !!(c.street && c.city && c.zip) };
}

// kind: 'one-time' | 'monthly-first' | 'monthly'
// Letterhead, fold marks, date, the address in the envelope window, and the footer. Shared by every letter.
function drawFrame(doc, { contact = {}, date = new Date(), sample = false }) {
  const L = IN, R = 8.5 * IN - IN;
  // Letterhead
  const lw = 2.35 * IN, lh = lw * LOGO.h / LOGO.w;
  doc.image(logoJpeg, LOGO.w, LOGO.h, L, 0.55 * IN, lw, lh);
  [['15450 State Route 47', 0.72], ['Newark, IL 60541', 0.87], ['wearecalledtocare.com', 1.02]].forEach(([t, y]) => doc.text(R, y * IN, t, { font: 'Helvetica', size: 8.5, color: MUTED, align: 'right' }));
  doc.line(L, 1.28 * IN, R, 1.28 * IN, { color: PINK, width: 1.2 });

  // Fold marks (light ticks at the left edge, at each third of the page)
  [11 / 3, 22 / 3].forEach((y) => doc.line(0.18 * IN, y * IN, 0.38 * IN, y * IN, { color: '#C9D2DA', width: 0.5 }));

  // Date, then the address where the #10 envelope window falls (about 2¼" down, 1" in)
  doc.text(L, 1.72 * IN, longDate(date), { size: 11, color: INK });
  const addr = addressLines(contact);
  let y = 2.42 * IN;
  addr.lines.slice(0, 5).forEach((t) => { doc.text(L, y, t, { size: 11.5, color: INK }); y += 14; });
  // Footer
  doc.line(L, 10.32 * IN, R, 10.32 * IN, { color: SKY, width: 0.6 });
  doc.text(4.25 * IN, 10.52 * IN, '“Let us love in deed and in truth.”  1 John 3:18', { font: 'Times-Italic', size: 9.5, color: NAVY, align: 'center' });
  doc.text(4.25 * IN, 10.7 * IN, 'We Are Called to Care, NFP is a 501(c)(3) nonprofit, EIN 86-2900453.', { font: 'Helvetica', size: 7.5, color: MUTED, align: 'center' });
  if (sample) doc.text(R, 0.35 * IN, 'SAMPLE', { font: 'Helvetica-Bold', size: 9, color: PINK, align: 'right', spacing: 2 });
}

export function buildLetterPdf({ contact = {}, amount, designation = '', kind = 'one-time', updates = [], signer = DEFAULT_SIGNER, date = new Date(), sample = false }) {
  const doc = new PDF();
  const L = IN, R = 8.5 * IN - IN, W = R - L;
  drawFrame(doc, { contact, date, sample });

  // Letter body
  const first = (contact.salutation || contact.first_name || '').trim();
  const gift = money(amount);
  const d = String(designation || '').replace(/^Monthly gift:\s*/i, '').trim();
  const fund = d && !/where needed most/i.test(d) ? ` for ${/^the\s/i.test(d) || !/closet|dinner|auction|fund|program/i.test(d) ? d : 'the ' + d}` : '';
  const opening = kind === 'monthly-first'
    ? `Thank you so much for becoming a monthly partner with Called to Care. Your gift of ${gift} every month${fund} means the world to us, and even more to the foster, adoptive, and kinship families we walk alongside.`
    : kind === 'monthly'
      ? `Thank you for your faithful monthly gift of ${gift}${fund}. Month after month, your support means the world to us, and even more to the foster, adoptive, and kinship families we walk alongside.`
      : `Thank you so much for your generous gift of ${gift}${fund}. Your support means the world to us, and even more to the foster, adoptive, and kinship families we walk alongside.`;
  const closing = 'Because of friends like you, families who say yes to children in need never have to do it alone. Thank you for loving in deed and in truth.';

  // Fit everything on one page: try full size, then fewer updates, then slightly smaller type.
  const bottom = 9.95 * IN;
  const plan = (size, items) => {
    const lead = size * 1.42; const ops = []; let yy = 3.98 * IN;
    const para = (t, opts = {}) => { wrap(t, opts.font || 'Times-Roman', size, W - (opts.indent || 0)).forEach((ln) => { ops.push(['t', L + (opts.indent || 0), yy, ln, opts.font || 'Times-Roman', size]); yy += lead; }); yy += lead * 0.45; };
    ops.push(['t', L, yy, `Dear ${first || 'Friend'},`, 'Times-Roman', size]); yy += lead * 1.45;
    para(opening);
    if (items.length) {
      para('Here is a little of what your generosity has been part of lately:');
      yy -= lead * 0.15;
      items.forEach((u) => {
        const ind = 16; const lines = wrap((u.title ? u.title + ': ' : '') + u.text, 'Times-Roman', size, W - ind);
        ops.push(['dot', L + 5, yy - size * 0.32]);
        lines.forEach((ln, i) => {
          if (i === 0 && u.title && ln.startsWith(u.title + ':')) { ops.push(['t', L + ind, yy, u.title + ':', 'Times-Bold', size]); ops.push(['t', L + ind + textWidth(u.title + ': ', 'Times-Bold', size), yy, ln.slice(u.title.length + 2), 'Times-Roman', size]); }
          else ops.push(['t', L + ind, yy, ln, 'Times-Roman', size]);
          yy += lead;
        });
        yy += lead * 0.3;
      });
      yy += lead * 0.2;
    }
    para(closing);
    ops.push(['t', L, yy, 'With gratitude,', 'Times-Roman', size]); yy += 0.62 * IN;   // room to sign
    ops.push(['t', L, yy, signer.name, 'Times-Bold', size]); yy += lead;
    ops.push(['t', L, yy, signer.title, 'Times-Italic', size]);
    return { ops, end: yy };
  };
  let chosen = null;
  for (const size of [11.5, 11, 10.5]) {
    for (let n = Math.min(updates.length, 4); n >= 0 && !chosen; n--) { const r = plan(size, updates.slice(0, n)); if (r.end <= bottom) chosen = r; }
    if (chosen) break;
  }
  chosen = chosen || plan(10, updates.slice(0, 1));
  for (const o of chosen.ops) {
    if (o[0] === 't') doc.text(o[1], o[2], o[3], { font: o[4], size: o[5], color: INK });
    else doc.circle(o[1], o[2], 2.2, { fill: PINK });
  }
  return doc.build({ title: 'Thank you from Called to Care', author: 'We Are Called to Care' });
}

// Is a letter due for this payment? One-time gifts: always. Monthly: first gift, then every 2-5 months.
export async function letterKind(payment) {
  if (!payment.recurring) return 'one-time';
  const prev = await db(`donor_letters?contact_id=eq.${payment.contact_id}&recurring=eq.true&select=created_at,next_after&order=created_at.desc&limit=1`);
  if (!prev.length) return 'monthly-first';
  return chicagoDay() >= prev[0].next_after ? 'monthly' : null;
}
const nextAfter = (from = new Date()) => { const d = new Date(from); d.setMonth(d.getMonth() + 2 + Math.floor(Math.random() * 4)); return chicagoDay(d); };   // 2, 3, 4, or 5 months

export async function makeLetterFor(payment, { kind } = {}) {
  const [c] = payment.contact_id ? await db(`contacts?id=eq.${payment.contact_id}&select=*`) : [{}];
  const s = await letterSettings();
  const k = kind || (payment.recurring ? 'monthly' : 'one-time');
  const pdf = buildLetterPdf({ contact: c || {}, amount: payment.amount, designation: payment.designation, kind: k, updates: await resolveUpdates(s.updates), signer: s.signer, date: payment.paid_at || new Date() });
  return { pdf, contact: c || {}, settings: s, kind: k };
}

const fileName = (c) => `Thank-you letter - ${[c.first_name, c.last_name].filter(Boolean).join(' ') || c.org || 'donor'}.pdf`.replace(/[\\/:*?"<>|]/g, '');

// Email the letter to Shari (and the other letter recipients). Returns the addresses it went to.
export async function emailLetter(payment, { kind, again = false } = {}) {
  const { pdf, contact: c, settings: s, kind: k } = await makeLetterFor(payment, { kind });
  if (!s.recipients.length) return [];
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.org || c.email || 'a donor';
  const addr = addressLines(c);
  const giftType = k === 'monthly-first' ? 'Monthly (first gift)' : k === 'monthly' ? 'Monthly' : 'One-time';
  const html = emailShell({
    preheader: `${money(payment.amount)} from ${name}. The thank-you letter is attached, ready to print and sign.`,
    heading: `New donation from ${esc(name)}`,
    bodyHtml: p(`A thank-you letter is attached and ready to <b>print, sign, and mail</b>.`)
      + box([['Donor', esc(name)], ['Amount', money(payment.amount)], ['Gift', giftType], ['Fund', esc(payment.designation || 'Where needed most')], ['Date', longDate(payment.paid_at || new Date())], ['Email', esc(c.email || '—')],
        ['Mailing address', addr.hasAddress ? addr.lines.slice(1).map(esc).join('<br>') : '<span style="color:#E2197A">Not on file</span>']])
      + (addr.hasAddress
        ? p(`<span style="font-size:14px;color:#5E6B78">Fold the letter in thirds (the small marks on the left edge show where) and slip it into a standard #10 single-window envelope. The address lines up with the window.</span>`)
        : p(`<span style="font-size:14px;color:#5E6B78">We don't have a mailing address for this donor yet. Add it to their contact in the admin, then open the gift under Donations and choose <b>Thank-You Letter</b> to print an updated copy.</span>`)),
    reason: 'Staff notification from the Called to Care website.',
  });
  const subject = `${again ? 'Letter again: ' : 'New donation: '}${name}, ${money(payment.amount)}`;
  const attachments = [{ filename: fileName(c), content: pdf.toString('base64') }];
  for (const to of s.recipients) await sendEmail({ to, subject, html, template: 'donor-letter', contactId: payment.contact_id, attachments });
  return s.recipients;
}

// Called once when a donation succeeds (from finalizePayment). Never throws.
export async function donorLetterOnGift(payment) {
  try {
    if (payment.purpose !== 'donation') return;
    if ((await db(`donor_letters?payment_id=eq.${payment.id}&select=id`)).length) return;   // already done
    const kind = await letterKind(payment);
    if (!kind) return;                                                                     // monthly gift, not this month
    const sentTo = await emailLetter(payment, { kind });
    await db('donor_letters', { method: 'POST', body: { payment_id: payment.id, contact_id: payment.contact_id, recurring: !!payment.recurring, kind,
      next_after: payment.recurring ? nextAfter() : null, sent_to: sentTo } });
  } catch (e) { console.error('donor letter', e.message); }
}

// ---------------- Sponsor thank-you letters (from the admin, many at once) ----------------
export const DEFAULT_SPONSOR_LETTER = {
  paragraphs: [
    'Thank you so much for sponsoring our Charity Dinner & Auction in {years}. Your generosity means the world to us, and even more to the foster, adoptive, and kinship families we walk alongside.',
    'Because of sponsors like you, families who say yes to children in need never have to do it alone. Your support helps make Support Nights for foster and adoptive moms, Care Closet bags for children arriving in new homes, camp scholarships, and Christmas gifts for kids in care possible.',
    'We are so excited about our 6th annual Charity Dinner & Auction on {dinner_date} at Whitetail Ridge Golf Club in Yorkville. We would be honored to have you with us again as a sponsor this year. You can see this year\'s sponsor options at wearecalledtocare.com, or simply reach out and I will be glad to help.',
  ],
  closing: 'With gratitude,',
};
export async function sponsorLetterSettings() {
  const [t, signer] = await Promise.all([setting('sponsor_letter', DEFAULT_SPONSOR_LETTER), setting('letter_signer', DEFAULT_SIGNER)]);
  // Sponsor letters have their own signer (set in Sponsors & Guests); until one is saved, use the donor-letter signer.
  const own = t && t.signer && t.signer.name ? t.signer : null;
  return { text: { ...DEFAULT_SPONSOR_LETTER, ...(t || {}) }, signer: { ...DEFAULT_SIGNER, ...(own || signer || {}) } };
}
export const listYears = (ys) => { const y = [...new Set(ys)].sort(); return y.length < 2 ? y.join('') : y.length === 2 ? `${y[0]} and ${y[1]}` : `${y.slice(0, -1).join(', ')}, and ${y[y.length - 1]}`; };
const COUNTS = ['Committed', 'Invoiced', 'Partially Paid', 'Paid in Full'];
export const sponsorYears = (spons) => spons.filter((s) => COUNTS.includes(s.status) && s.year < DINNER_YEAR).map((s) => s.year);

function greeting(c) {
  const biz = ['business', 'church', 'foundation'].includes(c.kind) && c.org;
  const name = String(c.salutation || c.first_name || '').trim();
  return name ? `Dear ${name},` : biz ? `Dear Friends at ${c.org},` : 'Dear Friend,';
}
function fillIn(t, vals) {
  let s = String(t || '');
  if (!vals.years) s = s.replace(/\s*(?:in|during|for)?\s*\{years\}/gi, '');
  if (!vals.dinner_date) s = s.replace(/\s*on \{dinner_date\}/gi, '');
  return s.replace(/\{(\w+)\}/g, (m, k) => vals[k] ?? '').replace(/\s+([.,!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

// letters: [{ contact, years: [2025, 2026] }] -> one PDF, one page per sponsor
export function buildSponsorLetters({ letters, text = DEFAULT_SPONSOR_LETTER, signer = DEFAULT_SIGNER, values = {}, date = new Date(), sample = false }) {
  const doc = new PDF();
  const L = IN, R = 8.5 * IN - IN, W = R - L, bottom = 9.95 * IN;
  letters.forEach((lt, i) => {
    if (i) doc.addPage();
    const c = lt.contact || {};
    drawFrame(doc, { contact: c, date, sample });
    const vals = { ...values, years: listYears(lt.years || []), organization: c.org || '', first_name: c.first_name || '' };
    const paras = (text.paragraphs || []).map((t) => fillIn(t, vals)).filter(Boolean);
    const plan = (size) => {
      const lead = size * 1.45, ops = []; let y = 3.98 * IN;
      ops.push([L, y, greeting(c), 'Times-Roman']); y += lead * 1.45;
      paras.forEach((t) => { wrap(t, 'Times-Roman', size, W).forEach((ln) => { ops.push([L, y, ln, 'Times-Roman']); y += lead; }); y += lead * 0.5; });
      ops.push([L, y, text.closing || 'With gratitude,', 'Times-Roman']); y += 0.62 * IN;
      ops.push([L, y, signer.name, 'Times-Bold']); y += lead;
      ops.push([L, y, signer.title, 'Times-Italic']);
      return { ops, end: y, size };
    };
    let pick = null;
    for (const size of [11.5, 11, 10.5, 10, 9.5]) { const r = plan(size); if (r.end <= bottom || size === 9.5) { pick = r; break; } }
    pick.ops.forEach(([x, y, t, font]) => doc.text(x, y, t, { font, size: pick.size, color: INK }));
  });
  return doc.build({ title: 'Sponsor thank-you letters', author: 'We Are Called to Care' });
}
