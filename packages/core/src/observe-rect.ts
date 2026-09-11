import type { Rect } from './geometry';
import { rectsApproxEqual } from './geometry';

function toRect(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

/**
 * Calls `cb` with the element's viewport rect now, and again whenever it moves
 * or resizes. Scroll is listened for in the capture phase so that scrolling
 * inside any nested container is caught, not just the window.
 *
 * Returns an unsubscribe function.
 */
export function observeRect(
  el: Element,
  cb: (rect: Rect) => void,
  opts: { epsilon?: number } = {},
): () => void {
  const { epsilon = 0.5 } = opts;
  let last: Rect | null = null;
  let frame: number | null = null;
  let stopped = false;

  const emit = () => {
    frame = null;
    if (stopped) return;
    const next = toRect(el);
    if (last && rectsApproxEqual(last, next, epsilon)) return;
    last = next;
    cb(next);
  };

  const schedule = () => {
    if (stopped || frame !== null) return;
    frame = requestAnimationFrame(emit);
  };

  emit();

  // Capture phase catches scrolls inside nested scroll containers too.
  window.addEventListener('scroll', schedule, { passive: true, capture: true });
  window.addEventListener('resize', schedule, { passive: true });

  const ro = new ResizeObserver(schedule);
  ro.observe(el);
  if (el.ownerDocument.body) ro.observe(el.ownerDocument.body);

  return () => {
    stopped = true;
    if (frame !== null) cancelAnimationFrame(frame);
    window.removeEventListener('scroll', schedule, { capture: true });
    window.removeEventListener('resize', schedule);
    ro.disconnect();
  };
}
