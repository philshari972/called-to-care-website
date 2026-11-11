// GET /.netlify/functions/config  -> public settings the website needs (no secrets).
import { env, json, db, setting, ticketsOpen, claimsOpen } from './_lib.mjs';

export default async () => {
  let supportNights = [], ticketsOn = false, baskets = [], basketClaims = { open: false, deadline: '' };
  try {
    ticketsOn = await ticketsOpen();
    supportNights = await db(`events?kind=eq.support_night&registration_open=eq.true&starts_at=gte.${new Date(Date.now() - 3 * 3600e3).toISOString()}&order=starts_at.asc&limit=4&select=id,title,starts_at,location`);
  } catch (e) { console.error('config', e.message); }
  try {
    const base = `${env('SUPABASE_URL').replace(/\/$/, '')}/storage/v1/object/public/photos/`;
    const url = (x) => (/^https?:/.test(x) ? x : base + x.split('/').map(encodeURIComponent).join('/'));
    baskets = (await db('baskets?active=eq.true&order=sort.asc,created_at.asc&select=*'))
      .map((b) => { const photos = (b.photos && b.photos.length ? b.photos : b.photo ? [b.photo] : []).map(url); return { id: b.id, title: b.title, description: b.description, cost: Number(b.cost), photo: photos[0] || '', photos,
        given: !!b.claimed_at, claimed: !!b.claimed_at && b.claim_kind === 'fill', givenBy: b.claimed_at ? b.claimed_name : '', unlisted: !!b.unlisted,
        held: !b.claimed_at && !!b.held_until && new Date(b.held_until) > new Date() }; });
    const cl = await setting('basket_claims', { on: true, deadline: '2027-02-01', dropoff: '' });
    basketClaims = { open: claimsOpen(cl), deadline: cl.deadline || '' };
  } catch (e) { console.error('config baskets', e.message); }
  return new Response(JSON.stringify({
    stripeKey: env('STRIPE_PUBLISHABLE_KEY'),
    paypalClientId: env('PAYPAL_CLIENT_ID'),
    paypalEnv: env('PAYPAL_ENV', 'sandbox'),
    ticketsOn, supportNights, baskets, basketClaims,
    supabaseUrl: env('SUPABASE_URL'),
    supabaseKey: env('SUPABASE_PUBLISHABLE_KEY'),   // public by design; row rules protect the data
  }), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' } });
};
