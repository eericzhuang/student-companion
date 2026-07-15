/**
 * Pointer-drag hook for the floating panels/pills. Tracks an {x,y} position,
 * keeps the handle on-screen, and distinguishes a drag from a click so a
 * draggable pill can still be clicked to expand.
 *
 * Uses setPointerCapture and listens on the dragged element itself, so the
 * drag still ends correctly even though our host stops pointer events from
 * bubbling to the page (the event isolation that keeps Workday popups open).
 */
import { useRef, useState } from 'preact/hooks';

export interface Pos {
  x: number;
  y: number;
}

export interface Draggable {
  pos: Pos;
  setPos: (p: Pos) => void;
  startDrag: (e: PointerEvent) => void;
  /** whether the most recent pointer interaction actually moved (vs a click) */
  wasDragged: () => boolean;
}

/**
 * Keep the panel fully on-screen. When we know the element's size (`size`), clamp
 * so the whole panel stays visible; otherwise fall back to keeping an edge on.
 */
function clamp(x: number, y: number, size?: { w: number; h: number }): Pos {
  const maxX = size ? Math.max(4, window.innerWidth - size.w - 4) : window.innerWidth - 60;
  const maxY = size ? Math.max(4, window.innerHeight - size.h - 4) : window.innerHeight - 40;
  return {
    x: Math.min(Math.max(x, 4), maxX),
    y: Math.min(Math.max(y, 4), maxY),
  };
}

export function useDraggable(initial: Pos, onEnd?: (pos: Pos) => void): Draggable {
  const [pos, setPosState] = useState(initial);
  const posRef = useRef(pos);
  posRef.current = pos;
  const draggedRef = useRef(false);
  // Last known dragged-element size, so setPos()/reset can keep it fully on-screen.
  const sizeRef = useRef<{ w: number; h: number } | undefined>(undefined);

  const setPos = (p: Pos) => setPosState(clamp(p.x, p.y, sizeRef.current));

  const startDrag = (e: PointerEvent) => {
    const el = e.currentTarget as HTMLElement | null;
    if (!el) return;
    // Don't start a drag from an interactive control inside the handle —
    // otherwise pointer capture steals the click and the button never fires.
    const target = e.target as HTMLElement;
    if (target.closest('button, input, textarea, select, a')) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const origin = posRef.current;
    draggedRef.current = false;

    // Measure the panel (the drag handle's positioned ancestor, else the handle)
    // so we can keep the whole thing on-screen.
    const panel = (el.offsetParent as HTMLElement | null) ?? el;
    const rect = panel.getBoundingClientRect();
    const size = { w: rect.width, h: rect.height };
    sizeRef.current = size;

    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // ignore if capture unsupported
    }

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) draggedRef.current = true;
      setPosState(clamp(origin.x + dx, origin.y + dy, size));
    };
    const end = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      try {
        el.releasePointerCapture(ev.pointerId);
      } catch {
        /* noop */
      }
      if (draggedRef.current) onEnd?.(posRef.current);
    };

    // With pointer capture, these fire on `el` regardless of cursor position
    // and regardless of the host's event isolation.
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };

  return { pos, setPos, startDrag, wasDragged: () => draggedRef.current };
}
