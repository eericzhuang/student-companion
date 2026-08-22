# Changelog — Student Companion for Workday

All notable user-facing changes to the extension.

## Unreleased

- **No more console warnings**: the build no longer emits `modulepreload`
  hints, which Chrome logged for every planner asset as a "cross-world
  extension resource mismatch" (harmless, but it filled the extension's Errors
  panel). Preloading gains nothing for files already on disk.

- **More accurate academic history**: grades and credits are now read from the
  grid's own columns instead of "the first cell that looks like one", so a
  Grading Basis of "S" is no longer mistaken for a grade and a Grade Points
  value is no longer imported as credits. Withdrawn (W), audit (AU) and
  in-progress (IP) courses no longer count as completed, transfer credit (TR)
  does, a section suffix ("CSE 1302-01") is no longer read as 1 credit, and a
  Roman numeral in a title ("Physics I") is no longer read as an Incomplete.
- **Clearer Future terms editor**: labelled columns, terms are editable and
  re-orderable after adding, one click adds the next term (or fills in the next
  4 years), and the optional dates/registration fields are tucked behind a
  toggle.
- **Walking speed is no longer a setting**: walk estimates always use a normal
  pace (4.8 km/h with a 1.3x detour factor).

- **Subscription management**: the Upgrade page now shows a "Your subscription"
  card with how many days remain before the next charge, and cancels (or
  resumes) in one click. Cancelling keeps every paid feature until the period
  you already paid for runs out, and can be undone until then.
- **Yearly plans are purchasable**: the Upgrade page gained a Monthly/Yearly
  toggle. Yearly was advertised ($69 Pro, $149 Supreme — 2 months free) but
  checkout always requested a monthly subscription, so there was no way to buy
  it. Prices, per-month equivalents, and the checkout call now follow the
  toggle.
- **No accidental paid-but-locked-out state**: with billing on, "Downgrade to
  Free" and "Switch down to Pro" used to change the plan only on this device
  while Stripe kept charging. They now route to the cancel flow instead; owner
  unlock and free-beta installs keep the old local switching.
- **Real billing is live**: Stripe Checkout is wired to the deployed billing
  server, so Pro and Supreme are purchasable.

- **Cleaner course names**: trailing "Actions" column text from Workday rows
  is stripped from captured titles.
- **Visual guide video**: `store-assets/visual-guide.mp4` — a 70-second
  captioned walkthrough of every feature, recorded from the live demo
  (regenerate with `node demo/record-visual-guide.mjs <outdir>` while the
  demo server runs).
- **Canvas course links**: enter your school's Canvas address in Options and
  every calendar event's popup gains an "Open in Canvas" link straight to that
  course's Canvas page (matched against your own Canvas course list, read via
  your existing Canvas login; falls back to your Canvas course list when no
  exact match is found).
- **Full course names (optional)**: turn on "Show full course names" in
  Options to see "CS 2110 · Object-Oriented Programming" style labels across
  the calendar, capture widget, and planner. Off by default so the compact
  views stay compact — hover tooltips and the 📷 image export always include
  the full name, and title cleanup handles Workday's concatenated
  section/time/credit junk much better.
- **Two-speed beginner guide**: the tour now opens with a choice — a ⚡ 30-second
  Quick tour (4 cards) or the Full tour (13 cards) — both covering the newest
  features (Canvas links, full course names).

## 0.1.0 — 2026-07-15 (first public release)

### Free

- **Beginner guide**: a one-minute tour of every module that walks through the
  real tabs — auto-plays on first visit, replayable anytime from ❓ Guide.
- **Live schedule calendar** on Find Course Sections and saved-schedule pages:
  draggable/resizable week grid, conflict highlighting, free-time list view,
  manual add/remove/rename of sections. Rooms show on event blocks; click any
  class for its professor, live RMP rating, and location.
- **Route view + "you might miss class" warnings**: building coordinates are
  looked up for free (OpenStreetMap — no AI involved), the day shows as an
  itinerary with per-leg distance, walk time, and verdict, plus the real
  walking path drawn from OpenStreetMap routing and a Google Maps directions
  link. Breaks shorter than the walk get a 🚨 warning on the calendar
  (walking speed adjustable; coordinates editable in Options).
- **📷 Save calendar as image**: one click downloads the week as a crisp PNG
  with rooms, professors, color-coded ratings, and walk warnings included.
