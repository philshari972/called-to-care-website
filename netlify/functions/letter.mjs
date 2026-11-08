// Thank-you letters from the admin (needs a signed-in staff member):
//   POST { action: 'pdf', payment_id }    -> the letter for that gift (PDF)          (Donations: view)
//   POST { action: 'email', payment_id }  -> email it to the letter recipients again  (Donations: edit)
//   POST { action: 'sample' }             -> a sample letter using the current updates (Donations: view)
import { db, json, fail, staffLevel } from './_lib.mjs';
import { makeLetterFor, emailLetter, buildLetterPdf, letterSettings, resolveUpdates } from './_letter.mjs';

const pdfResponse = (buf, name) => new Response(buf, { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${name}"`, 'cache-control': 'no-store' } });

export default async (req) => {
  if (req.method !== 'POST') return fail('Use POST', 405);
  let b; try { b = await req.json(); } catch { return fail('Invalid request'); }
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
