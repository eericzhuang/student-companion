/**
 * Host-side event isolation for the floating-UI shadow hosts.
 *
 * Two layers keep Workday's own popups open while the user interacts with our
 * panels (the MAIN-world eventShield covers capture-phase page listeners):
 *
 *  1. stopPropagation for every pointer/mouse/touch/wheel/key/focus event at
 *     the host, so bubble-phase "outside click" listeners on the page never
 *     see interactions with our UI.
 *  2. Focus preservation: mousedown's default action moves focus, and many
 *     Workday popups dismiss themselves the moment they lose focus — no
 *     amount of stopPropagation prevents that. So clicking panel chrome
 *     (tabs, buttons, blocks) calls preventDefault to keep focus wherever it
 *     was. Editable fields, native scrollbars, and resize grips are carved
 *     out — those genuinely need the default mousedown behavior.
 */

export const ISOLATED_EVENTS = [
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
  'keydown',
  'keyup',
  'keypress',
];

/** Elements whose default mousedown behavior (taking focus) we must keep. */
const NEEDS_FOCUS = 'input, textarea, select, option, [contenteditable]';

/** Pixel size of the native resize grip in the corner of a resizable box. */
const GRIP = 20;

function needsNativeMousedown(e: MouseEvent): boolean {
  for (const node of e.composedPath()) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.matches(NEEDS_FOCUS)) return true;
    const rect = node.getBoundingClientRect();
    // Native scrollbar drag: the pointer is past the padding-box edge, in the
    // scrollbar gutter of a scrollable element.
    if (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth) {
      if (
        e.clientX > rect.left + node.clientLeft + node.clientWidth ||
        e.clientY > rect.top + node.clientTop + node.clientHeight
      ) {
        return true;
      }
    }
    // Native resize grip (bottom-right corner of a resizable panel).
    if (getComputedStyle(node).resize !== 'none') {
      if (e.clientX >= rect.right - GRIP && e.clientY >= rect.bottom - GRIP) return true;
    }
  }
  return false;
}

/** Wire the isolation listeners onto a shadow host element. */
export function isolate(hostEl: HTMLElement): void {
  for (const type of ISOLATED_EVENTS) {
    hostEl.addEventListener(type, (e) => e.stopPropagation());
  }
  hostEl.addEventListener('mousedown', (e) => {
    if (!needsNativeMousedown(e)) e.preventDefault();
  });
}
