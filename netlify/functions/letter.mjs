// Thank-you letters from the admin (needs a signed-in staff member):
//   POST { action: 'pdf', payment_id }    -> the letter for that gift (PDF)          (Donations: view)
//   POST { action: 'email', payment_id }  -> email it to the letter recipients again  (Donations: edit)
//   POST { action: 'sample' }             -> a sample letter using the current updates (Donations: view)
//   POST { action: 'sponsors', contact_ids, text?, skip_no_address?, sample? }
//                                          -> sponsor thank-you letters, one page each, in one PDF (Sponsors & Guests: view)
import { db, json, fail, staffLevel } from './_lib.mjs';
import { makeLetterFor, emailLetter, buildLetterPdf, letterSettings, resolveUpdates, buildSponsorLetters, sponsorLetterSettings, sponsorYears, letterValues, addressLines } from './_letter.mjs';

const pdfResponse = (buf, name) => new Response(buf, { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${name}"`, 'cache-control': 'no-store' } });

export default async (req) => {
  if (req.method !== 'POST') return fail('Use POST', 405);
  let b; try { b = await req.json(); } catch { return fail('Invalid request'); }
  if (b.action === 'sponsors') return sponsorLetters(req, b);
  const level = Math.max(await staffLevel(req, 'donations'), await staffLevel(req, 'payments'));
  if (level < 1) return fail('You need access to Donations.', 403);
  try {
    if (b.action === 'sample') {
      const s = await letterSettings();
      const updates = Array.isArray(b.updates) ? b.updates : s.updates;   // preview unsaved edits
      const signer = b.signer && b.signer.name ? b.signer : s.signer;
      const pdf = buildLetterPdf({ sample: true, amount: 100, kind: 'one-time', signer, updates: await resolveUpdates(updates),
        contact: { first_name: 'Jane', last_name: 'Smith', street: '123 Main Street', city: 'Plano', state: 'IL', zip: '60545' } });
      return pdfResponse(pdf, 'Sample thank-you letter.pdf');
    }
    if (!/^[0-9a-f-]{36}$/.test(b.payment_id || '')) return fail('Unknown gift');
    const [pay] = await db(`payments?id=eq.${b.payment_id}&select=*`);
    if (!pay || pay.purpose !== 'donation') return fail('Gift not found', 404);
    const [prev] = await db(`donor_letters?payment_id=eq.${pay.id}&select=kind`);
    const kind = prev?.kind || (pay.recurring ? 'monthly' : 'one-time');
    if (b.action === 'pdf') { const { pdf } = await makeLetterFor(pay, { kind }); return pdfResponse(pdf, 'Thank-you letter.pdf'); }
    if (b.action === 'email') {
      if (level < 3) return fail('You need edit access to Donations.', 403);
      const to = await emailLetter(pay, { kind, again: true });
      if (!to.length) return fail('Add at least one letter email in Settings first.');
      return json({ ok: true, to });
    }
    return fail('Unknown request');
  } catch (e) { console.error('letter', e.message); return fail('Could not make the letter: ' + e.message, 500); }
};

const cleanText = (t) => ({ paragraphs: (Array.isArray(t?.paragraphs) ? t.paragraphs : []).map((x) => String(x || '').slice(0, 1500)).filter((x) => x.trim()).slice(0, 6),
  closing: String(t?.closing || 'With gratitude,').slice(0, 60) });
const sortName = (c) => (['business', 'church', 'foundation'].includes(c.kind) && c.org ? c.org : `${c.last_name} ${c.first_name}`).toLowerCase();

async function sponsorLetters(req, b) {
  if ((await staffLevel(req, 'sponsors')) < 1) return fail('You need access to Sponsors & Guests.', 403);
  try {
    const s = await sponsorLetterSettings();
    const text = b.text && Array.isArray(b.text.paragraphs) ? cleanText(b.text) : s.text;
    const signer = b.text && b.text.signer && String(b.text.signer.name || '').trim()
      ? { name: String(b.text.signer.name).trim().slice(0, 80), title: String(b.text.signer.title || '').trim().slice(0, 80) } : s.signer;
    const values = await letterValues();
    let letters;
    if (b.sample) {
      letters = [{ contact: { kind: 'business', org: 'Sample Company', first_name: 'Jane', last_name: 'Smith', street: '123 Main Street', city: 'Plano', state: 'IL', zip: '60545' }, years: [2025, 2026] }];
    } else {
      const ids = [...new Set((b.contact_ids || []).filter((x) => /^[0-9a-f-]{36}$/.test(x)))].slice(0, 600);
      if (!ids.length) return fail('Choose at least one sponsor.');
      const contacts = [], spons = [];
      for (let i = 0; i < ids.length; i += 60) {
        const part = ids.slice(i, i + 60).join(',');
        const [cs, ss] = await Promise.all([db(`contacts?id=in.(${part})&select=*`), db(`sponsorships?contact_id=in.(${part})&select=contact_id,year,status`)]);
        contacts.push(...cs); spons.push(...ss);
      }
      letters = contacts.sort((x, y) => sortName(x).localeCompare(sortName(y)))
        .filter((c) => !b.skip_no_address || addressLines(c).hasAddress)
        .map((c) => ({ contact: c, years: sponsorYears(spons.filter((x) => x.contact_id === c.id)) }));
      if (!letters.length) return fail('None of these sponsors has a mailing address yet.');
    }
    const pdf = buildSponsorLetters({ letters, text, signer, values, sample: !!b.sample });
    return new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="Sponsor letters.pdf"`, 'cache-control': 'no-store', 'x-letters': String(letters.length) } });
  } catch (e) { console.error('sponsor letters', e.message); return fail('Could not make the letters: ' + e.message, 500); }
}
