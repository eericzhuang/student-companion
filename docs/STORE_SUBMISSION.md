# Chrome Web Store Submission Guide — Student Companion for Workday

_Prepared July 15, 2026. Everything in “Already done” ships in
`release/student-companion-for-workday-v0.1.0.zip`; the numbered steps are what
**you** need to do, in order. Expect ~1–2 hours of work plus a few days of
Google review time._

---

## Already done (in this repo)

| Item | Where |
|---|---|
| Trademark-safe name “Student Companion for Workday” (nominative “for X” pattern) | manifest, all page titles/headers |
| Unused `scripting` permission removed (common rejection reason) | `src/manifest.ts` |
| `minimum_chrome_version: 111` (MAIN-world content script needs it) | `src/manifest.ts` |
| Real icons 16/48/128 (calendar + grad-cap mark) | `public/icons/`, `dist/icons/` |
| 5 screenshots at exactly 1280×800 | `store-assets/screenshot-*.png` |
| Promo tile 440×280 + marquee 1400×560 | `store-assets/` |
| Privacy policy draft (incl. network-interception, catalog-URL permission, transcript-PII warning, retention) | `docs/PRIVACY_POLICY.md` |
| Terms of Service + refund policy draft | `docs/TERMS_OF_SERVICE.md` |
| API-key leak closed (`DEBUG_DUMP` removed), plan changes restricted to extension pages | `src/background/` |
| Fallback professor-name scan now requires user confirmation before RMP lookups | `src/content/ui/RmpAllPanel.tsx` |
| First-run: Options page opens automatically after install | `src/background/index.ts` |
| In-app support email + non-affiliation disclaimer | Options page footer |
| CHANGELOG | `CHANGELOG.md` |
| Store-ready zip (secret-scanned, manifest at root) | `release/student-companion-for-workday-v0.1.0.zip` |

---

## Step 1 — Host the privacy policy at a public URL (required)

The dashboard needs a **URL**, not a file. Fastest path (GitHub Pages):

1. Create a public GitHub repo (e.g. `student-companion-legal`).
2. Add `docs/PRIVACY_POLICY.md` (and optionally `TERMS_OF_SERVICE.md`) as
   `index.md` / `terms.md`.
3. Repo Settings → Pages → deploy from branch → `main`.
4. Your policy URL becomes
   `https://<your-username>.github.io/student-companion-legal/`.

Any stable public URL works (Notion public page, personal site, etc.).

## Step 2 — Developer account (one-time, ~15 min)

1. Go to <https://chrome.google.com/webstore/devconsole> with your Google
   account.
2. Pay the **one-time $5 registration fee** (card required).
3. Enable **2-Step Verification** on the Google account — publishing is
   blocked without it.
4. In Account tab: set contact email (**eric2007118@gmail.com**) and click the
   verification link Google emails you — publishing is blocked until verified.
5. Complete the **EU DSA trader declaration**. Free-beta today → “non-trader”
   is defensible; once paid subscriptions go live you must declare **trader**
   (your contact details become visible on EU listings).

## Step 3 — Upload the zip

1. Developer Dashboard → **New item** → upload
   `release/student-companion-for-workday-v0.1.0.zip`.
2. The manifest description auto-fills the summary (96 chars, fits the
   132 limit).

## Step 4 — Store listing tab

- **Category:** Education. **Language:** English.
- **Icon:** upload `store-assets/store-icon-128.png`.
- **Screenshots:** upload the five `store-assets/screenshot-*.png` (lead with
  `screenshot-1-calendar.png`).
- **Promo tile:** `store-assets/promo-tile-440x280.png` (+ optional
  `marquee-1400x560.png`).
- **Detailed description** — suggested skeleton:

  > See your schedule as a real calendar while you register, professor ratings
  > next to every course, and a multi-degree planner that knows what you've
  > completed — right inside your university's Workday Student portal.
  >
  > 🗓 LIVE CALENDAR — floating week view on Find Course Sections with
  > conflict highlighting and free-time view.
  > ⭐ PROFESSOR RATINGS — RateMyProfessors ratings and comments inline.
  > 🎓 DEGREE PLANNER — import your degree requirements, track multiple
  > degrees, see overlap, and lay out future semesters (prereq-aware).
  > ✨ AI ADVISOR (Pro) / deep research (Supreme) — uses your own Claude API
  > key during the beta.
  >
  > Your data stays on your device — no account, no developer server, no
  > analytics. Privacy policy: <your URL>.
  >
  > Independent project — not affiliated with, endorsed by, or sponsored by
  > Workday, Inc. or RateMyProfessors. Requires your school to use Workday
  > Student.

## Step 5 — Privacy practices tab (the part reviewers actually read)

**Single purpose:** “A companion for Workday Student: shows the student's own
schedule, professor ratings, and degree progress while they register for
courses.”

**Permission justifications — paste these:**

- `storage` — “Stores the user's schedule cache, professor-rating cache,
  degree plans, settings, and the user's own Claude API key locally on the
  device; nothing is sent to any server we operate.”
- `alarms` — “Schedules periodic housekeeping: expiring the 7-day
  RateMyProfessors cache and re-checking the subscription license daily.”
