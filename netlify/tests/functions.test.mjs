// End-to-end checks for the server functions with Supabase, Stripe, PayPal and Resend replaced by fakes.
// Run: node netlify/tests/functions.test.mjs
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

Object.assign(process.env, {
  SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PUBLISHABLE_KEY: 'pk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_test', PAYPAL_CLIENT_ID: 'pp', PAYPAL_SECRET: 'pps', RESEND_API_KEY: 're_x', SITE_URL: 'https://example.org',
});

// ---- tiny in-memory PostgREST ----
const T = { baskets: [], donor_letters: [], contacts: [], submissions: [], payments: [], sponsorships: [], attendance: [], subscriptions: [], email_log: [], events: [], settings: [{ key: 'tickets_on', value: false }, { key: 'staff_alert_email', value: ['staff@example.org', 'boss@example.org'] }, { key: 'org', value: { legal_name: 'We Are Called to Care, NFP', ein: '86-2900453' } }] };
let seq = 1001; const uid = () => crypto.randomUUID();
function match(row, params) {
  for (const [k, v] of params) {
    if (['select', 'limit', 'order', 'on_conflict'].includes(k)) continue;
    const [op, ...rest] = v.split('.'); const val = rest.join('.'); const cell = row[k];
    if (op === 'eq' && String(cell) !== val) return false;
    if (op === 'neq' && String(cell) === val) return false;
    if (op === 'ilike' && String(cell ?? '').toLowerCase() !== val.toLowerCase()) return false;
    if (op === 'gte' && !(String(cell) >= val)) return false;
    if (k === 'or') { if (!v.replace(/^\(|\)$/g, '').split(',').some((c) => { const [ck, ...cr] = c.split('.'); return match(row, [[ck, cr.join('.')]]); })) return false; continue; }
    if (op === 'is' && !(val === 'null' ? cell == null : String(cell) === val)) return false;
    if (op === 'lt' && !(cell != null && String(cell) < val)) return false;
    if (op === 'in' && !val.replace(/^\(|\)$/g, '').split(',').includes(String(cell))) return false;
  }
  return true;
}
function rest(url, init) {
  const u = new URL(url); const path = u.pathname.replace('/rest/v1/', ''); const params = [...u.searchParams];
  const body = init.body ? JSON.parse(init.body) : null; const m = init.method || 'GET';
  if (path === 'rpc/next_receipt') return `C2C-2027-0${seq++}`;
  if (path === 'rpc/level_for') return init.headers.authorization === 'Bearer staff-jwt' ? 3 : 0;
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
  if (m === 'PATCH') { const hit = tbl.filter((r) => match(r, params)); hit.forEach((r) => Object.assign(r, body)); return init.headers.prefer?.includes('representation') ? hit : null; }
}
const sent = []; const stripeCalls = []; const stored = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url); const ok = (o, s = 200) => new Response(o == null ? '' : JSON.stringify(o), { status: s });
  if (url.startsWith('https://db.test/rest/v1/')) { try { return ok(rest(url, init)); } catch (e) { return ok({ message: e.message }, 409); } }
  if (url.startsWith('https://db.test/storage/v1/object/camp-photos/')) { stored.push(url); return ok({ Key: url }); }
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
    if (p === 'invoices/in_2') return ok({ id: 'in_2', billing_reason: 'subscription_cycle', payment_intent: 'pi_month2', subscription: 'sub_1', amount_paid: 5000 });
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
ok(sent.some((e) => e.to[0] === "jen@wearecalledtocare.com" && /New placement form/.test(e.subject)) && sent.some((e) => e.to[0] === "staff@example.org" && /New placement form/.test(e.subject)), "care package alert also goes to Jen");
ok(r.ok, 'placement saved');
ok(T.contacts[0].email === 'ann@example.com' && T.contacts[0].tags.includes('Foster/Kinship Family') && T.contacts[0].phone === '(630) 555-1234', 'contact created, tagged, phone formatted');
ok(sent.some((e) => e.to[0] === 'ann@example.com' && /care package/i.test(e.subject)) && sent.some((e) => e.to[0] === 'staff@example.org') && sent.some((e) => e.to[0] === 'boss@example.org'), 'family confirmation + staff alert emailed to every staff address');
r = await (await post(submit, { form: 'volunteer', data: { first_name: 'Ann', last_name: 'Lee', email: 'ann@example.com', interests: ['Care Closet'] } })).json();
ok(T.contacts.length === 1 && T.contacts[0].tags.includes('Volunteer: Care Closet') && T.contacts[0].tags.includes('Foster/Kinship Family'), 'same person reused; tags added, none lost');
r = await post(submit, { form: 'volunteer', data: { first_name: 'X', last_name: 'Y', email: 'bad' } }); ok(r.status === 400, 'bad email rejected');
r = await post(submit, { form: 'message', data: { name: 'Bot', email: 'b@x.com', message: 'hi' }, website: 'spam' }); ok((await r.json()).ok && !T.submissions.some((s) => s.data.name === 'Bot'), 'honeypot bot silently ignored');
r = await post(submit, { form: 'evil', data: {} }); ok(r.status === 400, 'unknown form rejected');

