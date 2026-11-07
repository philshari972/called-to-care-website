// End-to-end checks for the server functions with Supabase, Stripe, PayPal and Resend replaced by fakes.
// Run: node netlify/tests/functions.test.mjs
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

Object.assign(process.env, {
  SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PUBLISHABLE_KEY: 'pk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_test', PAYPAL_CLIENT_ID: 'pp', PAYPAL_SECRET: 'pps', RESEND_API_KEY: 're_x', SITE_URL: 'https://example.org',
});

// ---- tiny in-memory PostgREST ----
const T = { contacts: [], submissions: [], payments: [], sponsorships: [], attendance: [], subscriptions: [], email_log: [], events: [], settings: [{ key: 'tickets_on', value: false }, { key: 'staff_alert_email', value: 'staff@example.org' }, { key: 'org', value: { legal_name: 'We Are Called to Care, NFP', ein: '86-2900453' } }] };
let seq = 1001; const uid = () => crypto.randomUUID();
function match(row, params) {
  for (const [k, v] of params) {
    if (['select', 'limit', 'order', 'on_conflict'].includes(k)) continue;
    const [op, ...rest] = v.split('.'); const val = rest.join('.'); const cell = row[k];
    if (op === 'eq' && String(cell) !== val) return false;
    if (op === 'neq' && String(cell) === val) return false;
    if (op === 'ilike' && String(cell ?? '').toLowerCase() !== val.toLowerCase()) return false;
    if (op === 'gte' && !(String(cell) >= val)) return false;
  }
  return true;
}
function rest(url, init) {
  const u = new URL(url); const path = u.pathname.replace('/rest/v1/', ''); const params = [...u.searchParams];
  const body = init.body ? JSON.parse(init.body) : null; const m = init.method || 'GET';
  if (path === 'rpc/next_receipt') return `C2C-2027-0${seq++}`;
  const tbl = T[path]; if (!tbl) throw new Error('no table ' + path);
  if (m === 'GET') { let rows = tbl.filter((r) => match(r, params)); const lim = u.searchParams.get('limit'); if (lim) rows = rows.slice(0, +lim); return rows; }
  if (m === 'POST') {
    const rows = [].concat(body).map((r) => ({ id: uid(), status: r.status, created_at: new Date().toISOString(), ...r }));
    const oc = u.searchParams.get('on_conflict');
    for (const r of rows) {
      if (oc) { const keys = oc.split(','); const ex = tbl.find((x) => keys.every((k) => x[k] === r[k])); if (ex) { Object.assign(ex, r, { id: ex.id }); continue; } }
      if (path === 'contacts' && r.email && tbl.some((x) => x.email === r.email)) throw new Error('duplicate email');
      tbl.push(r);
    }
    return init.headers.prefer?.includes('representation') ? rows : null;
  }
  if (m === 'PATCH') { tbl.filter((r) => match(r, params)).forEach((r) => Object.assign(r, body)); return null; }
}
const sent = []; const stripeCalls = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url); const ok = (o, s = 200) => new Response(o == null ? '' : JSON.stringify(o), { status: s });
  if (url.startsWith('https://db.test/rest/v1/')) { try { return ok(rest(url, init)); } catch (e) { return ok({ message: e.message }, 409); } }
  if (url === 'https://api.resend.com/emails') { const b = JSON.parse(init.body); sent.push(b); return ok({ id: 'em_' + sent.length }); }
  if (url.startsWith('https://api.stripe.com/v1/')) {
    const p = url.replace('https://api.stripe.com/v1/', ''); stripeCalls.push([init.method, p, init.body]);
    const q = new URLSearchParams(init.body || '');
    if (p === 'payment_intents' && init.method === 'POST') return ok({ id: 'pi_' + stripeCalls.length, client_secret: 'cs_x', amount: +q.get('amount') });
    if (p.startsWith('customers?')) return ok({ data: [] });
    if (p === 'customers') return ok({ id: 'cus_1' });
    if (p.startsWith('products/search')) return ok({ data: [] });
    if (p === 'products') return ok({ id: 'prod_1' });
    if (p === 'subscriptions') return ok({ id: 'sub_1', latest_invoice: { payment_intent: { id: 'pi_sub1', client_secret: 'cs_sub' } } });
    if (p.startsWith('payment_intents/')) return ok({ id: p.split('/')[1], latest_charge: 'ch_1' });
    if (p.startsWith('charges/')) return ok({ payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242', wallet: { type: 'apple_pay' } } } });
  }
  if (url.includes('paypal.com/v1/oauth2/token')) return ok({ access_token: 't' });
  if (url.includes('paypal.com/v2/checkout/orders') && url.endsWith('/capture')) return ok({ status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ amount: { value: '1500.00' } }] } }] });
  if (url.includes('paypal.com/v2/checkout/orders')) return ok({ id: 'ORDER1' });
  throw new Error('unexpected fetch ' + url);
};

const post = (fn, body) => fn(new Request('https://x/', { method: 'POST', body: JSON.stringify(body) }));
const submit = (await import('../functions/submit.mjs')).default;
const checkout = (await import('../functions/checkout.mjs')).default;
const webhook = (await import('../functions/stripe-webhook.mjs')).default;
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; console.log('  ✓', m); };

