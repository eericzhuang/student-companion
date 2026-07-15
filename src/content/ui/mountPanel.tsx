/**
 * Shadow-DOM hosts for the injected floating UIs (calendar, capture widget,
 * professor panel, popovers). Each host isolates its pointer/mouse events from
 * the page so interacting with our UI doesn't count as an "outside click" that
 * would close Workday's own popups/menus.
 */
import { render, type ComponentChild } from 'preact';
import { CalendarPanel } from './CalendarPanel';
import { CaptureWidget } from './CaptureWidget';
import { RmpAllPanel } from './RmpAllPanel';
import cssText from './styles.css?inline';

const HOST_ID = 'wdc-panel-host';
const CAPTURE_HOST_ID = 'wdc-capture-host';
const RMP_HOST_ID = 'wdc-rmp-panel-host';
let host: HTMLElement | null = null;
let captureHost: HTMLElement | null = null;
let rmpHost: HTMLElement | null = null;

// Events that Workday's "click outside to close" logic listens for. We stop
// them at our host so they never reach Workday's document-level listeners.
const ISOLATED_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'touchstart'];

function isolate(hostEl: HTMLElement): void {
  for (const type of ISOLATED_EVENTS) {
    hostEl.addEventListener(type, (e) => e.stopPropagation());
  }
}

/** Create an isolated shadow host and render `node` into it. */
function makeHost(id: string, node: ComponentChild): HTMLElement {
  const el = document.createElement('div');
  el.id = id;
  const shadow = el.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = cssText;
  shadow.appendChild(style);
  const root = document.createElement('div');
  shadow.appendChild(root);
  document.documentElement.appendChild(el);
  isolate(el);
  render(node, root);
  return el;
}

export async function ensurePanel(): Promise<void> {
  if (host?.isConnected) return;
  host = makeHost(HOST_ID, <CalendarPanel />);
}

export function removePanel(): void {
  if (host) {
    host.remove();
    host = null;
  }
}

/**
 * Mount the capture widget once; it persists across SPA route changes and
 * reacts to the current-page signal. Idempotent.
 */
export function ensureCaptureWidget(): void {
  if (captureHost?.isConnected) return;
  captureHost = makeHost(CAPTURE_HOST_ID, <CaptureWidget />);
}

export function removeCaptureWidget(): void {
  if (captureHost) {
    captureHost.remove();
    captureHost = null;
  }
}

/** Mount the "all professors on this page" RMP panel. Idempotent. */
export function ensureRmpPanel(): void {
  if (rmpHost?.isConnected) return;
  rmpHost = makeHost(RMP_HOST_ID, <RmpAllPanel />);
}

export function removeRmpPanel(): void {
  if (rmpHost) {
    rmpHost.remove();
    rmpHost = null;
  }
}

/** Shared shadow-root factory for popovers/dialogs injected outside the panel. */
export function createShadowContainer(id: string): { container: HTMLElement; root: HTMLElement } {
  document.getElementById(id)?.remove();
  const container = document.createElement('div');
  container.id = id;
  const shadow = container.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = cssText;
  shadow.appendChild(style);
  const root = document.createElement('div');
  shadow.appendChild(root);
  document.documentElement.appendChild(container);
  isolate(container);
  return { container, root };
}
