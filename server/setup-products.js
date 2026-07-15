/**
 * One-time (idempotent) Stripe setup: creates the Pro and Supreme products with
 * monthly + yearly recurring prices, identified by stable lookup_keys the
 * server resolves at runtime. Safe to re-run — matching prices are reused, and
 * if an amount here differs from the live price, a NEW price is created and
 * the lookup_key is transferred to it (Stripe prices are immutable). Existing
 * subscribers keep their old price; new checkouts get the new one.
 *
 * Run: npm run setup   (uses STRIPE_SECRET_KEY from .env)
 */
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Pricing rationale (managed AI relay — subscribers use OUR API key):
 * each plan includes a monthly AI budget (see pricing.js PLAN_BUDGET_CENTS);
 * prices are set so a fully-used budget still leaves margin after Stripe fees.
 */
const PLANS = [
  {
    product: { name: 'Student Companion for Workday — Pro', description: 'AI Semester Advisor, AI degree-catalog parsing, and AI transcript parsing — no API key needed.' },
    prices: [
      { lookup_key: 'wsc_pro_month', unit_amount: 699, interval: 'month' },
      { lookup_key: 'wsc_pro_year', unit_amount: 6900, interval: 'year' },
    ],
  },
  {
    product: { name: 'Student Companion for Workday — Supreme', description: 'Everything in Pro plus auto-find degree requirements and course prerequisites via deep web research.' },
    prices: [
      { lookup_key: 'wsc_supreme_month', unit_amount: 1499, interval: 'month' },
      { lookup_key: 'wsc_supreme_year', unit_amount: 14900, interval: 'year' },
    ],
  },
];

const allKeys = PLANS.flatMap((p) => p.prices.map((x) => x.lookup_key));
const existing = await stripe.prices.list({ lookup_keys: allKeys, limit: 100 });
const byKey = new Map(existing.data.map((p) => [p.lookup_key, p]));

for (const plan of PLANS) {
  // Reuse the product if one of its prices already exists, else create it once.
  const anchor = plan.prices.map((p) => byKey.get(p.lookup_key)).find(Boolean);
  let productId = anchor ? anchor.product : null;

  for (const p of plan.prices) {
    const current = byKey.get(p.lookup_key);
    if (current && current.unit_amount === p.unit_amount) {
      console.log(`✓ ${p.lookup_key} already at $${(p.unit_amount / 100).toFixed(2)}/${p.interval}`);
      continue;
    }
    productId ??= (await stripe.products.create(plan.product)).id;
    const price = await stripe.prices.create({
      product: productId,
      currency: 'usd',
      unit_amount: p.unit_amount,
      recurring: { interval: p.interval },
      lookup_key: p.lookup_key,
      // Steal the lookup_key from the old price so runtime resolution
      // automatically picks up the new amount.
      transfer_lookup_key: true,
    });
    byKey.set(p.lookup_key, price);
    console.log(
      `${current ? '↺ repriced' : '+ created'} ${p.lookup_key} → ${price.id} ($${(p.unit_amount / 100).toFixed(2)}/${p.interval})`,
    );
    productId = price.product;
  }
}

console.log('\nPrice IDs (resolved by lookup_key at runtime — nothing to copy):');
for (const key of allKeys) console.log(`  ${key}: ${byKey.get(key)?.id ?? 'MISSING'}`);