console.log('checkout');
r = await (await post(checkout, { kind: 'sponsorship', item: 'sapphire', provider: 'stripe', contact: { first: 'Bo', last: 'Ng', email: 'bo@x.com', street: '1 Main St', city: 'Plano', state: 'IL', zip: '60545' }, display_name: 'Ng Family', amount: 1 })).json();
const pi = stripeCalls.find((c) => c[1] === 'payment_intents');
ok(r.ok && r.clientSecret && new URLSearchParams(pi[2]).get('amount') === '150000', 'sponsorship price set by server ($1,500), not by browser');
r = await post(checkout, { kind: 'tickets', qty: 2, provider: 'stripe', contact: { first: 'Bo', last: 'Ng', email: 'bo@x.com', street: '1 Main St', city: 'Plano', state: 'IL', zip: '60545' } }); ok(r.status === 400, 'tickets blocked while sales are off');
r = await post(checkout, { kind: 'donation', amount: 2, provider: 'stripe', contact: { first: 'Bo', last: 'Ng', email: 'bo@x.com', street: '1 Main St', city: 'Plano', state: 'IL', zip: '60545' } }); ok(r.status === 400, 'gift under $5 rejected');

r = await post(checkout, { kind: 'donation', amount: 25, provider: 'stripe', contact: { first: 'No', last: 'Addr', email: 'na@x.com' } }); ok(r.status === 400, 'checkout requires a mailing address');
const sp = await (await post(checkout, { kind: 'donation', amount: 25, provider: 'stripe', contact: { first: 'Al', last: 'Ma', email: 'al@x.com', street: '9 Oak Ln', city: 'Yorkville', state: 'il', zip: '60560' } })).json();
ok(sp.ok && T.contacts.find((c) => c.email === 'al@x.com').street === '9 Oak Ln' && T.contacts.find((c) => c.email === 'al@x.com').state === 'IL', 'donor mailing address saved for thank-you notes');

