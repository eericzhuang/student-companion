# Workday Student Companion

A Chrome extension (Manifest V3) that adds three things to your university's Workday
Student portal while you plan next semester:

1. **Live schedule calendar** — a floating, draggable weekly calendar of your saved
   schedule that stays visible while you use *Find Course Sections*, and flags search
   results that conflict with courses you've already saved.
2. **RateMyProfessors inline** — rating / difficulty / would-take-again badges next to
   each instructor, with a click-through popover of top comments and a "not this
   professor?" correction.
3. **Multi-degree planner** — import each degree's requirements by pasting its catalog
   URL (parsed with your own Claude API key), then see per-degree progress, courses
   that overlap across degrees, and a suggested semester-by-semester layout that
   respects prerequisites and credit caps.

Works on any `*.myworkday.com` tenant. Everything is stored locally in
`chrome.storage.local`; the only outbound calls are to RateMyProfessors (ratings) and
the Anthropic API (degree parsing, with your key).

## How it gets your data

There is no student-facing Workday API, so the extension reads only what your logged-in
browser already shows:

- A **MAIN-world script** mirrors the JSON that Workday's own UI fetches (primary source
  for your saved schedule and academic history).
- **Content-script DOM scrapers** are the fallback and the source for search-result rows.

Both are read-only. Selectors live behind a configurable abstraction
(`src/content/scrapers/selectors.default.json`) so per-school quirks are fixable from the
options page without a rebuild.

## Build & load

```bash
npm install
npm run build        # tsc typecheck + vite build → dist/
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
select the `dist/` folder. For live development use `npm run dev` and load `dist/` (CRXJS
provides HMR).

```bash
npm test             # unit tests (time parsing, fuzzy match, planner engine, scrapers)
node scripts/gen-icons.mjs   # regenerate icons
```

## First-time setup (options page)

Right-click the extension icon → **Options**, or open the planner and click ⚙:

1. **School** — search your school so RMP lookups hit the right campus.
2. **Claude API key** — from console.anthropic.com; used only for degree parsing. Stored
   unencrypted on-device, so use a key with a spend limit.
3. **Future terms** — add e.g. "Fall 2026" with a credit cap to drive the planner board.

## Manual end-to-end verification

1. **Capture** — log into Workday, open *Academic History* once and your *saved schedule*
   once; the planner header should show non-zero course/section counts.
2. **Calendar** — on *Find Course Sections* the floating panel shows your schedule; drag
   it, collapse it, reload (position persists). Add a course to your saved schedule → the
   calendar updates. Hover a result that overlaps an existing course → red conflict badge
   + dashed ghost block.
3. **RMP** — result rows show rating badges; click one for comments; use "not this
   professor?" to correct a wrong match (persists across reloads).
4. **Planner** — import two degree URLs, edit a parsed "choose N" rule, save. Check the
   Progress, Overlap, and Semester-board tabs.

If a page isn't detected on your tenant, add selector overrides under
**Options → Advanced**.

## Layout

```
src/
  shared/      types, storage wrappers, time/meeting parsing, fuzzy matching
  background/  message router (single storage writer), RMP client + lookup, Claude client
  page/        MAIN-world fetch/XHR interceptor
  content/     bridge, page detection, scrapers, and the injected calendar/RMP UI
  options/     settings page
  planner/     degree import → review editor → progress / overlap / semester board
test/          vitest suites (run with `npm test`)
```
