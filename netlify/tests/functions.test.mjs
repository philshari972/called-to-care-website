// End-to-end checks for the server functions with Supabase, Stripe, PayPal and Resend replaced by fakes.
// Run: node netlify/tests/functions.test.mjs
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

Object.assign(process.env, {
  SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PUBLISHABLE_KEY: 'pk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_test', PAYPAL_CLIENT_ID: 'pp', PAYPAL_SECRET: 'pps', RESEND_API_KEY: 're_x', SITE_URL: 'https://example.org',
});

// ---- tiny in-memory PostgREST ----
const T = { baskets: [], donor_letters: [], contacts: [], submissions: [], payments: [], sponsorships: [], attendance: [], subscriptions: [], email_log: [], email_campaigns: [], email_sends: [], events: [], settings: [{ key: 'tickets_on', value: false }, { key: 'staff_alert_email', value: ['staff@example.org', 'boss@example.org'] }, { key: 'org', value: { legal_name: 'We Are Called to Care, NFP', ein: '86-2900453' } }] };
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
  if (path === 'rpc/email_start') { const c = T.email_campaigns.find((x) => x.id === body.p_campaign); if (c.status !== 'draft') return c.total;
    const aud = T.contacts.filter((p) => p.email && p.email_ok !== false && !p.do_not_email && (c.audience.mode === 'all' || (p.tags || []).some((t) => c.audience.tags.includes(t))));
    aud.forEach((p) => T.email_sends.push({ campaign_id: c.id, contact_id: p.id, email: p.email, status: 'queued' })); c.total = aud.length; if (aud.length) c.status = 'sending'; return aud.length; }
  if (path === 'rpc/email_claim') { const q = T.email_sends.filter((x) => x.campaign_id === body.p_campaign && x.status === 'queued').slice(0, body.p_n); q.forEach((x) => { x.status = 'sending'; });
    return q.map((x) => { const p = T.contacts.find((y) => y.id === x.contact_id); return { contact_id: x.contact_id, email: x.email, first_name: p.first_name, unsub_token: p.unsub_token }; }); }
  if (path === 'rpc/email_tally') { const mine = T.email_sends.filter((x) => x.campaign_id === body.p_campaign); const c = T.email_campaigns.find((x) => x.id === body.p_campaign);
    const t = { sent: mine.filter((x) => x.status === 'sent').length, failed: mine.filter((x) => x.status === 'failed').length, left: mine.filter((x) => ['queued', 'sending'].includes(x.status)).length };
    Object.assign(c, { sent: t.sent, failed: t.failed }); if (c.status === 'sending' && !t.left) c.status = 'sent'; return t; }
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
  if (m === 'DELETE') { const hit = tbl.filter((r) => match(r, params)); hit.forEach((r) => tbl.splice(tbl.indexOf(r), 1)); return null; }
  if (m === 'PATCH') { const hit = tbl.filter((r) => match(r, params)); hit.forEach((r) => Object.assign(r, body)); return init.headers.prefer?.includes('representation') ? hit : null; }
}
const sent = []; const stripeCalls = []; const stored = []; const batches = []; let resendMode = '';
globalThis.fetch = async (url, init = {}) => {
  url = String(url); const ok = (o, s = 200) => new Response(o == null ? '' : JSON.stringify(o), { status: s });
  if (url.startsWith('https://db.test/rest/v1/')) { try { return ok(rest(url, init)); } catch (e) { return ok({ message: e.message }, 409); } }
  if (url.startsWith('https://db.test/storage/v1/object/camp-photos/')) { stored.push(url); return ok({ Key: url }); }
  if (url === 'https://api.resend.com/emails/batch') { const list = JSON.parse(init.body); batches.push(list);
    if (resendMode === 'quota') return ok({ name: 'daily_quota_exceeded', message: 'You have reached your daily email sending quota' }, 429);
    if (list.some((e) => e.to[0] === 'reject@x.com')) return ok({ name: 'validation_error', message: 'Invalid `to` field' }, 422);
    list.forEach((e) => sent.push(e)); return ok({ data: list.map((_, i) => ({ id: `b${batches.length}_${i}` })) }); }
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
console.log('weekly support night report');
{ const rep = await import('../functions/support-report.mjs'); const keep = { ev: [...T.events], sub: [...T.submissions], set: [...T.settings] };
  const now = new Date('2026-11-25T13:00:00Z');   // Wednesday, 7 AM in Illinois
  const ev = { id: uid(), kind: 'support_night', title: 'Support Night', starts_at: '2026-12-04T00:30:00Z', location: 'Called to Care, Plano' };   // Thursday Dec 3, 6:30 PM
  const later = { id: uid(), kind: 'support_night', title: 'Support Night', starts_at: '2027-01-15T00:30:00Z', location: 'Called to Care, Plano' };
  T.events.length = 0; T.events.push(ev, later, { id: uid(), kind: 'support_night', starts_at: '2026-11-13T00:30:00Z' });
  const reg = (kids, extra = {}) => T.submissions.push({ id: uid(), form: 'support', event_id: ev.id, status: 'New', created_at: '2026-11-10T12:00:00Z', data: { first_name: 'Secret', last_name: 'Name', email: 'mom@x.com', children: kids.map(([first, age_group]) => ({ first, age_group })) }, ...extra });
  T.submissions.length = 0;
  reg([['Ava', 'Newborn-2 years'], ['Ben', '3 years-5 years'], ['Cy', '3 years-5 years']]); reg([['Dee', '1st Grade - 5th Grade']], { created_at: '2026-11-22T12:00:00Z' }); reg([]); reg([['Eli', '']]);
  const named = (i, f, l) => { T.submissions[i].data.first_name = f; T.submissions[i].data.last_name = l; }; named(0, 'Zoe', 'Young'); named(1, 'Amy', 'Baker'); named(2, 'Bea', 'adams'); named(3, 'Cat', 'Baker');
  reg([['Gone', 'Newborn-2 years']], { status: 'Cancelled' }); T.submissions[4].data.first_name = 'Quit'; T.submissions[4].data.last_name = 'Person'; T.submissions.push({ id: uid(), form: 'contact', event_id: ev.id, status: 'New', created_at: '2026-11-28T12:00:00Z', data: {} });
  T.settings.push({ key: 'childcare_ratios', value: [1, 2, 4] });
  const t = rep.tally(T.submissions.filter((x) => x.form === 'support'), [1, 2, 4], now);
  ok(t.moms === 4 && t.kids === 5 && t.cancelled === 1 && t.fresh === 1, 'counts moms and kids, leaving out cancellations');
  ok(JSON.stringify(t.groups.map((g) => [g.label, g.kids, g.volunteers])) === JSON.stringify([['Newborn–2 years', 1, 1], ['3–5 years', 2, 1], ['1st–5th grade', 1, 1], ['Age not given', 1, 1]]) && t.volunteers === 4, 'kids are broken down by age group, with childcare volunteers from the Settings ratios');
  const n0 = sent.length; r = await rep.run(now); const mine = sent.slice(n0);
  ok(r.sent === 4 && mine.map((m) => m.to[0]).sort().join() === 'jen@wearecalledtocare.com,mattieellapatrick@gmail.com,phil@wearecalledtocare.com,shari@wearecalledtocare.com', 'goes to Shari, Mattie, Phil and Jen');
  ok(mine[0].subject === 'Support Night December 3: 4 moms, 5 kids' && mine[0].html.includes('Thursday, December 3') && mine[0].html.includes('8 days away'), 'subject and date are for the next Support Night');
  const h = mine[0].html; const order = ['Bea adams', 'Amy Baker', 'Cat Baker', 'Zoe Young'].map((n) => h.indexOf(n));
  ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])) && !h.includes('Quit Person'), 'lists who is registered, by last name, without anyone who cancelled');
  ok(h.includes('3: Newborn–2 years, 2 × 3–5 years') && h.includes('1: age not given') && !h.includes('Ava') && !h.includes('Cy') && !h.includes('mom@x.com'), 'each mom shows how many kids and their age groups, never the children\'s names or her email');
  ok(!h.includes('January 14'), 'a later night with nobody signed up is left off');
  T.settings.push({ key: 'support_report_names', value: false }); const q0 = sent.length; await rep.run(now); const off = sent[q0].html;
  ok(!off.includes('Zoe Young') && !off.includes('Who is registered') && off.includes('See Who Is Registered') && off.includes('Names are kept in the admin') && off.includes('Moms registered'), 'with the list switched off in Settings, it goes back to numbers and the button');
  T.settings.pop();
  const at = (iso) => rep.run(new Date(iso), true).then((x) => x.sent);
  ok(await at('2026-11-25T13:00:00Z') === 4 && await at('2026-11-27T13:00:00Z') === 4, 'sends Wednesday and Friday at 7 AM');
  ok(await at('2026-11-25T12:00:00Z') === 0 && await at('2026-11-25T14:00:00Z') === 0 && await at('2026-11-24T13:00:00Z') === 0, 'not at 6 AM or 8 AM, and not on other days');
  ok(await at('2026-07-01T12:00:00Z') === 4 && await at('2026-07-01T13:00:00Z') === 0, 'still 7 AM after the clocks change for summer');
  ok(await at('2026-11-26T13:00:00Z') === 0, 'a Thursday with no Support Night sends nothing');
  const n3 = sent.length; ok(await at('2026-12-03T13:00:00Z') === 4 && sent[n3].html.includes('Support Night is tonight') && sent[n3].html.includes('(tonight)'), 'the Thursday of Support Night sends the final numbers that morning');
  ok(await at('2026-12-04T13:00:00Z') === 0 || !sent[sent.length - 1].html.includes('December 3'), 'the Friday after reports the next Support Night, not the one that just happened');
  T.settings.push({ key: 'support_report_email', value: ['wendy@wearecalledtocare.com', 'not an email'] }); const n1 = sent.length; r = await rep.run(now);
  ok(r.sent === 1 && sent[n1].to[0] === 'wendy@wearecalledtocare.com', 'the list of who gets it can be changed in Settings');
  T.events.length = 0; const n2 = sent.length; r = await rep.run(now); ok(r.sent === 0 && sent.length === n2, 'nothing is sent when no Support Night is on the calendar');

  T.events.length = 0; T.events.push(...keep.ev); T.submissions.length = 0; T.submissions.push(...keep.sub); T.settings.length = 0; T.settings.push(...keep.set); }
