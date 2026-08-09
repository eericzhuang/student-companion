/* Records a new-user walkthrough of the demo as two webm clips, then the
 * caller concatenates them to one mp4. Run from the project root. */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://[::1]:5199';
const OUT = process.argv[2] ?? '/tmp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  defaultViewport: { width: 1280, height: 800 },
  args: ['--window-size=1280,800', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

async function caption(text, pos = 'bottom') {
  await page.evaluate((t, pos) => {
    let el = document.getElementById('vg-cap');
    if (!el) {
      el = document.createElement('div');
      el.id = 'vg-cap';
      Object.assign(el.style, {
        position: 'fixed', left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(15,23,42,.93)', color: '#fff', padding: '13px 24px',
        borderRadius: '999px', font: '600 18px system-ui', zIndex: 2147483647,
        boxShadow: '0 6px 24px rgba(0,0,0,.35)', maxWidth: '82%', textAlign: 'center',
        whiteSpace: 'nowrap',
      });
      document.body.appendChild(el);
    }
    if (pos === 'top') {
      el.style.top = '18px';
      el.style.bottom = '';
    } else {
      el.style.bottom = '26px';
      el.style.top = '';
    }
    el.textContent = t;
  }, text, pos);
}
const capTop = (t) => caption(t, 'top');

async function clickText(sel, text) {
  const ok = await page.evaluate(
    (sel, text) => {
      const el = [...document.querySelectorAll(sel)].find((e) => e.textContent && e.textContent.trim().includes(text));
      if (el) el.click();
      return !!el;
    },
    sel,
    text,
  );
  if (!ok) console.log(`  (click target not found: ${text})`);
  return ok;
}

/* ---------- Scene 1: on Workday (calendar overlay) ---------- */
await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.wdc-panel');
const rec1 = await page.screencast({ path: `${OUT}/clip1.webm` });

await caption('Student Companion lives right on your Workday pages');
await sleep(3000);
await caption('Your schedule is captured automatically into a floating calendar');
await sleep(3000);

// event popup: professor rating + Canvas link
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.wdc-panel .wdc-block-click')].find((x) => x.textContent?.includes('CS 2110'));
  b?.click();
});
await caption('Click any class — professor rating, room, and its Canvas page');
await sleep(3800);
await page.evaluate(() => document.querySelector('.wdc-event-pop-head button')?.click());

await clickText('.wdc-panel button', 'Free time');
await caption('Free time — the open slots in your week');
await sleep(3000);

await clickText('.wdc-panel button', 'Route');
await caption("Route — walk times between buildings, flagged when it's tight");
await sleep(3600);

await clickText('.wdc-panel button', 'Plans');
await caption('Plans — saved schedules compared: credits, ratings, earliest class, walking');
await sleep(3800);

await clickText('.wdc-panel button', 'Edit');
await caption('Edit — fix anything by hand, and track final exams');
await sleep(3400);

await clickText('.wdc-panel button', 'Calendar');
await page.evaluate(() => chrome.runtime.sendMessage({ kind: 'SETTINGS_UPDATE', patch: { showCourseTitles: true } }));
await caption('Prefer full course names? One switch in ⚙ Options');
await sleep(3600);

await rec1.stop();

/* ---------- Scene 2: the degree planner ---------- */
await page.goto(`${BASE}/progress.html`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.pl-guide');
const rec2 = await page.screencast({ path: `${OUT}/clip2.webm` });

await capTop('The planner welcomes new users with a tour — quick or full');
await sleep(2800);
await clickText('.pl-guide button', 'Quick tour');
await sleep(2800);
for (let s = 0; s < 3; s++) {
  await clickText('.pl-guide button', 'Next');
  await sleep(2800);
}
await clickText('.pl-guide button', 'Done');

// the quick tour ends on the What-if tab — return to Progress for the GPA card
await clickText('button', 'Progress');
await capTop('Progress — live requirement bars; every course chip is clickable');
await sleep(3200);

await clickText('button, .pl-link-inline', 'what-if grades');
await page.evaluate(() => {
  const sel = document.querySelector('.pl-gpa-whatif select');
  if (sel) {
    sel.value = 'A';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
});
await capTop('GPA what-if — pick hypothetical grades, watch the projection move');
await sleep(3800);

await clickText('.pl-tabs button, button', 'What-if');
await capTop('What-if — test any course against all your degrees before registering');
await sleep(3400);

await clickText('button', 'Semester board');
await capTop('Semester board — drag courses into future terms; suggestions fill the rest');
await sleep(3600);

await clickText('button', 'Overlap');
await capTop('Overlap — courses that count toward several degrees at once');
await sleep(3200);

await clickText('button', 'Prerequisites');
await capTop('Prerequisites — the chains behind your remaining courses, editable');
await sleep(3200);

// demo seeds the free tier; unlock Pro so the advisor demo shows the real chat
await page.evaluate(() => chrome.runtime.sendMessage({ kind: 'SETTINGS_UPDATE', patch: { plan: 'pro' } }));
await sleep(500);
await clickText('button', 'AI Advisor');
await sleep(900);
await clickText('button', 'Plan my next semester');
await capTop('AI Advisor (Pro) — plans your semester in chat; save it to the board');
await sleep(4200);

await capTop('Student Companion for Workday 🎉');
await sleep(2600);

await rec2.stop();
await browser.close();
console.log('recorded');
