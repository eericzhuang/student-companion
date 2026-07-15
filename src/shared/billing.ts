/**
 * Billing backend configuration.
 *
 * While this is '' the extension is in FREE-BETA mode: the subscribe page
 * activates plans locally at no charge and never contacts a server. To turn on
 * real billing, deploy server/ (see server/README.md) and set its public URL
 * here, e.g. 'https://wsc-billing.onrender.com' — the subscribe page then
 * switches to real Stripe Checkout + activation codes.
 */
export const BILLING_API_URL = '';

export const billingEnabled = (): boolean => BILLING_API_URL.length > 0;

export interface LicenseStatus {
  active: boolean;
  plan: 'free' | 'pro' | 'supreme';
  status: string;
  renewsAt: number | null;
}
