# Changelog — Student Companion for Workday

All notable user-facing changes to the extension.

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
- **🧩 Schedule builder**: mark sections you're considering with ☆ on Find
  Course Sections (several per course), then let the Build tab generate every
  conflict-free combination and rank them by your preferences — avoid early
  mornings, compact days, professor ratings, less walking. Preview any result
  on the calendar, save it as a plan, or make it your schedule. All local
  math, no AI.
- **🗂 Plans (schedule scenarios)**: save the current schedule as "Plan A",
  "Plan B", …, compare plans side by side (credits, average professor rating,
  earliest class, weekly walking, risky legs) and load one back with a click —
  unsaved work is auto-stashed first, so nothing is ever lost.
- **💾 Data backup** in Options: export everything (degrees, history,
  schedule, plans, settings) as one JSON file and restore it later — the file
  never leaves your computer.
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

_During the beta, Pro and Supreme are free to try; AI features use your own
Claude API key. At the paid launch, AI is included with the subscription
(runs through our service — no API key), with a generous monthly allowance
per plan._
