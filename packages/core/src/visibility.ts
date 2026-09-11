/**
 * True when the element is actually on the page and could be pointed at.
 *
 * Deliberately NOT a viewport check: an element scrolled below the fold is
 * visible for our purposes, because we scroll to it before lighting it. What we
 * are excluding is elements that are hidden, collapsed, or detached — a closed
 * menu's items, for instance, which are "not yet" rather than "gone".
 */
export function isVisible(el: Element): boolean {
  if (!el.isConnected) return false;

  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  if (style.display === 'none') return false;

  return true;
}
