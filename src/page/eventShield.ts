/**
 * Event shield: makes page-level "click outside to close" listeners blind to
 * events that originate inside the extension's own floating UI (the shadow
 * hosts whose ids start with "wdc-").
 *
 * Why the host-side stopPropagation isn't enough: Workday attaches its popup
 * dismissal listeners on document/window, often in the CAPTURE phase. A
 * capture listener on document fires while the event is still travelling
 * DOWN toward our host, before any listener of ours can stop it. The only
 * reliable way to win is to be there first: this module runs in the MAIN
 * world at document_start, before any Workday script, and wraps
 * EventTarget.addEventListener so that listeners the page later registers on
 * window/document/<html>/<body> simply return early for events coming from
 * our panels. Listeners on any other element are passed through untouched,
 * so Workday's own popups keep receiving their own events and still close
 * normally on genuine outside clicks.
 */

const SHIELDED_TYPES = new Set([
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'auxclick',
  'contextmenu',
  'touchstart',
  'touchend',
  'touchmove',
  'wheel',
  'focusin',
  'focusout',
  'focus',
  'blur',
  'keydown',
  'keyup',
  'keypress',
]);

/** All extension shadow hosts carry ids like "wdc-panel-host". */
const HOST_ID_PREFIX = 'wdc-';

function fromCompanionUi(e: Event): boolean {
  if (typeof e.composedPath !== 'function') return false;
  for (const node of e.composedPath()) {
    const id = (node as Element).id;
    if (typeof id === 'string' && id.startsWith(HOST_ID_PREFIX)) return true;
  }
  return false;
}

export function installEventShield(): void {
  const originalAdd = EventTarget.prototype.addEventListener;
  const originalRemove = EventTarget.prototype.removeEventListener;
  // original listener -> shielded wrapper, so removeEventListener still works
  const wrappers = new WeakMap<object, EventListener>();

  const isPageLevel = (target: unknown): boolean =>
    target === window ||
    target === document ||
    target === document.documentElement ||
    (document.body !== null && target === document.body);

  EventTarget.prototype.addEventListener = function patchedAdd(
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (listener !== null && SHIELDED_TYPES.has(type) && isPageLevel(this)) {
      let shield = wrappers.get(listener);
      if (!shield) {
        shield = function shielded(this: unknown, e: Event) {
          try {
            if (fromCompanionUi(e)) return undefined;
          } catch {
            // never let the shield break the page — fall through
          }
          return typeof listener === 'function'
            ? listener.call(this, e)
            : listener.handleEvent(e);
        };
        wrappers.set(listener, shield);
      }
      return originalAdd.call(this, type, shield, options);
    }
    return originalAdd.call(this, type, listener, options);
  };

  EventTarget.prototype.removeEventListener = function patchedRemove(
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) {
    if (listener !== null && SHIELDED_TYPES.has(type) && isPageLevel(this)) {
      const shield = wrappers.get(listener);
      if (shield) return originalRemove.call(this, type, shield, options);
    }
    return originalRemove.call(this, type, listener, options);
  };
}