- **📆 Export to your calendar app**: download the schedule as an `.ics` file
  (weekly recurring events with rooms and professors) and import it into
  Google, Apple, or Outlook calendars. Term start/end dates are asked once
  and remembered (editable in Options → Future terms).
- Ratings are color-coded everywhere (green ≥3.8, amber ≥2.8, red below),
  and the calendar's Edit view can fix a section's professor and location.
- **🗂 Plans (schedule scenarios)**: every saved schedule you open in Workday
  is captured automatically as its own plan — build "Schedule 1" and
  "Schedule 2" in Workday, view each once, then compare them side by side
  (credits, average professor rating, earliest class, weekly walking, risky
  legs) and load one back with a click. Manual "save current as…" works too,
  and unsaved work is auto-stashed before a load, so nothing is ever lost.
- **💾 Data backup** in Options: export everything (degrees, history,
  schedule, plans, settings) as one JSON file and restore it later — the file
  never leaves your computer.
- **🎓 Finals week**: enter exam sittings (date, time, room) in Edit — same-day
  overlaps are flagged, a chronological finals strip shows under the calendar,
  and finals export to your calendar app with everything else.
- **👥 Compare with a friend**: exchange tiny schedule files (course codes and
  times only — nothing else, and never uploaded) and see both weeks on one
  grid — your classes on the left half of each day, theirs on the right, with
  green bands wherever you're both free.
- **🕸 Prerequisite chain graph**: the Prereqs tab draws your courses as an
  unlock graph, colored by status — bottleneck courses stand out at a glance.
- **⏰ Registration reminders**: set when your window opens (per term, in
  Options) and get notified 24 hours and 10 minutes before.
- **🌙 Dark mode**: match your system or force light/dark — panels on Workday,
  the planner, and Options all follow.
- **💬 Feedback** section in Options — report problems or send suggestions by
  pre-filled email or GitHub issue.
- **RateMyProfessors ratings** inline next to instructor names, plus a
  "professors on this page" panel with comments, links to RMP profiles,
  manual name lookup, and a wrong-person correction flow.
- **Degree planner**: import degree requirements (rule-based parsing), track
  progress across multiple degrees, course equivalents (transfer/AP),
  prerequisite editing, semester board with credit caps and overlap-first
  recommendations.
- **Academic history** from Workday capture or transcript upload (PDF/text),
  fully editable.
- **🎓 GPA card** on the Progress tab: cumulative GPA computed from your
  history (standard 4.0 scale), plus **what-if grades** — pick hypothetical
  grades for current/planned courses and watch the projected term and
  cumulative GPA update live.
- **🔮 What-if course tryout**: test courses you're considering against every
  degree's requirements — see before→after progress, per-course impact, and
  commit winners to the semester plan with one click (pick the target term when
  you have several configured).
- **🏅 Level-up game**: completed courses, satisfied requirements, and finished
  degrees earn XP toward 10 academic ranks (Novice → Academic Legend). Each
  rank restyles your level card — higher ranks add gold shimmer, glowing
  medallions, sparkles, and a holographic finish — with a confetti celebration
  every time you level up. Only completed work counts, so the game can't be
  cheated by stacking planned courses. Click the XP bar for your **full
  journey**: all 10 ranks, each shown in its own live theme, the XP rules
  spelled out, and a "try it" preview that dresses your card in any rank's
  look (a costume — your real XP never changes). From level 2 up, your rank's
  color themes the **whole extension** — planner tabs and buttons, the
  calendar panel, capture widget, and professor panel on Workday all wear it.

### Pro

- **AI Semester Advisor** — chat with an AI that knows your degrees, history,
  and schedule; uses live web search. When it suggests a plan, save the
  courses you like straight to the Semester board (you pick which, and the
  term).
- **AI transcript parsing** and **AI degree-catalog parsing** (more accurate
  than the rule-based fallback).
- AI history log, animated Pro UI.

### Supreme

- **Auto-find degree requirements** and **course prerequisites** via deep web
  research.
- **Priority AI lane** — run up to 3 AI requests at once (Free/Pro run one at
  a time).

_During the beta, Pro and Supreme are free to try, with AI switched on for
users in waves — nothing to configure. At the paid launch, AI is included
with the subscription (runs through our service — no API key), with a
generous monthly allowance per plan._
