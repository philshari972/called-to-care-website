// POST /.netlify/functions/checkout
//   { action:'start', provider:'stripe'|'paypal', kind:'sponsorship'|'tickets'|'table'|'donation',
//     item, qty, amount, recurring, designation, display_name, guests, contact:{first,last,email,phone,...} }
//   -> Stripe: { clientSecret, paymentId }  |  PayPal: { orderID, paymentId }
//   { action:'capture', orderID }  (PayPal, after the buyer approves)
// Prices are decided here on the server, never by the browser.
import { db, setting, upsertContact, finalizePayment, json, fail, clean, isEmail, looksLikeBot, env, money,
  SPONSOR_LEVELS, TICKET_PRICE, TABLE_PRICE, DINNER_YEAR } from './_lib.mjs';

const STRIPE_VERSION = '2024-06-20';
const form = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => {
  const key = prefix ? `${prefix}[${k}]` : k;
  if (v === undefined || v === null) return [];
  if (typeof v === 'object') return form(v, key).split('&').filter(Boolean);
  return [`${encodeURIComponent(key)}=${encodeURIComponent(v)}`];
}).join('&');
export async function stripe(path, params, method = 'POST') {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method, headers: { authorization: `Bearer ${env('STRIPE_SECRET_KEY')}`, 'stripe-version': STRIPE_VERSION, 'content-type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : form(params || {}),
  });
  const out = await r.json();
  if (!r.ok) throw new Error(`Stripe: ${out.error?.message || r.status}`);
  return out;
}
const PAYPAL_BASE = () => (env('PAYPAL_ENV', 'sandbox') === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');
export async function paypal(path, body) {
  const auth = btoa(`${env('PAYPAL_CLIENT_ID')}:${env('PAYPAL_SECRET')}`);
  const t = await fetch(`${PAYPAL_BASE()}/v1/oauth2/token`, { method: 'POST', headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  const tok = await t.json(); if (!t.ok) throw new Error('PayPal sign-in failed');
  const r = await fetch(`${PAYPAL_BASE()}${path}`, { method: 'POST', headers: { authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const out = await r.json(); if (!r.ok) throw new Error(`PayPal: ${out.message || r.status}`);
  return out;
}

// What is being bought, and for how much.
async function price(b) {
  if (b.kind === 'donation') {
    const amount = Math.round(Number(b.amount) * 100) / 100;
    if (!(amount >= 5 && amount <= 50000)) throw new Error('Please choose a gift between $5 and $50,000.');
    const fund = clean(b.designation, 60) || 'Where needed most';
    return { purpose: 'donation', amount, description: `${b.recurring ? 'Monthly gift' : 'Donation'}: ${fund}`, designation: fund, recurring: !!b.recurring, tags: ['Donor', ...(b.recurring ? ['Monthly Partner'] : [])] };
  }
  if (b.kind === 'sponsorship') {
    const lv = SPONSOR_LEVELS[b.item]; if (!lv) throw new Error('Unknown sponsorship level.');
    if (lv.limit) {
      const taken = await db(`sponsorships?year=eq.${DINNER_YEAR}&level=eq.${encodeURIComponent(lv.level)}&status=neq.Declined&select=id`);
      if (taken.length >= lv.limit) throw new Error(`Sorry, the ${lv.name} spot is already taken. Please choose another level.`);
    }
    return { purpose: 'sponsorship', amount: lv.price, description: `${DINNER_YEAR} Charity Dinner: ${lv.name}`, tags: [`Sponsor ${DINNER_YEAR}`, 'Charity Dinner Sponsor'] };
  }
  if (b.kind === 'tickets' || b.kind === 'table') {
    if (!(await setting('tickets_on', false))) throw new Error('Dinner tickets are not on sale yet.');
    if (b.kind === 'table') return { purpose: 'table', amount: TABLE_PRICE, description: `${DINNER_YEAR} Charity Dinner: Table of 10`, qty: 10, tags: [`Dinner Guest ${DINNER_YEAR}`] };
    const qty = Math.max(1, Math.min(20, parseInt(b.qty, 10) || 1));
    return { purpose: 'tickets', amount: qty * TICKET_PRICE, description: `${DINNER_YEAR} Charity Dinner: ${qty} ticket${qty > 1 ? 's' : ''}`, qty, tags: [`Dinner Guest ${DINNER_YEAR}`] };
  }
  throw new Error('Unknown purchase.');
}

async function stripeCustomer(email, name) {
  const found = await stripe(`customers?email=${encodeURIComponent(email)}&limit=1`, null, 'GET');
  return found.data[0] || stripe('customers', { email, name, metadata: { source: 'wearecalledtocare.com' } });
}
async function monthlyProduct() {
  const found = await stripe(`products/search?query=${encodeURIComponent("metadata['c2c']:'monthly-gift'")}`, null, 'GET');
  return found.data[0] || stripe('products', { name: 'Monthly gift to We Are Called to Care', metadata: { c2c: 'monthly-gift' } });
}

export default async (req) => {
  if (req.method !== 'POST') return fail('Use POST', 405);
  let b; try { b = await req.json(); } catch { return fail('Invalid request'); }

  // ----- PayPal: capture after approval -----
  if (b.action === 'capture') {
    try {
      const orderID = clean(b.orderID, 64);
      const [pay] = await db(`payments?provider=eq.paypal&provider_id=eq.${encodeURIComponent(orderID)}&select=*`);
      if (!pay) return fail('Payment not found.', 404);
      if (pay.status === 'succeeded') return json({ ok: true, receipt: pay.receipt_no });
      const cap = await paypal(`/v2/checkout/orders/${orderID}/capture`);
      if (cap.status !== 'COMPLETED') return fail('PayPal did not complete the payment.');
      const captured = Number(cap.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value || 0);
      if (Math.abs(captured - Number(pay.amount)) > 0.01) return fail('Payment amount did not match. Please contact us.');
      await finalizePayment(pay, { method: 'PayPal' });
      const [done] = await db(`payments?id=eq.${pay.id}&select=receipt_no`);
      return json({ ok: true, receipt: done?.receipt_no });
    } catch (e) { console.error(e); return fail('We could not finish the PayPal payment. You have not been charged twice; please try again or contact us.', 500); }
  }

  // ----- start a payment -----
  if (looksLikeBot(b)) return fail('Please try again.');
  const c = b.contact || {};
  const email = clean(c.email, 200).toLowerCase();
  if (!clean(c.first) || !clean(c.last) || !isEmail(email)) return fail('Please enter your first name, last name, and a valid email.');
  if (!clean(c.street) || !clean(c.city) || !clean(c.zip)) return fail('Please enter your mailing address so we can send a thank-you note.');
  let item; try { item = await price(b); } catch (e) { return fail(e.message); }
  if (b.provider === 'paypal' && item.recurring) return fail('Monthly gifts use card or bank account. PayPal is for one-time gifts.');

  try {
    const contactId = await upsertContact({ first: c.first, last: c.last, email, phone: c.phone, street: c.street, city: c.city, state: c.state, zip: c.zip, org: c.org, tags: item.tags, source: 'Website checkout' });
    const meta = { item: b.item || b.kind, qty: item.qty, display_name: clean(b.display_name, 120), guests: clean(b.guests, 1000), name: `${clean(c.first)} ${clean(c.last)}` };
    const [pay] = await db('payments', { method: 'POST', prefer: 'return=representation', body: {
      provider: b.provider === 'paypal' ? 'paypal' : 'stripe', contact_id: contactId, purpose: item.purpose, description: item.description,
      designation: item.designation || '', amount: item.amount, recurring: !!item.recurring, status: 'pending', meta } });
    const metadata = { c2c_payment_id: pay.id, purpose: item.purpose, item: meta.item };

    if (b.provider === 'paypal') {
      const order = await paypal('/v2/checkout/orders', { intent: 'CAPTURE', purchase_units: [{ reference_id: pay.id, custom_id: pay.id, description: item.description.slice(0, 127),
        amount: { currency_code: 'USD', value: item.amount.toFixed(2) } }], application_context: { brand_name: 'We Are Called to Care', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' } });
      await db(`payments?id=eq.${pay.id}`, { method: 'PATCH', body: { provider_id: order.id } });
      return json({ ok: true, provider: 'paypal', orderID: order.id, paymentId: pay.id });
    }

    const cents = Math.round(item.amount * 100);
    if (item.recurring) {
      const customer = await stripeCustomer(email, meta.name);
      const product = await monthlyProduct();
      const sub = await stripe('subscriptions', { customer: customer.id, items: { 0: { price_data: { currency: 'usd', product: product.id, unit_amount: cents, recurring: { interval: 'month' } } } },
        payment_behavior: 'default_incomplete', payment_settings: { save_default_payment_method: 'on_subscription' }, metadata, expand: { 0: 'latest_invoice.payment_intent' } });
      const pi = sub.latest_invoice.payment_intent;
      await stripe(`payment_intents/${pi.id}`, { metadata, description: item.description });
      await db(`payments?id=eq.${pay.id}`, { method: 'PATCH', body: { provider_id: pi.id } });
      await db('subscriptions', { method: 'POST', body: { contact_id: contactId, provider: 'stripe', provider_id: sub.id, amount: item.amount, status: 'incomplete', designation: item.designation } });
      return json({ ok: true, provider: 'stripe', clientSecret: pi.client_secret, paymentId: pay.id });
    }
    const pi = await stripe('payment_intents', { amount: cents, currency: 'usd', description: item.description, metadata, automatic_payment_methods: { enabled: 'true' },
      // Until our own receipt emails are on (RESEND_API_KEY), let Stripe email the donor its receipt.
      ...(env('RESEND_API_KEY') ? {} : { receipt_email: email }) });
    await db(`payments?id=eq.${pay.id}`, { method: 'PATCH', body: { provider_id: pi.id } });
    return json({ ok: true, provider: 'stripe', clientSecret: pi.client_secret, paymentId: pay.id, amount: money(item.amount) });
  } catch (e) {
    console.error('checkout failed', e.message);
    return fail('Sorry, checkout is not available right now. Please try again in a few minutes or contact us.', 500);
  }
};
