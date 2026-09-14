import type { ManifestElement } from './types';
import { waitForElement } from './wait-for-element';

export type GoalWatchEvent =
  | { kind: 'reached' }
  | { kind: 'drift'; path: string }
  | { kind: 'lost' }
  | { kind: 'replaced'; element: HTMLElement };

export interface GoalWatchOptions {
  target: HTMLElement;
  /** The manifest entry the target was resolved from; null for a raw spotlight (no re-resolve possible). */
  entry: ManifestElement | null;
  /** The goal's route path; '*' or null never drifts by route. */
  goalPath: string | null;
  currentPath: () => string;
  /** Clicks inside this node (our shadow host) are ignored. */
  ignoreWithin?: Element | null;
  /** How long a detached target may stay missing before it counts as lost. */
  graceMs?: number;
  onEvent: (e: GoalWatchEvent) => void;
}

/**
 * Watches one lit target and reports what the user did with it, as values.
 *
 * Classification is by outcome, never by guessing what a clicked element
 * does: the manifest has no link from a sidebar entry to its route, and a
 * wrong correction is worse than none (BUILD-SPEC 5.7). So a click is only
 * ever "on the target" or "somewhere else", and "somewhere else" is judged
 * on the next frame by where it left the user — route changed away from the
 * goal's screen is drift; target gone and not re-resolvable is lost; the
 * host swapped the node under us is replaced (keep tracking); anything else
 * is the user simply using their app.
 *
 * Passive by construction: capture-phase, `passive: true`, never
 * `preventDefault`, never navigates. The UI is never locked (BUILD-SPEC 6).
 * After reached, drift or lost the watcher stops itself.
 */
export function watchGoal(opts: GoalWatchOptions): () => void {
  const { entry, goalPath, currentPath, ignoreWithin, graceMs = 1500, onEvent } = opts;
  let target = opts.target;
  let stopped = false;
  let frame: number | null = null;
  let scheduled = false;
  let inFlight = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    document.removeEventListener('click', onClick, true);
    observer.disconnect();
    if (frame !== null) cancelAnimationFrame(frame);
  };

  const emit = (e: GoalWatchEvent) => {
    if (stopped) return;
    if (e.kind !== 'replaced') stop();
    onEvent(e);
  };

  const routeLeft = () => !!goalPath && goalPath !== '*' && currentPath() !== goalPath;

  const check = async () => {
    if (stopped || inFlight) return;
    if (routeLeft()) return emit({ kind: 'drift', path: currentPath() });
    if (target.isConnected) return;
    if (!entry) return emit({ kind: 'lost' });

    // Hosts replace nodes on re-render (Refine swaps the whole table on data
    // load). Give the same manifest element a moment to come back before
    // declaring it gone.
    inFlight = true;
    const outcome = await waitForElement(entry, { timeoutMs: graceMs });
    inFlight = false;
    if (stopped) return;
    if (routeLeft()) return emit({ kind: 'drift', path: currentPath() });
    if (outcome.status === 'resolved') {
      target = outcome.element;
      emit({ kind: 'replaced', element: target });
    } else {
      emit({ kind: 'lost' });
    }
  };

  // A flag rather than the frame handle: a test may stub rAF to run the
  // callback synchronously, and then the handle is assigned after the
  // callback has already cleared it.
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    frame = requestAnimationFrame(() => {
      scheduled = false;
      frame = null;
      void check();
    });
  };

  const onClick = (e: Event) => {
    if (stopped) return;
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    const node = (path[0] ?? e.target) as Node | null;
    if (ignoreWithin && node && ignoreWithin.contains(node)) return;
    if (path.includes(target) || (node && target.contains(node))) return emit({ kind: 'reached' });
    // The host's router changes the URL in a bubbling handler, after us. The
    // outcome is only visible on the next frame.
    schedule();
  };

  const observer = new MutationObserver(schedule);
  document.addEventListener('click', onClick, { capture: true, passive: true });
  observer.observe(document.body, { childList: true, subtree: true });

  return stop;
}
