/**
 * AI relay: paid subscribers' AI calls run through here on the OWNER's
 * Anthropic key — users never supply their own. Guardrails, in order:
 *
 *   1. Auth: Bearer <activation code> (cs_/sub_) resolved live against Stripe
 *      (cached 10 min), or an admin token from ADMIN_TOKENS.
 *   2. Tier: Supreme-only features rejected for Pro tokens.
 *   3. Rate: per-token 20 requests/min and 3 concurrent.
 *   4. Budget: per-subscription monthly API-cost budget (PLAN_BUDGET_CENTS),
 *      persisted in the Stripe subscription's metadata — stateless server,
 *      durable across restarts, no database.
 *   5. Request hygiene: model allowlist, max_tokens cap, no streaming.
 *
 * Errors use the Anthropic error shape {error:{message}} so the extension's
 * existing error handling shows them verbatim.
 */
import { ALLOWED_MODELS, PLAN_BUDGET_CENTS, costCents, monthKey } from './pricing.js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ADMIN_TOKENS = new Set(
  (process.env.ADMIN_TOKENS || '').split(',').map((s) => s.trim()).filter(Boolean),
);

/** Features that need the Supreme tier (deep web research fan-out). */
const SUPREME_FEATURES = new Set(['degree-research', 'prereq-research']);

const LICENSE_TTL_MS = 10 * 60 * 1000;
const RATE_MAX_PER_MIN = 20;
const RATE_MAX_CONCURRENT = 3;
const MAX_TOKENS_CAP = 16000;

export const isAdminToken = (token) => ADMIN_TOKENS.has(token);

/** token -> {at, plan, active, subId} */
const licenseCache = new Map();
/** subId -> {month, cents} (mirror of subscription metadata) */
const usageCache = new Map();
/** token -> {stamps: number[], inFlight: number} */
const rate = new Map();

const err = (res, status, message) => res.status(status).json({ error: { message } });

export function mountRelay(app, stripe, resolveSubscription) {
  app.post('/ai/messages', async (req, res) => {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return err(res, 401, 'Not signed in — activate your subscription on the Upgrade page.');

    // --- auth ---
    let plan = 'supreme';
    let subId = null;
    if (!isAdminToken(token)) {
      let lic = licenseCache.get(token);
      if (!lic || Date.now() - lic.at > LICENSE_TTL_MS) {
        const sub = await resolveSubscription(token).catch(() => null);
        const active = sub ? ['active', 'trialing', 'past_due'].includes(sub.status) : false;
        lic = {
          at: Date.now(),
          active,
          plan: active ? planOfSubscription(sub) : 'free',
          subId: sub?.id ?? null,
          renewsAt: sub?.items?.data?.[0]?.current_period_end ?? null,
        };
        licenseCache.set(token, lic);
      }
      if (!lic.active) {
        return err(res, 401, 'Your subscription is not active. Renew it, then paste your activation code again on the Upgrade page.');
      }
      plan = lic.plan;
      subId = lic.subId;
    }

    // --- tier ---
    const feature = String(req.body?.feature ?? 'chat');
    if (SUPREME_FEATURES.has(feature) && plan !== 'supreme') {
      return err(res, 403, 'That feature runs deep web research and needs the Supreme plan.');
    }

    // --- rate ---
    const r = rate.get(token) ?? { stamps: [], inFlight: 0 };
    rate.set(token, r);
    const now = Date.now();
    r.stamps = r.stamps.filter((t) => now - t < 60_000);
    if (r.stamps.length >= RATE_MAX_PER_MIN || r.inFlight >= RATE_MAX_CONCURRENT) {
      return err(res, 429, 'Slow down a little — too many AI requests at once. Try again in a few seconds.');
    }
    r.stamps.push(now);

    // --- budget ---
    let usage = null;
    if (subId) {
      usage = await loadUsage(stripe, subId);
      const budget = PLAN_BUDGET_CENTS[plan] ?? PLAN_BUDGET_CENTS.pro;
      if (usage.cents >= budget) {
        return err(res, 402, "You've used this month's included AI budget — it resets at the start of next month. (Heavy month? Tell us and we'll look at your account.)");
      }
    }

    // --- request hygiene ---
    const request = req.body?.request;
    if (!request || typeof request !== 'object' || !Array.isArray(request.messages)) {
      return err(res, 400, 'Malformed relay request.');
    }
    if (!ANTHROPIC_API_KEY) {
      return err(res, 503, 'The AI relay is not configured yet (missing server API key).');
    }
    const model = ALLOWED_MODELS.includes(request.model) ? request.model : ALLOWED_MODELS[0];
    const payload = {
      ...request,
      model,
      stream: false,
      max_tokens: Math.min(Number(request.max_tokens) || MAX_TOKENS_CAP, MAX_TOKENS_CAP),
    };

    // --- forward ---
    r.inFlight += 1;
    try {
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
      });
      const body = await upstream.json().catch(() => ({ error: { message: `Upstream HTTP ${upstream.status}` } }));

      if (upstream.ok && subId && body?.usage) {
        usage.cents += costCents(model, body.usage);
        await saveUsage(stripe, subId, usage).catch((e) =>
          console.warn('usage persist failed (kept in memory)', e?.message),
        );
      }
      res.status(upstream.status).json(body);
    } catch (e) {
      console.error('relay forward failed', e);
      err(res, 502, 'Could not reach the AI service — try again in a minute.');
    } finally {
      r.inFlight -= 1;
    }
  });
}

function planOfSubscription(sub) {
  const key = sub?.items?.data?.[0]?.price?.lookup_key ?? '';
  return key.startsWith('wsc_supreme') ? 'supreme' : 'pro';
}

/** Current month's spend for a subscription, from cache or Stripe metadata. */
async function loadUsage(stripe, subId) {
  const month = monthKey();
  let u = usageCache.get(subId);
  if (!u) {
    const sub = await stripe.subscriptions.retrieve(subId).catch(() => null);
    try {
      const parsed = JSON.parse(sub?.metadata?.ai_usage ?? '');
      u = { month: parsed.month, cents: Number(parsed.cents) || 0 };
    } catch {
      u = { month, cents: 0 };
    }
    usageCache.set(subId, u);
  }
  if (u.month !== month) {
    u.month = month;
    u.cents = 0;
  }
  return u;
}

async function saveUsage(stripe, subId, u) {
  await stripe.subscriptions.update(subId, {
    metadata: { ai_usage: JSON.stringify({ month: u.month, cents: Math.round(u.cents * 100) / 100 }) },
  });
}