- `https://*.myworkday.com/*` — “Runs on the university's Workday Student
  portal to read the schedule/course data the logged-in student already sees
  and render the companion calendar and planner UI. Each school has its own
  subdomain (tenant), hence the wildcard.”
- `https://www.ratemyprofessors.com/*` — “Fetches public professor ratings for
  instructor names shown on the student's course pages, so ratings appear
  inline.”
- `https://api.anthropic.com/*` — “Sends AI planning requests directly to
  Anthropic's API using the user's own API key, entered by the user in
  Options. No intermediary server; only on explicit user action.”
- `optional_host_permissions https://*/*` — “Requested at runtime for ONE
  specific origin at a time, only when the user pastes the URL of their
  university's degree-requirements page, to fetch that single page without
  cookies for import. A paste-the-text fallback exists; the broad pattern is
  needed because every university hosts its catalog on a different domain.”

**Reviewer notes (add in the ‘additional details’ / review notes box):**

> The extension includes a MAIN-world content script on *.myworkday.com that
> read-only observes the JSON responses Workday's own UI fetches (schedule /
> academic history), so we don't need to re-scrape or re-request anything.
> Requests are never modified, blocked, or replayed; captured data is stored
> only in chrome.storage.local. Disclosed in the privacy policy. Example
> tenant: https://wd5.myworkday.com/<school>/d/home.htmld — any university
> using Workday Student works.

**Data-use disclosures — check exactly these:**

- ✅ Personally identifiable information (instructor names go to
  RateMyProfessors; transcript text sent to Anthropic can contain the
  student's name)
- ✅ Authentication information (the user's own Anthropic API key, stored
  locally, sent only to Anthropic as its auth)
- ✅ Website content (Workday schedule/history text and catalog pages, sent to
  Anthropic only when the user invokes AI)
- ❌ Everything else (health, financial, location, web history, activity,
  communications) — leave unchecked. Note: card data is Stripe-hosted; the
  extension never sees it.

**Certifications:** data is not sold; not used/transferred for purposes
unrelated to the single purpose; not used for creditworthiness/lending — all
three are true, certify them.

**Privacy policy URL:** from Step 1.

## Step 6 — Distribution & submit

1. Visibility: **Public** (or **Unlisted** first if you want a soft launch —
   you can flip to Public later without re-review).
2. Pricing: the listing itself is free (payments happen via Stripe inside the
   extension when you enable billing — that's allowed since it's your own
   payment system, but the DSA trader declaration then applies).
3. Click **Submit for review**.

**Review expectations:** typically 1–3 days; the broad
`optional_host_permissions` + network interception may route it to deeper
review (up to ~2 weeks). If rejected, the email states the policy — the usual
fixes here would be: drop `optional_host_permissions` entirely (paste-text
import still works) and resubmit.

## Step 7 — After approval

- Install from the store on a fresh Chrome profile; run through
  onboarding (Options opens automatically → pick school → capture a page).
- Keep `store-assets/` and bump `version` in `src/manifest.ts` for every
  future upload (each upload needs a strictly higher version; updates
  re-review in hours-to-days and auto-roll-out to users — you can ship fixes
  as often as you like).

---

## Before you charge money (not needed for the free-beta listing)

The managed AI relay is BUILT: at launch, subscribers' AI runs through your
server on YOUR Anthropic key (no user API keys), with per-subscription monthly
budgets, tier checks, and rate limits enforced server-side. Launch steps:

1. **Deploy `server/`** (Render/Railway/Fly — see `server/README.md`) with env
   vars: live `STRIPE_SECRET_KEY`, your `ANTHROPIC_API_KEY` (the relay key),
   `ADMIN_TOKENS` (your own permanent Supreme tokens), `BASE_URL`.
2. Run `setup-products.js` once in live mode — creates/reprices Pro
   ($6.99/mo, $69/yr) and Supreme ($14.99/mo, $149/yr).
3. On console.anthropic.com, set a **monthly spend limit + alert** on the
   relay key — the backstop behind the per-user budgets.
4. Set `BILLING_API_URL` in `src/shared/billing.ts` to the deployed URL,
   rebuild, bump version, re-upload. This simultaneously enables checkout AND
   switches all AI to the relay (the API-key UI disappears).
5. Roll the test-mode Stripe keys (they appeared in chats/logs) in the Stripe
   dashboard.
6. Update the EU DSA declaration to **trader**; enable the Stripe Customer
   Portal for cancellations.
7. Publish the Terms of Service next to the privacy policy and link both from
   the listing and the subscribe page (both already cover the relay + fair-use
   budget).
8. Note the paid-mode privacy disclosure change: AI text now transits your
   relay (not stored/logged; only monthly usage totals kept in Stripe
   metadata) — `docs/PRIVACY_POLICY.md` already states this; make sure the
   hosted copy is the current version.
9. RateMyProfessors data comes from their unofficial GraphQL API. For a paid
   product this is a ToS/blocking risk — keep the feature degradable (it
   already fails soft to “ratings unavailable”) and keep paid pricing about
   AI, so an RMP block never takes away something people paid for.
