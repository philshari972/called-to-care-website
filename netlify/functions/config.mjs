// GET /.netlify/functions/config  -> public settings the website needs (no secrets).
import { env, json, db, setting } from './_lib.mjs';

export default async () => {
  let supportNights = [], ticketsOn = false;
  try {
    ticketsOn = !!(await setting('tickets_on', false));
    supportNights = await db(`events?kind=eq.support_night&registration_open=eq.true&starts_at=gte.${new Date(Date.now() - 3 * 3600e3).toISOString()}&order=starts_at.asc&limit=4&select=id,title,starts_at,location`);
  } catch (e) { console.error('config', e.message); }
  return new Response(JSON.stringify({
    stripeKey: env('STRIPE_PUBLISHABLE_KEY'),
    paypalClientId: env('PAYPAL_CLIENT_ID'),
    paypalEnv: env('PAYPAL_ENV', 'sandbox'),
    ticketsOn, supportNights,
  }), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' } });
};
