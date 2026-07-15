/**
 * Billing backend for Student Companion for Workday.
 *
 * Stateless by design — no database. The activation code IS the Stripe
 * Checkout Session id (unguessable, shown only to the payer on the success
 * page); every license check resolves the current subscription status live
 * from Stripe, so cancellations propagate automatically.
 *
 * Endpoints:
 *   POST /checkout  {plan: 'pro'|'supreme', interval: 'month'|'year'} -> {url}
 *   POST /license   {token: 'cs_...'|'sub_...'} -> {active, plan, status, renewsAt}
 *   GET  /activated?session_id=...      -> human success page with the code
 *   GET  /cancelled                     -> human cancel page
 *   GET  /health                        -> {ok: true}
 */
import express from 'express';
import Stripe from 'stripe';
import { isAdminToken, mountRelay } from './relay.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const BASE_URL = process.env.BASE_URL || 'http://localhost:8787';
const PORT = Number(process.env.PORT || 8787);

/** plan+interval -> price lookup_key (created by setup-products.js) */
const LOOKUP = {
  'pro:month': 'wsc_pro_month',
  'pro:year': 'wsc_pro_year',
  'supreme:month': 'wsc_supreme_month',
  'supreme:year': 'wsc_supreme_year',
};
/** price lookup_key -> plan, for mapping a subscription back to a tier */
const KEY_TO_PLAN = { wsc_pro_month: 'pro', wsc_pro_year: 'pro', wsc_supreme_month: 'supreme', wsc_supreme_year: 'supreme' };

const app = express();
// Degree-catalog pages relayed for AI parsing can be a few hundred KB of text.
app.use(express.json({ limit: '2mb' }));
// The extension pages call these endpoints from a chrome-extension:// origin.
// Nothing here is secret without a token, so a permissive CORS policy is fine.
app.use((_req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});
app.options('*', (_req, res) => res.sendStatus(204));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/checkout', async (req, res) => {
  try {
    const { plan, interval } = req.body ?? {};
    const key = LOOKUP[`${plan}:${interval}`];
    if (!key) return res.status(400).json({ error: 'Unknown plan/interval.' });
    const prices = await stripe.prices.list({ lookup_keys: [key], limit: 1 });
    const price = prices.data[0];
    if (!price) return res.status(500).json({ error: 'Price not configured — run setup-products.js.' });
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: price.id, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${BASE_URL}/activated?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/cancelled`,
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error('checkout failed', e);
    res.status(500).json({ error: 'Could not start checkout. Try again in a minute.' });
  }
});

/** Resolve a token (checkout session id or subscription id) to a subscription. */
async function resolveSubscription(token) {
  if (token.startsWith('cs_')) {
    const session = await stripe.checkout.sessions.retrieve(token, { expand: ['subscription'] });
    return typeof session.subscription === 'string'
      ? await stripe.subscriptions.retrieve(session.subscription)
      : session.subscription;
  }
  if (token.startsWith('sub_')) return stripe.subscriptions.retrieve(token);
  return null;
}

// POST with the token in the body — a bearer-style credential in a GET query
// string would end up in hosting/proxy access logs.
app.post('/license', async (req, res) => {
  try {
    const token = String(req.body?.token ?? '');
    if (!token) return res.status(400).json({ error: 'Missing token.' });
    // Owner/admin tokens (ADMIN_TOKENS env) act as a permanent Supreme license.
    if (isAdminToken(token)) {
      return res.json({ active: true, plan: 'supreme', status: 'admin', renewsAt: null });
    }
    const sub = await resolveSubscription(token).catch(() => null);
    if (!sub) return res.json({ active: false, plan: 'free', status: 'not-found' });
    const key = sub.items?.data?.[0]?.price?.lookup_key ?? '';
    const plan = KEY_TO_PLAN[key] ?? 'pro';
    // 'trialing' and 'past_due' still grant access; canceled/unpaid do not.
    const active = ['active', 'trialing', 'past_due'].includes(sub.status);
    res.json({
      active,
      plan: active ? plan : 'free',
      status: sub.status,
      renewsAt: sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end ?? null,
    });
  } catch (e) {
    console.error('license check failed', e);
    res.status(500).json({ error: 'License check failed. Try again in a minute.' });
  }
});

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui;max-width:560px;margin:60px auto;padding:0 20px;color:#1f2937}
.code{font-family:ui-monospace,monospace;background:#f3f4f6;border:1px solid #d1d5db;border-radius:8px;padding:12px;word-break:break-all;font-size:14px}
button{margin-top:10px;padding:8px 14px;border-radius:8px;border:1px solid #7c3aed;background:#7c3aed;color:#fff;font-size:14px;cursor:pointer}
.muted{color:#6b7280;font-size:14px}</style></head><body>${body}</body></html>`;

app.get('/activated', (req, res) => {
  const sid = String(req.query.session_id ?? '');
  res.send(
    page(
      'Payment complete',
      `<h1>🎉 You're in!</h1>
       <p>Copy your <b>activation code</b> below, then open the extension's <b>Upgrade</b> page and paste it under “Already paid?”.</p>
       <div class="code" id="code">${sid.replace(/[^a-zA-Z0-9_]/g, '')}</div>
       <button onclick="navigator.clipboard.writeText(document.getElementById('code').textContent)">Copy code</button>
       <p class="muted">Keep this code — it's how the extension verifies your subscription on this and other devices.</p>`,
    ),
  );
});

app.get('/cancelled', (_req, res) => {
  res.send(page('Checkout cancelled', `<h1>Checkout cancelled</h1><p>No charge was made. You can close this tab.</p>`));
});

mountRelay(app, stripe, resolveSubscription);

app.listen(PORT, () => console.log(`wsc-billing-server listening on ${BASE_URL} (port ${PORT})`));
