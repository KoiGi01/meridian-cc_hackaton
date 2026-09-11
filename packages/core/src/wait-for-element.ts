import { resolveElement, type ResolveOutcome } from './resolve';
import type { ManifestElement } from './types';

/**
 * Resolves now, and if that misses, keeps trying until the timeout. Needed
 * after navigation: the target does not exist until the new route renders,
 * and that is "not yet", not "missing" (BUILD-SPEC 11).
 */
export function waitForElement(
  element: ManifestElement,
  opts: { timeoutMs?: number; intervalMs?: number; root?: ParentNode } = {},
): Promise<ResolveOutcome> {
  const { timeoutMs = 2000, intervalMs = 100, root } = opts;
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve) => {
    const attempt = () => {
      const outcome = resolveElement(element, root);
      if (outcome.status === 'resolved' || Date.now() >= deadline) {
        resolve(outcome);
        return;
      }
      setTimeout(attempt, intervalMs);
    };
    attempt();
  });
}