console.log('stripe webhook');
const pay = T.payments.find((p) => p.purpose === 'sponsorship');
const evt = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { id: pay.provider_id, metadata: { c2c_payment_id: pay.id } } } });
const sig = (b, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac('sha256', 'whsec_test').update(`${t}.${b}`).digest('hex')}`;
r = await webhook(new Request('https://x/', { method: 'POST', body: evt, headers: { 'stripe-signature': 't=1,v1=00' } })); ok(r.status === 400, 'forged webhook refused');
r = await webhook(new Request('https://x/', { method: 'POST', body: evt, headers: { 'stripe-signature': sig(evt) } }));
ok(r.status === 200 && pay.status === 'succeeded' && pay.receipt_no?.startsWith('C2C-') && pay.method.includes('Apple Pay'), 'payment marked paid with receipt # and method');
ok(T.sponsorships.length === 1 && T.sponsorships[0].level === 'Sapphire' && T.sponsorships[0].year === 2027 && T.sponsorships[0].source === 'Website', 'sponsorship added to sponsor list');
ok(sent.some((e) => e.to[0] === 'bo@x.com' && /receipt/i.test(e.subject) && e.html.includes('86-2900453')), 'receipt emailed with EIN');
{ T.settings.find((x) => x.key === 'staff_alert_email').value.push('shari@wearecalledtocare.com');
  const dp = T.payments.find((p) => p.purpose === 'donation' && !p.recurring); const de = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { id: dp.provider_id, metadata: { c2c_payment_id: dp.id } } } });
  await webhook(new Request('https://x/', { method: 'POST', body: de, headers: { 'stripe-signature': sig(de) } }));
  const L = sent.find((e) => e.to[0] === 'shari@wearecalledtocare.com' && /^New donation: Al Ma, \$25/.test(e.subject));
  ok(L && L.attachments?.[0]?.filename.endsWith('.pdf') && Buffer.from(L.attachments[0].content, 'base64').subarray(0, 5).toString() === '%PDF-', 'thank-you letter PDF emailed to Shari');
  ok(!sent.some((e) => e.to[0] === 'shari@wearecalledtocare.com' && /^\[Website\] New donation/.test(e.subject)) && sent.some((e) => e.to[0] === 'staff@example.org' && /^\[Website\] New donation/.test(e.subject)), 'letter recipients skip the plain donation alert; other staff still get it');
  ok(L.html.includes('9 Oak Ln') && !sent.some((e) => e.attachments && /Bo Ng/.test(e.subject)) && T.donor_letters.length === 1 && T.donor_letters[0].kind === 'one-time', 'letter email shows the mailing address; letter logged'); }
const before = T.sponsorships.length + sent.length;
await webhook(new Request('https://x/', { method: 'POST', body: evt, headers: { 'stripe-signature': sig(evt) } }));
ok(T.sponsorships.length + sent.length === before, 'Stripe retry does not double-record or double-email');
const other = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { id: 'pi_donorbox', metadata: {} } } });
r = await webhook(new Request('https://x/', { method: 'POST', body: other, headers: { 'stripe-signature': sig(other) } })); ok(r.status === 200 && !T.payments.some((p) => p.provider_id === 'pi_donorbox'), 'Donorbox payments ignored');

console.log('donor baskets');
{ const bk = { id: uid(), title: 'Movie Night', description: 'Four passes', cost: 250, photo: 'baskets/a.jpg', active: true, sort: 1, claimed_at: null, held_until: null };
  T.baskets.push(bk, { id: uid(), title: 'Hidden', cost: 99, active: false, claimed_at: null, sort: 2 });
  const cfg = await (await (await import('../functions/config.mjs')).default()).json();
  ok(cfg.baskets.length === 1 && cfg.baskets[0].photo === 'https://db.test/storage/v1/object/public/photos/baskets/a.jpg' && !cfg.baskets[0].given, 'only baskets turned on show on the dinner page, with photo link');
  const who = { first: 'Gi', last: 'Ver', email: 'gi@x.com', street: '1 Main St', city: 'Plano', state: 'IL', zip: '60545' };
  r = await (await post(checkout, { kind: 'basket', item: T.baskets[1].id, amount: 1, provider: 'stripe', contact: who })).json(); ok(!r.ok && /no longer available/.test(r.error), 'a basket that is off cannot be bought');
  const n0 = stripeCalls.length;
  r = await (await post(checkout, { kind: 'basket', item: bk.id, amount: 1, display_name: 'The Ver Family', provider: 'stripe', contact: who })).json();
  const bpi = stripeCalls.slice(n0).find((c) => c[1] === 'payment_intents');
  ok(r.ok && new URLSearchParams(bpi[2]).get('amount') === '25000' && bk.held_until, 'basket price set by server ($250) and basket held during checkout');
  r = await (await post(checkout, { kind: 'basket', item: bk.id, provider: 'stripe', contact: { ...who, email: 'two@x.com' } })).json(); ok(!r.ok && /checking out/.test(r.error), 'a second donor cannot pay for a basket on hold');
  const bp = T.payments.find((p) => p.meta?.basket_id === bk.id);
  const be = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { id: bp.provider_id, metadata: { c2c_payment_id: bp.id } } } });
  await webhook(new Request('https://x/', { method: 'POST', body: be, headers: { 'stripe-signature': sig(be) } }));
  ok(bk.claimed_at && bk.claimed_payment === bp.id && bk.claimed_name === 'The Ver Family' && bp.purpose === 'donation', 'paid basket marked given, recorded as a donation');
  ok(sent.some((e) => e.to[0] === 'gi@x.com' && /receipt/i.test(e.subject) && /auction basket/.test(e.html) && e.html.includes('No goods or services')), 'basket donor gets a receipt');
  const cfg2 = await (await (await import('../functions/config.mjs')).default()).json();
  ok(cfg2.baskets[0].given && cfg2.baskets[0].givenBy === 'The Ver Family', 'dinner page shows the basket as given');
  bk.held_until = null; r = await (await post(checkout, { kind: 'basket', item: bk.id, provider: 'stripe', contact: who })).json(); ok(!r.ok && /just gave/.test(r.error), 'a given basket cannot be bought again'); }

console.log('basket claims and links');
{ const bk = T.baskets[0]; ok(bk.claim_kind === 'paid', 'a basket paid online is recorded as paid');
  const b2 = { id: uid(), title: 'Spa Day', description: 'Robe\nCandles\nGift card', cost: 400, active: true, sort: 3, claimed_at: null, held_until: null };
  const b3 = { id: uid(), title: 'Private Chef', description: '', cost: 900, active: true, unlisted: true, sort: 4, claimed_at: null, held_until: null };
  T.baskets.push(b2, b3);
  let cfg = await (await (await import('../functions/config.mjs')).default()).json();
  ok(cfg.basketClaims.open && cfg.basketClaims.deadline === '2027-02-01', 'claims are open until Feb 1, 2027 by default');
  ok(cfg.baskets.find((x) => x.id === b3.id)?.unlisted === true, 'a link-only basket is sent to the page marked unlisted (so its link works)');
  const who = { first: 'Cl', last: 'Aim', email: 'claim@x.com', street: '1 Main St', city: 'Plano', state: 'IL', zip: '60545' };
  r = await (await post(checkout, { action: 'claim', kind: 'basket', item: b2.id, contact: who })).json(); ok(!r.ok && /phone/.test(r.error), 'claiming needs a phone number');
  const n0 = stripeCalls.length, m0 = sent.length;
  r = await (await post(checkout, { action: 'claim', kind: 'basket', item: b2.id, display_name: 'The Aims', contact: { ...who, phone: '(630) 555-0100' } })).json();
  ok(r.ok && /February 1, 2027/.test(r.deadline) && b2.claimed_at && b2.claim_kind === 'fill' && b2.claimed_name === 'The Aims' && stripeCalls.length === n0, 'claim holds the basket with no payment');
  const mail = sent.slice(m0); ok(mail.some((e) => e.to[0] === 'claim@x.com' && /Spa Day/.test(e.subject) && /Candles/.test(e.html) && /February 1, 2027/.test(e.html)), 'claimer gets the list and the fill-by date');
  ok(mail.some((e) => /Basket claimed/.test(e.subject)), 'staff are told about the claim');
  r = await (await post(checkout, { action: 'claim', kind: 'basket', item: b2.id, contact: { ...who, email: 'b@x.com', phone: '6305550101' } })).json(); ok(!r.ok && /claimed/.test(r.error), 'a claimed basket cannot be claimed again');
  r = await (await post(checkout, { kind: 'basket', item: b2.id, provider: 'stripe', contact: who })).json(); ok(!r.ok, 'a claimed basket cannot be paid for');
  cfg = await (await (await import('../functions/config.mjs')).default()).json();
  const c2 = cfg.baskets.find((x) => x.id === b2.id); ok(c2.given && c2.claimed && c2.givenBy === 'The Aims', 'dinner page shows it as claimed');
  T.settings.push({ key: 'basket_claims', value: { on: true, deadline: '2026-01-31', dropoff: '' } });
  r = await (await post(checkout, { action: 'claim', kind: 'basket', item: b3.id, contact: { ...who, phone: '6305550100' } })).json(); ok(!r.ok && /closed/.test(r.error) && !b3.claimed_at, 'no claims after the deadline');
  cfg = await (await (await import('../functions/config.mjs')).default()).json(); ok(!cfg.basketClaims.open, 'dinner page hides claiming after the deadline');
  T.settings.find((x) => x.key === 'basket_claims').value = { on: false, deadline: '2027-02-01' };
  cfg = await (await (await import('../functions/config.mjs')).default()).json(); ok(!cfg.basketClaims.open, 'claiming can be turned off');
  T.settings = T.settings.filter((x) => x.key !== 'basket_claims'); }

console.log('monthly gift');
r = await (await post(checkout, { kind: 'donation', amount: 50, recurring: true, provider: 'stripe', contact: { first: 'Cy', last: 'Ro', email: 'cy@x.com', street: '1 Main St', city: 'Plano', state: 'IL', zip: '60545' } })).json();
ok(r.ok && T.subscriptions.length === 1 && T.contacts.find((c) => c.email === 'cy@x.com').tags.includes('Monthly Partner'), 'monthly gift creates subscription + Monthly Partner tag');
const inv = JSON.stringify({ type: 'invoice.paid', data: { object: { id: 'in_2', billing_reason: 'subscription_cycle', parent: { subscription_details: { subscription: 'sub_1' } }, amount_paid: 5000 } } });
await webhook(new Request('https://x/', { method: 'POST', body: inv, headers: { 'stripe-signature': sig(inv) } }));
ok(T.payments.some((p) => p.provider_id === 'pi_month2' && p.status === 'succeeded' && p.amount === 50), 'second month recorded and receipted (new Stripe event format)');
{ const ml = T.donor_letters.find((l) => l.recurring); const { letterKind } = await import('../functions/_letter.mjs');
  const months = (new Date(ml.next_after) - new Date()) / (30.4 * 864e5);
  ok(ml && ml.kind === 'monthly-first' && months > 1.8 && months < 5.2, 'monthly partner gets a letter, next one 2-5 months out');
  ok(await letterKind({ recurring: true, contact_id: ml.contact_id }) === null, 'no letter for the next monthly gift'); }

console.log('paypal');
r = await (await post(checkout, { kind: 'sponsorship', item: 'sapphire', provider: 'paypal', contact: { first: 'Di', last: 'Ko', email: 'di@x.com', street: '1 Main St', city: 'Plano', state: 'IL', zip: '60545' } })).json();
ok(r.orderID === 'ORDER1', 'PayPal order created');
r = await (await post(checkout, { action: 'capture', orderID: 'ORDER1' })).json();
ok(r.ok && r.receipt && T.sponsorships.length === 2, 'PayPal capture finalizes sponsorship + receipt');
console.log('sponsor by check');
r = await (await post(checkout, { action: 'pledge', kind: 'sponsorship', item: 'gold', display_name: 'Fox Dental', guests: 'A, B', contact: { first: 'Dana', last: 'Ellis', email: 'dana@fox.com', street: '1 Main', city: 'Yorkville', state: 'IL', zip: '60560' } })).json();
ok(r.ok && T.sponsorships.some((x) => x.sponsor_name === 'Fox Dental' && x.status === 'Committed' && x.method === 'Check' && x.amount === 10000), 'check sponsorship reserved as Committed');
ok(sent.some((e) => e.to[0] === 'dana@fox.com' && e.html.includes('15450 State Route 47')), 'check mailing instructions emailed');
r = await post(checkout, { action: 'pledge', kind: 'sponsorship', item: 'gold', contact: { first: 'Dana', last: 'Ellis', email: 'dana@fox.com', street: '1 Main', city: 'Yorkville', zip: '60560' } });
ok(r.status === 400, 'no duplicate sponsorship for the same sponsor');
console.log('support night rsvp');
const rsvp = (await import('../functions/rsvp.mjs')).default;
const sreminders = await import('../functions/support-reminders.mjs');
T.events.push({ id: 'evA', kind: 'support_night', starts_at: '2026-12-04T00:30:00Z', location: 'Plano', registration_open: true }, { id: 'evB', kind: 'support_night', starts_at: '2027-01-08T00:30:00Z', location: 'Plano', registration_open: true });
r = await (await post(submit, { form: 'support', data: { first_name: 'Mo', last_name: 'M', email: 'mo@x.com', event_id: 'evA', event_label: 'Thursday, December 3', children: [{ first: 'Ava', age_group: '3 years-5 years' }, { first: '', age_group: '' }] } })).json();
const sn = T.submissions.find((x) => x.id === r.id);
ok(sn.data.children.length === 1 && sn.admin.manage_token && sent.some((e) => e.to[0] === 'mo@x.com' && e.html.includes('Ava (3–5 years)')), 'registration saves each child with age group');
let sr = await sreminders.run(new Date('2026-11-30T14:00:00Z')); ok(sr.length === 0, 'no reminder 3 days out');
sr = await sreminders.run(new Date('2026-12-01T14:00:00Z')); ok(sr.includes(sn.id) && sent.some((e) => e.to[0] === 'mo@x.com' && /Reminder: Support Night/.test(e.subject) && e.html.includes(`r=${sn.id}.${sn.admin.manage_token}`)), 'reminder two days before with change/cancel link');
sr = await sreminders.run(new Date('2026-12-01T15:00:00Z')); ok(!sr.includes(sn.id), 'reminder sent once');
const ref = `${sn.id}.${sn.admin.manage_token}`;
r = await (await rsvp(new Request('https://x/?ref=' + ref))).json(); ok(r.ok && r.children[0].first === 'Ava' && r.nights.length >= 2, 'RSVP page loads with children and nights');
r = await (await rsvp(new Request('https://x/?ref=' + sn.id + '.wrong'))); ok(r.status === 404, 'wrong link refused');
r = await (await post(rsvp, { ref, action: 'update', event_id: 'evB', children: [{ first: 'Ava', age_group: '3 years-5 years' }, { first: 'Leo', age_group: 'Newborn-2 years' }] })).json();
ok(r.ok && sn.event_id === 'evB' && sn.data.children.length === 2, 'family changes night and adds a child');
r = await (await post(rsvp, { ref, action: 'cancel' })).json(); ok(r.ok && sn.status === 'Cancelled', 'family cancels');
console.log('camp scholarships');
const camp = (await import('../functions/camp.mjs')).default;
const reminders = await import('../functions/camp-reminders.mjs');
r = await (await post(submit, { form: 'camp', data: { adult_first: 'Kim', adult_last: 'Fox', email: 'kim@x.com', youth_first: 'Eli', camp_name: 'Camp Hope', camp_dates: 'June 8-12, 2026' } })).json();
ok(sent.some((e) => e.to[0] === "wendy@wearecalledtocare.com" && /New camp form/.test(e.subject)) && sent.some((e) => e.to[0] === "staff@example.org" && /New camp form/.test(e.subject)), "camp application alert also goes to Wendy");
const app = T.submissions.find((x) => x.id === r.id);
ok(app.admin.camp_end === '2026-06-12' && app.admin.followup_token, 'camp application gets end date + private follow-up link');
r = await camp(new Request('https://x/', { method: 'POST', body: JSON.stringify({ action: 'send_followup', id: app.id }) }));
ok(r.status === 403, 'follow-up request refused without staff sign-in');
r = await camp(new Request('https://x/', { method: 'POST', headers: { authorization: 'Bearer staff-jwt' }, body: JSON.stringify({ action: 'send_followup', id: app.id }) }));
ok(r.status === 200 && sent.some((e) => e.to[0] === 'kim@x.com' && /How was camp, Eli/.test(e.subject) && e.html.includes(`cf=${app.id}.${app.admin.followup_token}`)), 'staff sends follow-up request with private link');
app.status = 'Approved'; app.admin.followup_requested_at = '2026-06-01T00:00:00Z';
let n = await reminders.run(new Date('2026-06-15T15:00:00Z')); ok(n.length === 0, 'no reminder before a week has passed');
n = await reminders.run(new Date('2026-06-20T15:00:00Z')); ok(n.length === 1 && app.admin.reminder_sent_at, 'reminder sent one week after camp');
n = await reminders.run(new Date('2026-06-25T15:00:00Z')); ok(n.length === 0, 'reminder only sent once');
const tiny = 'data:image/jpeg;base64,' + Buffer.from('fakejpeg').toString('base64');
r = await (await post(submit, { form: 'camp_followup', ref: `${app.id}.${app.admin.followup_token}`, photos: [tiny, tiny], data: { youth_name: 'Eli Fox', guardian_name: 'Kim Fox', email: 'kim@x.com', camp_name: 'Camp Hope', youth_story: 'I learned to canoe!' } })).json();
const fu = T.submissions.find((x) => x.id === r.id);
ok(fu.data.photos.length === 2 && stored.length === 2, 'recap photos saved to private storage');
ok(app.status === 'Follow-up Received' && app.admin.followup_id === fu.id && fu.status === 'Linked', 'recap attached to the application');
console.log('sponsor letters');
{ const letter = (await import('../functions/letter.mjs')).default;
  const lpost = (body, auth) => letter(new Request('https://x/', { method: 'POST', headers: auth ? { authorization: 'Bearer staff-jwt' } : {}, body: JSON.stringify(body) }));
  const spc = T.contacts.find((c) => c.id === T.sponsorships[0].contact_id); spc.street = '1 Main St'; spc.city = 'Plano'; spc.zip = '60545';
  T.sponsorships.push({ contact_id: spc.id, year: 2025, status: 'Paid in Full' }, { contact_id: spc.id, year: 2026, status: 'Paid in Full' });
  const nobody = T.contacts.find((c) => !c.street && c.id !== spc.id);
  r = await lpost({ action: 'sponsors', contact_ids: [spc.id] }); ok(r.status === 403, 'sponsor letters need staff sign-in');
  r = await lpost({ action: 'sponsors', contact_ids: [spc.id, nobody.id] }, true);
  const buf = Buffer.from(await r.arrayBuffer()); const pages = (buf.toString('latin1').match(/\/Type \/Page /g) || []).length;
  ok(r.status === 200 && buf.subarray(0, 5).toString() === '%PDF-' && pages === 2 && r.headers.get('x-letters') === '2', 'two sponsors make one PDF with two pages');
  ok(buf.toString('latin1').includes('in 2025 and 2026'), 'letter names the years they sponsored');
  r = await lpost({ action: 'sponsors', contact_ids: [spc.id, nobody.id], skip_no_address: true }, true); ok(r.headers.get('x-letters') === '1', 'sponsors without an address can be left out');
  r = await lpost({ action: 'sponsors', contact_ids: [spc.id], text: { paragraphs: ['Thank you.'], signer: { name: 'Wendy Peterson', title: 'Event Chair' } } }, true);
  const sb2 = Buffer.from(await r.arrayBuffer()).toString('latin1'); ok(sb2.includes('Wendy Peterson') && sb2.includes('Event Chair') && !sb2.includes('Shari Chapman'), 'sponsor letters use their own signer');
  T.settings.push({ key: 'sponsor_letter', value: { paragraphs: ['Saved wording.'], closing: 'Warmly,', signer: { name: 'Jen Hall', title: 'Committee Director' } } });
  r = await lpost({ action: 'sponsors', contact_ids: [spc.id] }, true); const sb3 = Buffer.from(await r.arrayBuffer()).toString('latin1');
  ok(sb3.includes('Jen Hall') && sb3.includes('Committee Director') && sb3.includes('Warmly,'), 'saved sponsor signer and wording are used');
  const dl = await (await import('../functions/_letter.mjs')).letterSettings(); ok(dl.signer.name !== 'Jen Hall', 'donor letters keep their own signer'); }
console.log(`\n${pass} checks passed`);
