// Stripe calls this after payments. Address to give Stripe:
//   https://wearecalledtocare.com/.netlify/functions/stripe-webhook
// Events: payment_intent.succeeded, payment_intent.payment_failed, invoice.paid,
//         customer.subscription.updated, customer.subscription.deleted, charge.refunded
// Only payments started by this website are recorded; Donorbox and others are ignored.
import crypto from 'node:crypto';
import { db, env, finalizePayment, json } from './_lib.mjs';
import { stripe } from './checkout.mjs';

export function verify(raw, header, secret, toleranceSec = 300) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=')).filter((x) => x.length === 2).map(([k, v]) => [k, v]));
  const sigs = header.split(',').filter((x) => x.startsWith('v1=')).map((x) => x.slice(3));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

async function methodLabel(pi) {
  try {
    if (!pi.latest_charge) return 'Card';
    const ch = typeof pi.latest_charge === 'object' ? pi.latest_charge : await stripe(`charges/${pi.latest_charge}`, null, 'GET');
    const d = ch.payment_method_details || {};
    if (d.type === 'us_bank_account') return `Bank account${d.us_bank_account?.last4 ? ' ending ' + d.us_bank_account.last4 : ''}`;
    if (d.type === 'card') {
      const w = d.card?.wallet?.type; const brand = (d.card?.brand || 'card').replace(/^./, (c) => c.toUpperCase());
      return `${w === 'apple_pay' ? 'Apple Pay · ' : w === 'google_pay' ? 'Google Pay · ' : w === 'link' ? 'Link · ' : ''}${brand} ending ${d.card?.last4 || ''}`.trim();
    }
    if (d.type === 'link') return 'Link';
    return d.type || 'Card';
  } catch { return 'Card'; }
}
const byProviderId = async (id) => (await db(`payments?provider=eq.stripe&provider_id=eq.${encodeURIComponent(id)}&select=*`))[0];

export default async (req) => {
  const raw = await req.text();
  if (!verify(raw, req.headers.get('stripe-signature'), env('STRIPE_WEBHOOK_SECRET'))) return json({ error: 'bad signature' }, 400);
  const evt = JSON.parse(raw); const o = evt.data.object;
  try {
    switch (evt.type) {
      case 'payment_intent.succeeded': {
        const pay = (o.metadata?.c2c_payment_id && (await db(`payments?id=eq.${o.metadata.c2c_payment_id}&select=*`))[0]) || (await byProviderId(o.id));
        if (!pay) break;                                   // not from this website
        await finalizePayment(pay, { method: await methodLabel(o) });
        break;
      }
      case 'payment_intent.payment_failed': {
        const pay = await byProviderId(o.id);
        if (pay && pay.status === 'pending') await db(`payments?id=eq.${pay.id}`, { method: 'PATCH', body: { status: 'failed' } });
        break;
      }
      case 'invoice.paid': {
        // Monthly gifts after the first month: add a new payment and send a receipt.
        if (o.billing_reason !== 'subscription_cycle' || !o.payment_intent) break;
        const [sub] = await db(`subscriptions?provider_id=eq.${encodeURIComponent(o.subscription)}&select=*`);
        if (!sub || await byProviderId(o.payment_intent)) break;
        const [pay] = await db('payments', { method: 'POST', prefer: 'return=representation', body: {
          provider: 'stripe', provider_id: o.payment_intent, contact_id: sub.contact_id, purpose: 'donation', recurring: true,
          description: `Monthly gift: ${sub.designation || 'Where needed most'}`, designation: sub.designation, amount: o.amount_paid / 100, status: 'pending', meta: { subscription: sub.provider_id } } });
        const pi = await stripe(`payment_intents/${o.payment_intent}`, null, 'GET');
        await finalizePayment(pay, { method: await methodLabel(pi) });
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await db(`subscriptions?provider_id=eq.${encodeURIComponent(o.id)}`, { method: 'PATCH', body: {
          status: evt.type.endsWith('deleted') ? 'canceled' : o.status, ...(evt.type.endsWith('deleted') ? { canceled_at: new Date().toISOString() } : {}) } });
        break;
      }
      case 'charge.refunded': {
        const pay = o.payment_intent && (await byProviderId(o.payment_intent));
        if (pay && o.refunded) await db(`payments?id=eq.${pay.id}`, { method: 'PATCH', body: { status: 'refunded' } });
        break;
      }
    }
    return json({ received: true });
  } catch (e) {
    console.error('webhook error', evt.type, e.message);
    return json({ error: 'temporary' }, 500);                // Stripe retries automatically
  }
};
