// Sponsor follow-up from the admin (needs a staff member who can edit Sponsors & Guests):
//   POST { action: 'kickoff', sponsorship_id, letter: true, guests: true }
//        -> for a sponsorship staff just entered (a check, say): email Shari the thank-you letter and/or
//           email the sponsor asking for their guests' names
//   POST { action: 'letter', sponsorship_id }      -> just the letter to Shari
//   POST { action: 'ask-guests', sponsorship_id }  -> just the guest-names request (a reminder if already asked)
import { db, json, fail, staffLevel } from './_lib.mjs';
import { askGuests, sponsorLetter } from './_sponsor.mjs';

export default async (req) => {
  if (req.method !== 'POST') return fail('Use POST', 405);
  let b; try { b = await req.json(); } catch { return fail('Invalid request'); }
  if ((await staffLevel(req, 'sponsors')) < 3) return fail('You need edit access to Sponsors & Guests.', 403);
  if (!/^[0-9a-f-]{36}$/i.test(b.sponsorship_id || '')) return fail('Unknown sponsorship');
  try {
    const [sp] = await db(`sponsorships?id=eq.${b.sponsorship_id}&select=*`);
    if (!sp) return fail('Sponsorship not found', 404);
    const out = { ok: true };
    const wantLetter = b.action === 'letter' || (b.action === 'kickoff' && b.letter !== false);
    const wantGuests = b.action === 'ask-guests' || (b.action === 'kickoff' && b.guests !== false);
    if (!wantLetter && !wantGuests) return fail('Unknown request');
    if (wantLetter) {
      try { const to = await sponsorLetter(sp, { again: b.action === 'letter' && !!b.again }); out.letter = to.length ? { sent: true, to } : { sent: false, reason: 'Add at least one letter email in Settings first.' }; }
      catch (e) { console.error('sponsor letter', e.message); out.letter = { sent: false, reason: 'The letter could not be made.' }; }
    }
    if (wantGuests) {
      try { out.guests = await askGuests(sp, { again: !!sp.guests_asked_at }); }
      catch (e) { console.error('sponsor guests', e.message); out.guests = { sent: false, reason: /guests_asked_at|guest_token|column/i.test(e.message) ? 'Run sponsor-guests.sql in Supabase first.' : 'The email could not be sent.' }; }
    }
    return json(out);
  } catch (e) { console.error('sponsor', e.message); return fail('Something went wrong. Try again in a moment.', 500); }
};
