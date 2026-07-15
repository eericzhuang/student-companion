/**
 * Subscription page. Two modes, switched by BILLING_API_URL (shared/billing.ts):
 *  - Free-beta (URL unset): plans activate locally at no charge.
 *  - Real billing (URL set): buttons open Stripe Checkout via the billing
 *    backend (server/), and an activation-code box verifies the subscription.
 */
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Settings } from '../shared/types';
import { getStored, onStoredChange } from '../shared/storage';
import { isPro } from '../shared/plan';
import { sendToBackground } from '../background/messages';
import { BILLING_API_URL, billingEnabled, type LicenseStatus } from '../shared/billing';

// Pricing (managed AI relay — AI is included, subscribers never need a key):
// each plan carries a monthly AI allowance (Pro ~$3, Supreme ~$7 of API cost,
// enforced by the relay), so even a fully-used allowance leaves margin after
// Stripe's ~2.9%+30¢. Typical users consume a fraction of it. A deep-research
// run costs ~$0.20–0.50, hence Supreme's own tier. Yearly ≈ 2 months free.
// Amounts must match server/setup-products.js.
const PRICE = '$6.99';
const YEARLY = '$69';
const SUPREME_PRICE = '$14.99';
const SUPREME_YEARLY = '$149';

/** Feature-access matrix: exactly which plan unlocks which function. */
const MATRIX: Array<{ feature: string; free: boolean; pro: boolean; supreme: boolean }> = [
  { feature: '📅 Live schedule calendar + conflict detection', free: true, pro: true, supreme: true },
  { feature: '⭐ RateMyProfessors ratings, comments & bulk panel', free: true, pro: true, supreme: true },
  { feature: '🗂 Multi-degree progress, overlap & semester board', free: true, pro: true, supreme: true },
  { feature: '📄 Transcript & degree import (rule-based parser)', free: true, pro: true, supreme: true },
  { feature: '✍ Manual requirement verdicts & prerequisites editor', free: true, pro: true, supreme: true },
  { feature: '🤖 AI transcript parsing', free: false, pro: true, supreme: true },
  { feature: '🤖 AI degree-catalog parsing (paste a URL)', free: false, pro: true, supreme: true },
  { feature: '✨ AI Semester Advisor chat (web-verified answers)', free: false, pro: true, supreme: true },
  { feature: '🕘 AI history log', free: false, pro: true, supreme: true },
  { feature: '🎬 Premium animated interface', free: false, pro: true, supreme: true },
  { feature: '🎓 Auto-find full degree requirements (deep web research)', free: false, pro: false, supreme: true },
  { feature: '🧩 Auto-find course prerequisites (official catalog)', free: false, pro: false, supreme: true },
  { feature: '⚡ Priority AI lane — several AI requests at once', free: false, pro: false, supreme: true },
];

