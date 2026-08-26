import puppeteer from 'puppeteer-core';
import path from 'node:path'; import os from 'node:os'; import fs from 'node:fs';

const CFT = path.resolve('chrome/mac_arm-152.0.7977.64/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const dist = path.resolve('dist');
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'wsc-e2e-'));
const ADMIN = process.argv[2];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const errs = [];
const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`);

const b = await puppeteer.launch({
  executablePath: CFT, headless: 'new', userDataDir: udd,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, '--no-first-run',
         '--host-resolver-rules=MAP *.myworkday.com 127.0.0.1:8443',
         '--ignore-certificate-errors', '--no-proxy-server'],
});
await wait(3000);
const swT = b.targets().find((t) => t.type() === 'service_worker');
ok('service worker starts', !!swT);
const sw = await swT.worker();
const extId = swT.url().split('/')[2];
const read = (k) => sw.evaluate(async (kk) => (await chrome.storage.local.get(kk))[kk], k);

const meta = await sw.evaluate(async () => ({
  v: chrome.runtime.getManifest().version,
  alarms: (await chrome.alarms.getAll()).map((a) => a.name).sort(),
}));
ok('manifest version 0.1.0', meta.v === '0.1.0', meta.v);
ok('background alarms registered', meta.alarms.join(',') === 'license-refresh,rmp-cache-sweep', meta.alarms.join(','));

// ---------- real Workday-domain pages ----------
const wd = await b.newPage();
wd.on('pageerror', (e) => errs.push('workday: ' + e.message));
wd.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push('workday: ' + m.text()); });
await wd.goto('https://wd5.myworkday.com/sections.html', { waitUntil: 'load' });
await wd.waitForFunction(() => !!document.getElementById('wdc-capture-host'), { timeout: 20000 });
await wait(3000);
ok('content script injects on https://*.myworkday.com', true, await wd.evaluate(() => location.hostname));

const sched = await read('schedule');
ok('captures the schedule', sched?.sections?.length === 3, `${sched?.sections?.length ?? 0} sections`);
const cse = sched?.sections?.find((s) => s.courseCode === 'CSE 1302');
ok('section title is the course cell, not the whole row', !!cse && cse.title.length < 60, cse?.title);
ok('instructor label stripped', cse?.instructor === 'Katsianos, Bill', String(cse?.instructor));
ok('labelled instructor cell still parsed', sched?.sections?.find((s) => s.courseCode === 'MATH 2200')?.instructor === 'Grace Chen');
ok('meeting times parsed', cse?.meetings?.[0]?.startMin === 600 && cse?.meetings?.[0]?.endMin === 650,
   JSON.stringify(cse?.meetings?.[0]));

// display path: turn full names on and read what the panel renders
// Go through the background's merge path from an extension page (the tenant
// page runs in the MAIN world, where chrome.runtime is not exposed). A raw
// partial write would wipe the other settings, which are stored lazily.
{
  const cfg = await b.newPage();
  await cfg.goto(`chrome-extension://${extId}/src/options/index.html`, { waitUntil: 'domcontentloaded' });
  await wait(1200);
  await cfg.evaluate(async () =>
    chrome.runtime.sendMessage({ kind: 'SETTINGS_UPDATE', patch: { showCourseTitles: true, calendarEnabled: true } }));
  await cfg.close();
}
await wait(2500);
const shown = await wd.evaluate(() => {
  const sr = document.getElementById('wdc-capture-host')?.shadowRoot;
  return [...(sr?.querySelectorAll('*') ?? [])].map((e) => e.textContent)
    .filter((t) => t && /CSE 1302/.test(t) && t.length < 90).pop() ?? 'not shown';
});
ok('rendered label has no junk', !/Actions|MWF|\d{1,2}:\d{2}|Instructor/.test(shown), shown.trim().slice(0, 70));

const hp = await b.newPage();
await hp.goto('https://wd5.myworkday.com/history.html', { waitUntil: 'load' });
await wait(3500);
const hist = await read('academicHistory');
const byCode = Object.fromEntries((hist?.courses ?? []).map((c) => [c.code, c]));
ok('captures academic history', hist?.courses?.length === 4, `${hist?.courses?.length ?? 0} courses`);
ok('grade from the Grade column, not Grading Basis', byCode['CSE 1302']?.grade === 'A', byCode['CSE 1302']?.grade);
ok('credits from Units, not Grade Points', byCode['CSE 1302']?.credits === 3, String(byCode['CSE 1302']?.credits));
ok('withdrawn stays withdrawn', byCode['PHYS 1112']?.status === 'withdrawn', byCode['PHYS 1112']?.status);
ok('in-progress stays in progress', byCode['HIST 1050']?.status === 'in-progress', byCode['HIST 1050']?.status);
ok('history title cleaned', byCode['CSE 1302']?.title === 'Introduction to Computer Engineering', byCode['CSE 1302']?.title);

// ---------- live services ----------
const openExt = async (p) => {
  const pg = await b.newPage();
  pg.on('pageerror', (e) => errs.push(`${p}: ${e.message}`));
  pg.on('console', (m) => { if (m.type() === 'error') errs.push(`${p}: ${m.text()}`); });
  await pg.goto(`chrome-extension://${extId}/${p}`, { waitUntil: 'domcontentloaded' });
  await wait(1800);
  return pg;
};
if (ADMIN) {
  const opt = await openExt('src/options/index.html');
  const lic = await opt.evaluate(async (t) => {
    const r = await chrome.runtime.sendMessage({ kind: 'LICENSE_ACTIVATE', code: t });
    return { r, plan: (await chrome.storage.local.get('settings')).settings.plan };
  }, ADMIN);
  ok('activates against the LIVE billing server', lic.r?.data?.status === 'admin', JSON.stringify(lic.r?.data ?? lic.r).slice(0, 70));
  ok('plan unlocks', lic.plan === 'supreme', lic.plan);
  const ai = await opt.evaluate(async () => chrome.runtime.sendMessage({ kind: 'AI_TEST' }));
  ok('AI relay reaches Anthropic (real call)', ai?.data?.ok === true, String(ai?.data?.detail).slice(0, 80));
  await opt.close();
}
for (const p of ['src/options/index.html', 'src/planner/index.html', 'src/subscribe/index.html']) {
  const pg = await openExt(p);
  ok(`${p.split('/')[1]} page renders`, (await pg.evaluate(() => document.body.innerText.trim().length)) > 200);
  await pg.close();
}
ok('no modulepreload warnings', !errs.some((e) => /preload/i.test(e)));
ok('no console errors anywhere', errs.length === 0, errs.slice(0, 2).join(' | '));

const failed = results.filter((r) => r.startsWith('FAIL'));
console.log(results.join('\n'));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await b.close(); fs.rmSync(udd, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