console.log('forms');
let r = await (await post(submit, { form: 'placement', data: { first_name: 'Ann', last_name: 'Lee', email: 'Ann@Example.com', phone: '6305551234', placement_date: '2026-11-04', city: 'Plano', children: [{ first: 'Mia', age: '4' }] } })).json();
ok(r.ok, 'placement saved');
ok(T.contacts[0].email === 'ann@example.com' && T.contacts[0].tags.includes('Foster/Kinship Family') && T.contacts[0].phone === '(630) 555-1234', 'contact created, tagged, phone formatted');
ok(sent.some((e) => e.to[0] === 'ann@example.com' && /care package/i.test(e.subject)) && sent.some((e) => e.to[0] === 'staff@example.org'), 'family confirmation + staff alert emailed');
r = await (await post(submit, { form: 'volunteer', data: { first_name: 'Ann', last_name: 'Lee', email: 'ann@example.com', interests: ['Care Closet'] } })).json();
ok(T.contacts.length === 1 && T.contacts[0].tags.includes('Volunteer: Care Closet') && T.contacts[0].tags.includes('Foster/Kinship Family'), 'same person reused; tags added, none lost');
r = await post(submit, { form: 'volunteer', data: { first_name: 'X', last_name: 'Y', email: 'bad' } }); ok(r.status === 400, 'bad email rejected');
r = await post(submit, { form: 'message', data: { name: 'Bot', email: 'b@x.com', message: 'hi' }, website: 'spam' }); ok((await r.json()).ok && !T.submissions.some((s) => s.data.name === 'Bot'), 'honeypot bot silently ignored');
r = await post(submit, { form: 'evil', data: {} }); ok(r.status === 400, 'unknown form rejected');

console.log('checkout');
r = await (await post(checkout, { kind: 'sponsorship', item: 'sapphire', provider: 'stripe', contact: { first: 'Bo', last: 'Ng', email: 'bo@x.com' }, display_name: 'Ng Family', amount: 1 })).json();
const pi = stripeCalls.find((c) => c[1] === 'payment_intents');
ok(r.ok && r.clientSecret && new URLSearchParams(pi[2]).get('amount') === '150000', 'sponsorship price set by server ($1,500), not by browser');
r = await post(checkout, { kind: 'tickets', qty: 2, provider: 'stripe', contact: { first: 'Bo', last: 'Ng', email: 'bo@x.com' } }); ok(r.status === 400, 'tickets blocked while sales are off');
r = await post(checkout, { kind: 'donation', amount: 2, provider: 'stripe', contact: { first: 'Bo', last: 'Ng', email: 'bo@x.com' } }); ok(r.status === 400, 'gift under $5 rejected');

console.log('stripe webhook');
const pay = T.payments.find((p) => p.purpose === 'sponsorship');
const evt = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { id: pay.provider_id, metadata: { c2c_payment_id: pay.id }, latest_charge: 'ch_1' } } });
const sig = (b, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac('sha256', 'whsec_test').update(`${t}.${b}`).digest('hex')}`;
r = await webhook(new Request('https://x/', { method: 'POST', body: evt, headers: { 'stripe-signature': 't=1,v1=00' } })); ok(r.status === 400, 'forged webhook refused');
r = await webhook(new Request('https://x/', { method: 'POST', body: evt, headers: { 'stripe-signature': sig(evt) } }));
ok(r.status === 200 && pay.status === 'succeeded' && pay.receipt_no?.startsWith('C2C-') && pay.method.includes('Apple Pay'), 'payment marked paid with receipt # and method');
ok(T.sponsorships.length === 1 && T.sponsorships[0].level === 'Sapphire' && T.sponsorships[0].year === 2027 && T.sponsorships[0].source === 'Website', 'sponsorship added to sponsor list');
ok(sent.some((e) => e.to[0] === 'bo@x.com' && /receipt/i.test(e.subject) && e.html.includes('86-2900453')), 'receipt emailed with EIN');
const before = T.sponsorships.length + sent.length;
await webhook(new Request('https://x/', { method: 'POST', body: evt, headers: { 'stripe-signature': sig(evt) } }));
ok(T.sponsorships.length + sent.length === before, 'Stripe retry does not double-record or double-email');
const other = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { id: 'pi_donorbox', metadata: {} } } });
r = await webhook(new Request('https://x/', { method: 'POST', body: other, headers: { 'stripe-signature': sig(other) } })); ok(r.status === 200 && !T.payments.some((p) => p.provider_id === 'pi_donorbox'), 'Donorbox payments ignored');

console.log('monthly gift');
r = await (await post(checkout, { kind: 'donation', amount: 50, recurring: true, provider: 'stripe', contact: { first: 'Cy', last: 'Ro', email: 'cy@x.com' } })).json();
ok(r.ok && T.subscriptions.length === 1 && T.contacts.find((c) => c.email === 'cy@x.com').tags.includes('Monthly Partner'), 'monthly gift creates subscription + Monthly Partner tag');
const inv = JSON.stringify({ type: 'invoice.paid', data: { object: { billing_reason: 'subscription_cycle', payment_intent: 'pi_month2', subscription: 'sub_1', amount_paid: 5000 } } });
await webhook(new Request('https://x/', { method: 'POST', body: inv, headers: { 'stripe-signature': sig(inv) } }));
ok(T.payments.some((p) => p.provider_id === 'pi_month2' && p.status === 'succeeded' && p.amount === 50), 'second month recorded and receipted');

console.log('paypal');
r = await (await post(checkout, { kind: 'sponsorship', item: 'sapphire', provider: 'paypal', contact: { first: 'Di', last: 'Ko', email: 'di@x.com' } })).json();
ok(r.orderID === 'ORDER1', 'PayPal order created');
r = await (await post(checkout, { action: 'capture', orderID: 'ORDER1' })).json();
ok(r.ok && r.receipt && T.sponsorships.length === 2, 'PayPal capture finalizes sponsorship + receipt');
console.log(`\n${pass} checks passed`);
