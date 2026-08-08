# Privacy Policy — Student Companion for Workday

_Last updated: July 28, 2026_

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
- Saved schedule plans, final-exam entries, campus building coordinates, and
  any friend-compare schedule file you import (friend files contain course
  codes and times only, and are never uploaded anywhere).
- Your settings, subscription tier, and subscription activation code. Regular
  users never enter or hold an API key. (Developer builds with owner mode
  unlocked can configure an Anthropic API key for testing — stored unencrypted
  on that device only.)
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
   - **Beta:** AI is being switched on for users in waves through the same
     relay; there is nothing to configure and no API key to hold. (Developer
     builds with owner mode unlocked can instead send requests directly from
     the browser to `api.anthropic.com` with a locally configured key.)
3. **Subscription verification** (billing server, when paid plans are live): an
   opaque activation code is exchanged with our billing endpoint to confirm an
   active subscription. Payments are processed entirely by **Stripe**; the
   extension and our server never see your card number.
4. **Degree page import** (a site you choose): if you paste the URL of your
   university's degree-requirements page, the extension asks Chrome for
   permission for **that one site**, fetches that single page without your
   cookies, and extracts its text locally (then sends it to Anthropic only if
   you use AI parsing, per item 2). No other browsing data is touched.
5. **Campus map lookups**: when you click “Locate buildings” in the
   calendar's Route view, the **names of your class buildings** and your
   school name are sent to a geocoding service to find their coordinates —
   Google's Geocoding API (`maps.googleapis.com`) when a Google Maps key is
   configured (developer/owner builds), otherwise OpenStreetMap's
   `nominatim.openstreetmap.org` — and the resulting coordinates are sent to
   `routing.openstreetmap.de` to draw the walking path between classes. Only
   building names and coordinates are sent — never your identity, courses, or
   schedule details — and only when you use the feature. Per OpenStreetMap's
   usage policy those requests identify the extension (not you) via the
   developer's contact email.
6. **Canvas course links** (your school's Canvas site, optional): if you enter
   your school's Canvas address in Options, the extension asks Chrome for
   permission for **that one site** and then reads **your own course list**
   from Canvas's API (course id, code, and name only), using the Canvas login
   session already in your browser, so calendar events can link straight to
   their Canvas course pages. The request is read-only — nothing is posted,
   changed, or sent to anyone else — and the cached list stays on your device.
   Leave the setting empty and no Canvas request is ever made.

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