console.log('email list');
{ const send = (await import('../functions/email-send.mjs')).default; const unsub = (await import('../functions/unsubscribe.mjs')).default;
  const hook = await import('../functions/resend-webhook.mjs');
  const epost = (body, staff = true) => send(new Request('https://x/', { method: 'POST', body: JSON.stringify(body), headers: staff ? { authorization: 'Bearer staff-jwt' } : {} }));
  T.contacts.length = 0;
  const mk = (email, first, tags, extra = {}) => { const c = { id: uid(), email, first_name: first, tags, email_ok: true, do_not_email: false, do_not_email_reason: '', unsub_token: uid(), ...extra }; T.contacts.push(c); return c; };
  const amy = mk('amy@x.com', 'Amy Jo', ['Foster Parents']), ben = mk('ben@x.com', '', ['Foster Parents', 'Volunteer']); mk('cat@x.com', 'Cat', ['Volunteer']);
  mk('gone@x.com', 'Gone', ['Foster Parents'], { do_not_email: true, do_not_email_reason: 'Unsubscribed', email_ok: false }); mk('reject@x.com', 'Rex', ['Foster Parents']);
  const html = '<p>Hi {{first_name}},</p><p>News for you & yours.</p><a href="{{unsubscribe_url}}">Unsubscribe</a>' + ' '.repeat(40);
  const camp = { id: uid(), name: 'Support Night', subject: 'Support Night, {{first_name}}', html, reply_to: 'jen@wearecalledtocare.com', audience: { mode: 'tags', tags: ['Foster Parents'], skip: [] }, status: 'draft', total: 0, sent: 0, failed: 0 };
  T.email_campaigns.push(camp);
  r = await epost({ action: 'start', id: camp.id }, false); ok(r.status === 403, 'only signed-in staff with edit access can send');
  const before = sent.length;
  r = await (await epost({ action: 'test', subject: camp.subject, html, to: ['phil@x.com', 'not-an-email'], first_name: 'Phil' })).json();
  const test = sent[sent.length - 1];
  ok(r.ok && r.sent === 1 && sent.length === before + 1 && test.subject === '[Test] Support Night, Phil' && test.html.includes('Hi Phil,') && !test.html.includes('{{'), 'test email goes only to the address typed, with the name filled in');
  r = await (await epost({ action: 'start', id: camp.id })).json();
  ok(r.ok && r.total === 3 && camp.status === 'sending' && !T.email_sends.some((x) => x.email === 'gone@x.com' || x.email === 'cat@x.com'), 'audience is the chosen tag, minus anyone unsubscribed');
  r = await (await epost({ action: 'start', id: camp.id })).json(); ok(r.total === 3 && T.email_sends.length === 3, 'pressing Send twice does not line people up twice');
  const b0 = sent.length;
  r = await (await epost({ action: 'batch', id: camp.id })).json();
  const toAmy = sent.find((e, i) => i >= b0 && e.to[0] === 'amy@x.com'), toBen = sent.find((e, i) => i >= b0 && e.to[0] === 'ben@x.com');
  ok(r.done && r.sent === 2 && r.failed === 1 && camp.status === 'sent', 'everyone is sent to; the one address the mail service rejects is marked failed, not the whole group');
  ok(toAmy.subject === 'Support Night, Amy' && toAmy.html.includes('Hi Amy,') && toBen.html.includes('Hi Friend,') && toAmy.reply_to === 'jen@wearecalledtocare.com', 'each email is personal: first name, or "Friend" when we have none');
  ok(toAmy.html.includes(`https://example.org/unsubscribe?t=${amy.unsub_token}`) && toAmy.headers['List-Unsubscribe'] === `<https://example.org/unsubscribe?t=${amy.unsub_token}>` && toAmy.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click' && !toBen.html.includes(amy.unsub_token), 'every email carries that person\'s own unsubscribe link');
  ok(T.email_sends.find((x) => x.email === 'amy@x.com').provider_id && T.email_sends.find((x) => x.email === 'reject@x.com').status === 'failed', 'each send is recorded');
  const n = sent.length; r = await (await epost({ action: 'batch', id: camp.id })).json(); ok(r.done && sent.length === n, 'a finished email cannot be sent again');

  const camp2 = { ...camp, id: uid(), audience: { mode: 'all' }, status: 'draft', total: 0, sent: 0, failed: 0 }; T.email_campaigns.push(camp2);
  await epost({ action: 'start', id: camp2.id }); resendMode = 'quota';
  r = await (await epost({ action: 'batch', id: camp2.id })).json();
  ok(!r.done && /limit/i.test(r.stop) && r.left === 4 && T.email_sends.filter((x) => x.campaign_id === camp2.id).every((x) => x.status === 'queued'), 'when the mail service hits its limit, sending pauses and nobody is lost');
  resendMode = ''; r = await (await epost({ action: 'cancel', id: camp2.id })).json();
  ok(camp2.status === 'canceled' && !T.email_sends.some((x) => x.campaign_id === camp2.id), 'a send under way can be stopped');
  const camp3 = { ...camp, id: uid(), html: '<p>No link</p>', status: 'draft' }; T.email_campaigns.push(camp3);
  r = await epost({ action: 'start', id: camp3.id }); ok(r.status === 400 && camp3.status === 'draft', 'an email without an unsubscribe link is refused');

  const page = (method, t, body) => unsub(new Request(`https://example.org/unsubscribe?t=${t}`, { method, body, headers: body ? { 'content-type': 'application/x-www-form-urlencoded' } : {} }));
  r = await page('GET', amy.unsub_token); let txt = await r.text();
  ok(r.status === 200 && txt.includes('amy@x.com') && /Yes, unsubscribe me/.test(txt) && !amy.do_not_email, 'opening the unsubscribe link asks first (mail scanners cannot unsubscribe anyone)');
  r = await page('POST', amy.unsub_token, 'List-Unsubscribe=One-Click'); txt = await r.text();
  ok(amy.do_not_email && amy.do_not_email_reason === 'Unsubscribed' && amy.email_ok === false && /unsubscribed/i.test(txt), 'confirming (or one-click in Gmail) unsubscribes');
  r = await page('POST', amy.unsub_token, 'again=1'); ok(!amy.do_not_email && amy.email_ok === true, 'someone who unsubscribed by mistake can put themselves back');
  ben.do_not_email = true; ben.do_not_email_reason = 'Bounced'; await page('POST', ben.unsub_token, 'again=1'); ok(ben.do_not_email, 'a bounced address cannot switch itself back on');
  r = await page('GET', 'nope'); ok(r.status === 404, 'a broken unsubscribe link shows a helpful page');

  process.env.RESEND_WEBHOOK_SECRET = 'whsec_' + Buffer.from('shhh-secret').toString('base64');
  const hpost = (ev, good = true) => { const body = JSON.stringify(ev), id = 'msg_1', ts = String(Math.floor(Date.now() / 1000));
    const sg = crypto.createHmac('sha256', Buffer.from('shhh-secret')).update(`${id}.${ts}.${body}`).digest('base64');
    return hook.default(new Request('https://x/', { method: 'POST', body, headers: { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': good ? `v1,${sg}` : 'v1,AAAA' } })); };
  const pid = T.email_sends.find((x) => x.email === 'amy@x.com').provider_id;
  r = await hpost({ type: 'email.bounced', data: { to: ['amy@x.com'], email_id: pid, bounce: { type: 'Permanent' } } }, false); ok(r.status === 401 && !amy.do_not_email, 'a forged bounce notice is refused');
  r = await hpost({ type: 'email.bounced', data: { to: ['Amy@X.com'], email_id: pid, bounce: { type: 'Permanent' } } });
  ok(r.status === 200 && amy.do_not_email && amy.do_not_email_reason === 'Bounced' && T.email_sends.find((x) => x.provider_id === pid).status === 'failed', 'a bounced address is marked Do Not Email');
  const cat = T.contacts.find((c) => c.email === 'cat@x.com'); await hpost({ type: 'email.complained', data: { to: ['cat@x.com'] } }); ok(cat.do_not_email_reason === 'Marked as spam', 'a spam complaint is marked Do Not Email');
  const rex = T.contacts.find((c) => c.email === 'reject@x.com'); await hpost({ type: 'email.bounced', data: { to: ['reject@x.com'], bounce: { type: 'Transient' } } }); ok(!rex.do_not_email, 'a temporary bounce (full inbox) changes nothing'); }
console.log('pages');
{ // Every page's own code must at least parse: one stray apostrophe stops a whole page from working.
  const fs = await import('node:fs'); const vm = await import('node:vm'); const root = new URL('../../', import.meta.url);
  for (const file of ['index.html', 'admin/index.html', 'auction/index.html', 'auction/reveal.html']) {
    const html = fs.readFileSync(new URL(file, root), 'utf8'); let bad = '';
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="(?:application\/(?:ld\+)?json|text\/template)")[^>]*>([\s\S]*?)<\/script>/g)) {
      try { new vm.Script(m[1]); } catch (e) { bad = `${e.message} near: ${String(e.stack).split('\n')[1] || ''}`.slice(0, 200); break; } }
    ok(!bad, `${file}: the page's code has no typos that would stop it${bad ? ' (' + bad + ')' : ''}`);
  }
  let bad = ''; try { new vm.Script(fs.readFileSync(new URL('admin/email.js', root), 'utf8')); } catch (e) { bad = e.message; }
  ok(fs.existsSync(new URL('admin/vendor/html2canvas.min.js', root)) && fs.existsSync(new URL('admin/vendor/jspdf.umd.min.js', root)) && fs.existsSync(new URL('assets/shade-project-logo.png', root)) && fs.existsSync(new URL('assets/logo-navy.png', root)), 'files the emails and newsletter PDF need are in place');
  ok(!bad, 'admin/email.js parses'); }
console.log(`\n${pass} checks passed`);
