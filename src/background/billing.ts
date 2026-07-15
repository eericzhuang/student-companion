/**
 * License activation & verification against the billing backend (server/).
 * Only used when BILLING_API_URL is set — in free-beta mode nothing here runs.
 * The activation code is a Stripe Checkout Session id; the backend resolves it
 * to the live subscription, so cancellations propagate on the daily re-check.
 */
import { BILLING_API_URL, billingEnabled, type LicenseStatus } from '../shared/billing';
import { getStored, updateStored } from '../shared/storage';

async function fetchLicense(token: string): Promise<LicenseStatus> {
  // POST body, not a query param — tokens in URLs land in server access logs.
  const res = await fetch(`${BILLING_API_URL}/license`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    throw new Error('The billing server could not be reached — try again in a minute.');
  }
  return (await res.json()) as LicenseStatus;
}

/** Verify an activation code and, if valid, store it and switch the plan. */
export async function activateLicense(code: string): Promise<LicenseStatus> {
  const token = code.trim();
  // cs_/sub_ = Stripe codes; adm_ = owner/admin tokens (server ADMIN_TOKENS).
  if (!/^(cs_|sub_|adm_)/.test(token)) {
    throw new Error('That doesn\'t look like an activation code — it starts with "cs_" and is shown right after checkout.');
  }
  const license = await fetchLicense(token);
  if (!license.active) {
    throw new Error(
      license.status === 'not-found'
        ? 'No subscription found for that code. Copy it exactly from the post-checkout page.'
        : `That subscription is not active (status: ${license.status}).`,
    );
  }
  await updateStored('settings', (s) => ({ ...s, plan: license.plan, licenseToken: token }));
  return license;
}

/**
 * Daily re-check: if the stored subscription lapsed, drop back to free.
 * Owner/admin unlock is independent and never touched. Network failures leave
 * the plan as-is — a flaky connection must not lock a paying user out.
 */
export async function refreshLicense(): Promise<void> {
  if (!billingEnabled()) return;
  const settings = await getStored('settings');
  if (!settings.licenseToken) return;
  let license: LicenseStatus;
  try {
    license = await fetchLicense(settings.licenseToken);
  } catch {
    return;
  }
  const nextPlan = license.active ? license.plan : 'free';
  if (nextPlan !== settings.plan) {
    await updateStored('settings', (s) => ({ ...s, plan: nextPlan }));
  }
}
