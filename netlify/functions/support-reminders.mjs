// Every morning: email everyone registered for a Support Night happening two days from now.
import { db } from './_lib.mjs';
import { ensureToken, sendReminder } from './_support.mjs';

export const config = { schedule: '0 14 * * *' };   // 14:00 UTC = 8 or 9 AM in Illinois
const chiDate = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

export async function run(now = new Date()) {
  const target = chiDate(now.getTime() + 2 * 864e5);
  const evs = (await db(`events?kind=eq.support_night&select=*&starts_at=gte.${new Date(now.getTime() + 864e5).toISOString()}`))
    .filter((e) => chiDate(e.starts_at) === target);
  const sent = [];
  for (const ev of evs) {
    const subs = await db(`submissions?form=eq.support&event_id=eq.${ev.id}&select=*`);
    for (let s of subs) {
      if (s.status === 'Cancelled' || s.admin?.reminder_sent_at || !s.data?.email) continue;
      try {
        s = await ensureToken(s);
        await sendReminder(s, ev);
        await db(`submissions?id=eq.${s.id}`, { method: 'PATCH', body: { admin: { ...s.admin, reminder_sent_at: new Date().toISOString() } } });
        sent.push(s.id);
      } catch (e) { console.error('support reminder', s.id, e.message); }
    }
  }
  return sent;
}
export default async () => { const sent = await run(); console.log('support reminders sent:', sent.length); return new Response(JSON.stringify({ sent: sent.length })); };
