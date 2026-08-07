/**
 * Internal harness for the popup-isolation fix (not linked from the demo).
 * Simulates Workday's four common popup-dismissal strategies and mounts a
 * real isolated shadow host, using the actual shipped modules.
 *
 * Order matters and mirrors the extension: the event shield installs first
 * (document_start), then "Workday" registers its dismissal listeners, then
 * the panel host mounts.
 */
import { installEventShield } from '../src/page/eventShield';
import { isolate } from '../src/content/ui/isolate';

const log = (msg: string) => {
  document.getElementById('log')!.textContent += msg + '\n';
};

/* 1 — extension's MAIN-world script runs at document_start */
installEventShield();

/* 2 — "Workday" wires its dismissal logic */
const popups = {
  bubble: document.getElementById('popup-bubble')!,
  capture: document.getElementById('popup-capture')!,
  window: document.getElementById('popup-window')!,
  focus: document.getElementById('popup-focus')!,
};
const close = (el: HTMLElement) => el.classList.add('closed');

// A: bubble-phase outside click on document
document.addEventListener('mousedown', (e) => {
  if (!popups.bubble.contains(e.target as Node)) close(popups.bubble);
});
// B: CAPTURE-phase outside click on document
document.addEventListener(
  'mousedown',
  (e) => {
    if (!popups.capture.contains(e.target as Node)) close(popups.capture);
  },
  true,
);
// C: capture-phase pointerdown on window
window.addEventListener(
  'pointerdown',
  (e) => {
    if (!popups.window.contains(e.target as Node)) close(popups.window);
  },
  true,
);
// D: focus-based — the popup closes when it loses focus
popups.focus.addEventListener('focusout', () => close(popups.focus));

document.getElementById('reopen')!.addEventListener('click', () => {
  for (const p of Object.values(popups)) p.classList.remove('closed');
  popups.focus.focus();
});

/* 3 — extension mounts its isolated shadow host (same shape as makeHost) */
const host = document.createElement('div');
host.id = 'wdc-test-host';
const shadow = host.attachShadow({ mode: 'open' });
const root = document.createElement('div');
root.style.cssText =
  'position:fixed;right:16px;top:16px;width:240px;padding:12px;background:#0f4c81;color:#fff;border-radius:10px;font-family:system-ui;';
root.innerHTML = `
  <b>Extension panel</b><br/>
  <button id="btn" style="margin:8px 0">panel button</button>
  <span id="clicks">0</span> clicks<br/>
  <input id="field" placeholder="type here" style="width:90%" />
`;
shadow.appendChild(root);
document.documentElement.appendChild(host);
isolate(host);

let clicks = 0;
shadow.getElementById('btn')!.addEventListener('click', () => {
  clicks++;
  shadow.getElementById('clicks')!.textContent = String(clicks);
  log(`panel button clicked (${clicks})`);
});

/* expose state for the driver */
Object.assign(window as unknown as Record<string, unknown>, {
  harness: {
    open: () =>
      Object.fromEntries(
        Object.entries(popups).map(([k, el]) => [k, !el.classList.contains('closed')]),
      ),
    clicks: () => clicks,
    fieldValue: () => (shadow.getElementById('field') as HTMLInputElement).value,
    focusPopup: () => popups.focus.focus(),
  },
});
log('harness ready');
