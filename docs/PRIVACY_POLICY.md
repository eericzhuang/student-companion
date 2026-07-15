# Privacy Policy — Student Companion for Workday

_Last updated: July 15, 2026_

Student Companion for Workday (“the extension”) helps students see their
schedule, professor ratings, and degree progress while using their university's
Workday Student portal. This policy explains exactly what data the extension
handles. The extension is an independent project — it is not affiliated with,
endorsed by, or sponsored by Workday, Inc. or RateMyProfessors.

## The short version

- Your data stays **on your device** in your browser's extension storage.
- The extension has **no developer server that receives your data**. We cannot
  see your courses, grades, schedule, or anything else.
- Data leaves your device only when **you** use a feature that needs an outside
  service, and only the minimum required is sent (details below).
- Nothing is ever sold, shared for advertising, or used for any purpose other
  than the feature you invoked.

## What the extension stores locally

Stored in `chrome.storage.local` on your computer only:

- Your captured class schedule and academic history (courses, grades, terms) —
  read from Workday pages you visit while logged in, or from a transcript you
  upload.
- Degree requirements you import and your planner state (term assignments,
  manual adjustments, prerequisites, equivalents).
- Cached RateMyProfessors ratings and your school selection.
- Your settings, subscription tier, and subscription activation code. During
  the beta only, AI features use an Anthropic API key you provide — **that key
  is stored unencrypted on your device**; we recommend a key with a spending
  limit. On paid plans no API key exists at all.
- A log of your AI results (viewable and deletable in the AI History tab).

You can delete everything by removing the extension, or clear individual items
from the extension's own UI.

## When data leaves your device

1. **RateMyProfessors lookups** (`ratemyprofessors.com`): when professor
   ratings are enabled, instructor **names** visible on your Workday page (or
   names you type into the ratings panel) and your selected school are sent to
   RateMyProfessors' public API to fetch ratings. No other personal data is
   included. If the extension can't find an explicit instructor column and has
   to guess names from page text, it asks you to confirm the list before
   anything is sent.
2. **AI features**: when you use an AI feature (transcript parsing, degree
   parsing, the semester advisor, or auto-find research), the text needed for
   that request — e.g. your transcript text, a catalog page, your degree
   progress summary, your school name — is sent for processing by Anthropic's
   Claude AI, under Anthropic's privacy terms. AI features never run in the
   background; only when you click them. **Note:** uploaded transcripts often
   carry your name/student ID in the header — the upload screen reminds you
   that you can delete that line before parsing. How the request travels
   depends on your setup:
   - **Paid plans (AI included):** the request goes to **our AI relay**, which
     checks your subscription and forwards it to Anthropic
     (`api.anthropic.com`). The relay does **not store or log the content** of
     your requests or the AI's replies; the only thing it records is a running
     monthly total of your AI usage (token counts converted to cost), kept
     with your subscription record so we can enforce the plan's included
     allowance.
   - **Beta (bring-your-own-key):** the request goes directly from your
     browser to `api.anthropic.com` using your own API key; no server of ours
     is involved.
3. **Subscription verification** (billing server, when paid plans are live): an
   opaque activation code is exchanged with our billing endpoint to confirm an
   active subscription. Payments are processed entirely by **Stripe**; the
   extension and our server never see your card number.
4. **Degree page import** (a site you choose): if you paste the URL of your
   university's degree-requirements page, the extension asks Chrome for
   permission for **that one site**, fetches that single page without your
   cookies, and extracts its text locally (then sends it to Anthropic only if
   you use AI parsing, per item 2). No other browsing data is touched.

## What the extension reads on Workday

Content scripts run only on `*.myworkday.com` pages and read the schedule and
academic-history information **your own logged-in browser already displays**,
to show it back to you in a nicer form. It does this two ways: by reading the
page itself, and by **observing the schedule/course data responses Workday's
own interface downloads** while you browse (read-only — requests are never
modified, blocked, or replayed, and the captured data is stored only on your
device). The extension never logs in for you, never submits forms on Workday,
and never transmits Workday page content anywhere except as described in “AI
features” above (only when you invoke them).

## How long data is kept

- RateMyProfessors rating cache: expires automatically after **7 days**.
- AI history log: capped at the **50 most recent** results; delete any or all
  in the AI History tab.
- Everything else (schedule, academic history, degrees, planner state,
  settings): kept on your device until you change it, clear it in the
  extension's UI, or uninstall the extension — uninstalling deletes all of it.

## What we don't do

- No analytics, tracking pixels, or telemetry.
- No sale or transfer of data to third parties.
- No advertising use, no creditworthiness/lending use.
- No collection of data from users who haven't installed the extension.

## Changes & contact

If this policy changes, the “Last updated” date changes and material changes
will be noted in the extension's release notes.

Questions or requests: **eric2007118@gmail.com**
