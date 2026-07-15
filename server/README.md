# WSC Billing Server + AI Relay

Tiny stateless backend that (a) sells Pro/Supreme subscriptions through Stripe
Checkout and lets the extension verify them, and (b) relays subscribers' AI
calls to Anthropic on the OWNER's API key — users never supply a key. No
database: the activation code is the Stripe Checkout Session id, every check
reads live status from Stripe, and each subscription's monthly AI spend is
persisted in its Stripe metadata.

## Local dev

```bash
cd server
npm install
npm run setup    # creates Pro/Supreme products + monthly/yearly prices (idempotent; reprices via transfer_lookup_key)
npm start        # http://localhost:8787
```

`.env` holds:

- `STRIPE_SECRET_KEY` — Stripe key (test now, live at launch)
- `ANTHROPIC_API_KEY` — the owner's Claude API key used by the AI relay
- `ADMIN_TOKENS` — comma-separated owner tokens (e.g. `adm_<long random>`);
  each acts as a permanent Supreme license with no budget — paste one into the
  extension's "Already paid?" box on your own devices
- `BASE_URL`, `PORT`

**Never commit `.env` or put any secret key in the extension.**

## AI relay (`POST /ai/messages`)

`Authorization: Bearer <activation code>` + `{feature, request}` →
verifies the subscription (10-min cache), enforces tier (research features are
Supreme-only), rate limits (20/min, 3 concurrent per token), enforces the
plan's monthly AI budget (`pricing.js` → Pro 300¢, Supreme 700¢ of API cost,
stored in subscription metadata), clamps the request (model allowlist,
max_tokens cap, no streaming), then forwards to `api.anthropic.com` and
returns the response verbatim. Errors use Anthropic's `{error:{message}}`
shape so the extension shows them as-is.

## Flow

1. Extension subscribe page → `POST /checkout {plan, interval}` → opens the
   returned Stripe Checkout URL in a new tab.
2. User pays (test card: `4242 4242 4242 4242`, any future expiry/CVC).
3. Stripe redirects to `/activated`, which shows the activation code.
4. User pastes the code into the extension → background calls
   `POST /license {token}` → plan unlocked, token stored, re-verified daily.

## Deploy (when ready to charge)

1. Push `server/` to a host — Render, Railway, or Fly all work with the
   included `npm start`. Set env vars `STRIPE_SECRET_KEY`, `ANTHROPIC_API_KEY`,
   `ADMIN_TOKENS`, `BASE_URL` (the public URL), `PORT` (most hosts inject this).
2. Complete Stripe account activation and switch `STRIPE_SECRET_KEY` to the
   **live** key; run `npm run setup` once against live mode.
3. On the Anthropic console, set a **monthly spend limit + alerts** on the
   relay's API key — the per-user budgets make overruns unlikely, but the hard
   cap is the backstop.
4. In the extension, set `BILLING_API_URL` in `src/shared/billing.ts` to the
   deployed URL, rebuild, and upload the new zip. Until that constant is set,
   the extension stays in free-beta mode (BYO-key AI) and never calls this
   server.
