// Runs every morning. One week after camp ends, if the family hasn't sent a recap, email them once.
import { db } from './_lib.mjs';
import { sendFollowup, newToken, patchAdmin } from './_camp.mjs';

export const config = { schedule: '0 15 * * *' };   // 15:00 UTC = 9 or 10 AM in Illinois

export async function run(today = new Date()) {
  const apps = await db(`submissions?form=eq.camp&status=in.(Approved,Funded)&select=*`);
  const cutoff = new Date(today.getTime() - 7 * 864e5).toISOString().slice(0, 10);
  const recent = new Date(today.getTime() - 5 * 864e5).toISOString();
  const sent = [];
  for (const a of apps) {
    const ad = a.admin || {};
    if (!ad.camp_end || ad.camp_end > cutoff || ad.followup_id || ad.reminder_sent_at || ad.no_reminder) continue;
    if (ad.followup_requested_at && ad.followup_requested_at > recent) continue;
    try {
      if (!ad.followup_token) a.admin = await patchAdmin(a.id, { followup_token: newToken() });
      await sendFollowup(a, 'reminder');
      await patchAdmin(a.id, { reminder_sent_at: new Date().toISOString() });
      sent.push(a.id);
    } catch (e) { console.error('reminder failed', a.id, e.message); }
  }
  return sent;
}
export default async () => { const sent = await run(); console.log('camp reminders sent:', sent.length); return new Response(JSON.stringify({ sent: sent.length })); };
