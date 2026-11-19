// Sponsor follow-up shared by the checkout, the admin and the sponsor's own guest-names page:
//   askGuests()      emails the sponsor a private link to tell us who is sitting in their seats
//   sponsorLetter()  emails Shari the thank-you letter for a sponsorship that has no website payment (a check, say)
import { db, sendEmail, emailShell, p, btn, esc, isEmail, sponsorLevel, SITE_URL } from './_lib.mjs';
import { emailLetter, letterValues } from './_letter.mjs';

export const guestsUrl = (token) => `${SITE_URL()}/sponsor-guests?t=${token}`;
export const nameList = (text) => String(text || '').split(/\r?\n/).map((x) => x.replace(/\s+/g, ' ').trim().slice(0, 80)).filter(Boolean);

// Ask the sponsor for their guests' names. Returns { sent, reason }.
export async function askGuests(sp, { again = false } = {}) {
  const lv = sponsorLevel(sp.level); const seats = lv ? lv.seats : 0;
  if (!seats) return { sent: false, reason: 'This level does not come with dinner seats.' };
  if (!sp.guest_token) return { sent: false, reason: 'Run sponsor-guests.sql in Supabase first.' };
  const [c] = await db(`contacts?id=eq.${sp.contact_id}&select=email,first_name,salutation`);
  if (!c || !isEmail(c.email)) return { sent: false, reason: 'There is no email address on file for this sponsor.' };
  const v = await letterValues(); const first = (c.salutation || c.first_name || '').trim() || 'Friend';
  const have = nameList(sp.guest_names).length;
  const html = emailShell({
    preheader: `Your ${lv.name.replace(/ Sponsor$/, '')} sponsorship includes ${lv.seating}. Tell us who is coming.`,
    heading: again ? 'A quick reminder: your dinner guests' : 'Who is joining you at the dinner?',
    bodyHtml: p(`Hi ${esc(first)},`)
      + p(`Thank you again for being ${/^[aeiou]/i.test(lv.name) ? 'an' : 'a'} <b>${esc(lv.name)}</b> of our ${esc(String(sp.year))} Charity Dinner &amp; Auction${v.dinner_date ? ` on <b>${esc(v.dinner_date)}</b>` : ''}. Your sponsorship includes <b>${esc(lv.seating)}</b>.`)
      + p(`So we can have name cards and seats ready, please tell us the ${seats === 1 ? 'name of your guest' : `names of your ${seats} guests`}${have ? ` (we have ${have} so far)` : ''}. Count yourself if you are coming.`)
      + btn(have ? 'Finish Your Guest List' : 'Add Your Guest Names', guestsUrl(sp.guest_token))
      + p(`<span style="font-size:14px;color:#5E6B78">Not sure of everyone yet? Add the names you know and come back to the same link anytime to finish or change them. You can also just reply to this email.</span>`),
    reason: `You're receiving this because ${esc(sp.sponsor_name || 'you')} sponsored the Charity Dinner & Auction.`,
  });
  await sendEmail({ to: c.email, subject: again ? 'Reminder: your Charity Dinner guest names' : 'Your Charity Dinner guests: who is coming?', html, template: 'sponsor-guests', contactId: sp.contact_id });
  await db(`sponsorships?id=eq.${sp.id}`, { method: 'PATCH', body: { guests_asked_at: new Date().toISOString() } });
  return { sent: true, to: c.email, seats };
}

// The thank-you letter for a sponsorship entered by staff. It reuses the payment letter with the sponsorship's own details.
export async function sponsorLetter(sp, { again = false } = {}) {
  const lv = sponsorLevel(sp.level);
  return emailLetter({ id: null, contact_id: sp.contact_id, amount: sp.amount, purpose: 'sponsorship', designation: '', paid_at: new Date().toISOString(),
    description: `${sp.year} Charity Dinner: ${lv ? lv.name : `${sp.level} Sponsor`}`, meta: { display_name: sp.sponsor_name || '' } }, { kind: 'sponsorship', again });
}