function App() {
  const [plan, setPlan] = useState<Settings['plan']>('free');
  const [admin, setAdmin] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    void getStored('settings').then((s) => {
      setPlan(s.plan);
      setAdmin(s.admin);
    });
    return onStoredChange('settings', (s) => {
      setPlan(s.plan);
      setAdmin(s.admin);
    });
  }, []);

  const [busy, setBusy] = useState<string | null>(null);
  const [activationCode, setActivationCode] = useState('');
  const [activationError, setActivationError] = useState<string | null>(null);
  const billing = billingEnabled();

  const setPlanValue = async (next: Settings['plan'], message: string) => {
    // Dropping the plan also drops the license token, so the daily re-check
    // doesn't immediately re-upgrade a deliberately downgraded device.
    const patch: Partial<Settings> = next === 'free' ? { plan: next, licenseToken: null } : { plan: next };
    await sendToBackground({ kind: 'SETTINGS_UPDATE', patch });
    setPlan(next);
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  /** Real billing: create a Stripe Checkout session and open it in a new tab. */
  const startCheckout = async (planKey: 'pro' | 'supreme') => {
    setBusy(planKey);
    setActivationError(null);
    try {
      const res = await fetch(`${BILLING_API_URL}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planKey, interval: 'month' }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? 'Could not start checkout.');
      window.open(data.url, '_blank');
      setToast('Checkout opened in a new tab. Afterwards, paste your activation code below.');
      setTimeout(() => setToast(null), 6000);
    } catch (err) {
      setActivationError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const activate = async () => {
    setBusy('activate');
    setActivationError(null);
    try {
      const license = await sendToBackground<LicenseStatus>({
        kind: 'LICENSE_ACTIVATE',
        code: activationCode,
      });
      setActivationCode('');
      setToast(`🎉 ${license.plan === 'supreme' ? 'Supreme' : 'Pro'} activated — thank you!`);
      setTimeout(() => setToast(null), 4000);
    } catch (err) {
      setActivationError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const pro = isPro({ plan, admin });
  const supreme = plan === 'supreme' || admin;

  return (
    <div class="sub-shell">
      <div class="sub-hero">
        <div class="sub-badge">Student Companion for Workday</div>
        <h1>Let AI plan your degree</h1>
        <p>
          The calendar, RateMyProfessors ratings, and degree tracking are free forever. Pro adds an
          AI advisor that turns your requirements, transcript, and prerequisites into a smart,
          conflict-free plan for every term — and reads your catalogs and transcript for you.
        </p>
        <div class="sub-current">
          <span class={`sub-dot ${supreme ? 'supreme' : pro ? 'pro' : 'free'}`} />
          You're on the <b>&nbsp;{supreme ? 'Supreme 👑' : pro ? 'Pro' : 'Free'}</b>&nbsp;plan
        </div>
      </div>

      <div class="sub-plans">
        {/* FREE */}
        <div class="sub-card free">
          <div class="sub-icon free">🎒</div>
          <h2>Free</h2>
          <div class="sub-tagline">Everything you need to plan a semester.</div>
          <div class="sub-price">
            <span class="amt">$0</span>
            <span class="per">forever</span>
          </div>
          <div class="sub-price-note">No account, no card.</div>
          <ul class="sub-features">
            <li><span class="sub-check">✓</span> Live schedule calendar + conflict detection</li>
            <li><span class="sub-check">✓</span> RateMyProfessors ratings, comments &amp; bulk panel</li>
            <li><span class="sub-check">✓</span> Multi-degree progress, overlap &amp; semester board</li>
            <li><span class="sub-check">✓</span> Transcript &amp; degree import via <b>rule-based</b> parsing</li>
            <li><span class="sub-x">✕</span> <span class="sub-muted">AI parsing &amp; the AI advisor (Pro only)</span></li>
          </ul>
          {pro ? (
            <button class="sub-btn danger" onClick={() => void setPlanValue('free', 'Switched to Free.')}>
              Downgrade to Free
            </button>
          ) : (
            <button class="sub-btn ghost" disabled>
              Your current plan
            </button>
          )}
        </div>

        {/* PRO */}
        <div class="sub-card pro">
          <div class="sub-icon pro">🚀</div>
          <h2>Pro</h2>
          <div class="sub-tagline">AI does the tedious parts for you.</div>
          <div class="sub-price">
            <span class="amt">{PRICE}</span>
            <span class="per">/ month</span>
          </div>
          <div class="sub-price-note">
            {billing ? (
              <>Cancel anytime. Or {YEARLY}/year — 2 months free.</>
            ) : (
              <><b>Free during the beta.</b> Planned launch price — or {YEARLY}/year (2 months free).</>
            )}
          </div>
          <ul class="sub-features">
            <li><span class="sub-check">✓</span> <b>AI Semester Advisor</b> — a prereq-safe, conflict-free plan for next term, with a reason for every course</li>
            <li><span class="sub-check">✓</span> <b>AI degree-catalog parsing</b> — paste a URL, get structured requirements</li>
            <li><span class="sub-check">✓</span> <b>AI transcript parsing</b> — accurate course/grade/term extraction</li>
            <li><span class="sub-check">✓</span> Polished animated interface — live thinking indicators &amp; effects</li>
            <li><span class="sub-check">✓</span> Everything in Free, plus no API key to manage</li>
            <li><span class="sub-x">✕</span> <span class="sub-muted">Auto-find degree requirements &amp; prerequisites (Supreme)</span></li>
          </ul>
          {supreme ? (
            <button
              class="sub-btn ghost"
              onClick={() => void setPlanValue('pro', 'Switched to Pro.')}
            >
              Switch down to Pro
            </button>
          ) : pro ? (
            <button class="sub-btn ghost" disabled>
              ✓ You're a Pro member
            </button>
          ) : (
            <button
              class="sub-btn primary"
              disabled={busy !== null}
              onClick={() =>
                billing
                  ? void startCheckout('pro')
                  : void setPlanValue('pro', '🎉 Pro unlocked — free during the beta.')
              }
            >
              {billing ? (busy === 'pro' ? 'Opening checkout…' : `Start Pro — ${PRICE}/mo`) : 'Try Pro free (beta)'}
            </button>
          )}
        </div>

        {/* SUPREME */}
        <div class="sub-card supreme">
          <span class="sub-spark s1">✦</span>
          <span class="sub-spark s2">✧</span>
          <span class="sub-spark s3">✦</span>
          <span class="sub-spark s4">✧</span>
          <div class="sub-icon supreme">
            <span class="sub-crown">👑</span>
            <span class="sub-orbit o1">✦</span>
            <span class="sub-orbit o2">✧</span>
          </div>
          <h2>Supreme</h2>
          <div class="sub-tagline">The AI researches your degree for you.</div>
          <div class="sub-price">
            <span class="amt">{SUPREME_PRICE}</span>
            <span class="per">/ month</span>
          </div>
          <div class="sub-price-note">
            {billing ? (
              <>Cancel anytime. Or {SUPREME_YEARLY}/year — 2 months free.</>
            ) : (
              <><b>Free during the beta.</b> Planned launch price — or {SUPREME_YEARLY}/year (2 months free).</>
            )}
          </div>
          <ul class="sub-features">
            <li><span class="sub-check">✓</span> <b>🎓 Auto-find full degree requirements</b> — deep web research across your school's catalog, bulletin &amp; gen-ed pages</li>
            <li><span class="sub-check">✓</span> <b>🧩 Auto-find course prerequisites</b> — verified from the official catalog</li>
            <li><span class="sub-check">✓</span> Live catalog page fetching for maximum accuracy</li>
            <li><span class="sub-check">✓</span> <b>⚡ Priority AI lane</b> — run several AI requests at once (Free &amp; Pro run one at a time)</li>
            <li><span class="sub-check">✓</span> Everything in Pro</li>
          </ul>
          {supreme ? (
            <button class="sub-btn ghost" disabled>
              👑 You're a Supreme member
            </button>
          ) : (
            <button
              class="sub-btn primary supreme"
              disabled={busy !== null}
              onClick={() =>
                billing
                  ? void startCheckout('supreme')
                  : void setPlanValue('supreme', '👑 Supreme unlocked — free during the beta.')
              }
            >
              {billing
                ? busy === 'supreme'
                  ? 'Opening checkout…'
                  : `Start Supreme — ${SUPREME_PRICE}/mo`
                : 'Try Supreme free (beta)'}
            </button>
          )}
        </div>
      </div>

      {/* Who gets what — the full access matrix */}
      <div class="sub-matrix-wrap">
        <h3>Every feature, by plan</h3>
        <div class="sub-matrix-scroll">
          <table class="sub-matrix">
            <thead>
              <tr>
                <th>Feature</th>
                <th><span class="sub-tier-chip tfree">🎒 Free</span></th>
                <th><span class="sub-tier-chip tpro">🚀 Pro</span></th>
                <th><span class="sub-tier-chip tsupreme">👑 Supreme</span></th>
              </tr>
            </thead>
            <tbody>
              {MATRIX.map((row) => (
                <tr>
                  <td>{row.feature}</td>
                  <td>{row.free ? <span class="sub-yes">✓</span> : <span class="sub-no">—</span>}</td>
                  <td>{row.pro ? <span class="sub-yes">✓</span> : <span class="sub-no">—</span>}</td>
                  <td class="sup-col">{row.supreme ? <span class="sub-yes supreme">✓</span> : <span class="sub-no">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {billing ? (
        <div class="sub-note">
          <b>Already paid?</b> Paste the activation code from the post-checkout page (it starts
          with <code>cs_</code>):
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <input
              type="text"
              style={{ flex: 1, padding: '8px 10px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '13px' }}
              placeholder="cs_…"
              value={activationCode}
              onInput={(e) => setActivationCode((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => e.key === 'Enter' && activationCode.trim() && void activate()}
            />
            <button class="sub-btn primary" style={{ width: 'auto' }} disabled={busy !== null || !activationCode.trim()} onClick={() => void activate()}>
              {busy === 'activate' ? 'Verifying…' : 'Activate'}
            </button>
          </div>
          {activationError && <div style={{ color: '#b91c1c', marginTop: '6px', fontSize: '13px' }}>{activationError}</div>}
          <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#6b7280' }}>
            Payments are processed securely by Stripe — the extension never sees your card. Your
            subscription is re-verified automatically; cancel anytime from your Stripe receipt email.
          </p>
        </div>
      ) : (
        <div class="sub-note">
          <b>Beta:</b> Pro and Supreme are <b>free while we're in beta</b> — no card, no charge, just
          click to activate. The prices shown are the planned launch pricing; when billing goes live
          you'll be asked before anything is ever charged. During the beta, AI features run with your
          own Claude API key (added in Options); at launch AI is included — no key needed.
        </div>
      )}

      <div class="sub-faq">
        <h3>Questions</h3>
        <details>
          <summary>What still works without paying?</summary>
          <p>
            Everything except AI parsing: the calendar, conflict detection, all RateMyProfessors
            features, the whole degree planner (progress, overlap, semester board, prerequisites,
            equivalents), and importing degrees/transcripts with the built-in rule-based parser you
            then tidy up. Pro only automates the parsing step.
          </p>
        </details>
        <details>
          <summary>Do I need a Claude API key?</summary>
          {billing ? (
            <p>
              <b>No.</b> AI is included with Pro and Supreme and runs through our servers — nothing
              to sign up for or configure. Each plan includes a generous monthly AI allowance
              (roughly a hundred advisor chats on Pro, or dozens of deep degree researches on
              Supreme); it resets monthly.
            </p>
          ) : (
            <p>
              During the beta, yes — Pro/Supreme AI features run with your own Claude API key (get
              one at console.anthropic.com and add it in Options; use a key with a spend limit).
              At the paid launch AI is included with the subscription — no key at all.
            </p>
          )}
        </details>
        <details>
          <summary>Is my data private?</summary>
          <p>
            Your Workday data stays on your device. Only the text you choose to import (a catalog
            page or transcript) is sent for parsing, and only when you trigger it.
          </p>
        </details>
      </div>

      {toast && <div class="sub-toast">{toast}</div>}
    </div>
  );
}

render(<App />, document.getElementById('app')!);
