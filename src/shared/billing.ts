/**
 * Billing backend configuration.
 *
 * While this is '' the extension is in FREE-BETA mode: the subscribe page
 * activates plans locally at no charge and never contacts a server. To turn on
 * real billing, deploy server/ (see server/README.md) and set its public URL
 * here, e.g. 'https://wsc-billing.onrender.com' — the subscribe page then
 * switches to real Stripe Checkout + activation codes.
 */
export const BILLING_API_URL = 'https://wsc-billing.onrender.com';

export const billingEnabled = (): boolean => BILLING_API_URL.length > 0;

export interface LicenseStatus {
  active: boolean;
  plan: 'free' | 'pro' | 'supreme';
  status: string;
  /** end of the paid period, in Stripe epoch SECONDS (null for owner unlock) */
  renewsAt: number | null;
  /** cancelled but paid through renewsAt — access continues until then */
  cancelAtPeriodEnd?: boolean;
}

/**
 * Whole days from now until a Stripe period end. Rounded UP, so the last
 * partial day still reads "1 day left" rather than "0"; never negative.
 */
export function daysUntil(renewsAt: number | null, now: number = Date.now()): number | null {
  if (!renewsAt) return null;
  const ms = renewsAt * 1000 - now;
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

/** "March 3, 2026" for a Stripe epoch-seconds timestamp. */
export function formatPeriodEnd(renewsAt: number | null): string {
  if (!renewsAt) return '';
  return new Date(renewsAt * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export interface SubscriptionSummary {
  /** headline line, e.g. "Renews in 12 days" */
  headline: string;
  /** supporting line with the exact date and what happens then */
  detail: string;
  /** true while the subscription is cancelled but still inside the paid period */
  ending: boolean;
}

/** Human wording for the subscription card — plan-agnostic, tested directly. */
export function summarizeSubscription(
  license: LicenseStatus,
  now: number = Date.now(),
): SubscriptionSummary {
  if (license.status === 'admin') {
    return { headline: 'Owner unlock', detail: 'Permanent access — no subscription, nothing to cancel.', ending: false };
  }
  if (license.status === 'canceled' || !license.active) {
    return {
      headline: 'Not active',
      detail: `This subscription is ${license.status === 'not-found' ? 'unknown to the billing system' : license.status}. Subscribe again to restore AI features.`,
      ending: false,
    };
  }
  const days = daysUntil(license.renewsAt, now);
  const when = formatPeriodEnd(license.renewsAt);
  const dayWord = days === 1 ? 'day' : 'days';
  if (license.cancelAtPeriodEnd) {
    return {
      headline: days === null ? 'Cancelled' : days === 0 ? 'Ends today' : `Ends in ${days} ${dayWord}`,
      detail: when
        ? `Cancelled — you keep every paid feature until ${when}, then drop to Free. You can resume before then.`
        : 'Cancelled — you keep every paid feature until the period ends.',
      ending: true,
    };
  }
  if (license.status === 'past_due') {
    return {
      headline: 'Payment failed',
      detail: 'Stripe is retrying your card. Access continues for now — update your card from the receipt email to avoid losing it.',
      ending: false,
    };
  }
  const verb = license.status === 'trialing' ? 'Trial ends' : 'Renews';
  return {
    headline: days === null ? 'Active' : days === 0 ? `${verb} today` : `${verb} in ${days} ${dayWord}`,
    detail: when ? `Next charge on ${when}. Cancel any time — you keep access through that date.` : 'Cancel any time.',
    ending: false,
  };
}
