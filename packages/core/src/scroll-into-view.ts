function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Brings a target into view when, and only when, part of it is outside the
 * viewport. A target below the fold would otherwise clamp to a zero-size
 * cutout and we would light nothing at all, which reads to the user as the
 * agent simply failing to answer.
 *
 * Spec: BUILD-SPEC 5.3 — "element exists but is scrolled out of view -> scroll
 * into view, then resolve".
 */
export function scrollIntoViewIfNeeded(el: Element): void {
  const r = el.getBoundingClientRect();
  const fullyVisible =
    r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;

  if (fullyVisible) return;

  el.scrollIntoView({
    block: 'center',
    inline: 'nearest',
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  });
}
