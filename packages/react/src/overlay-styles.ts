/**
 * The dim is produced by an enormous box-shadow spread on the cutout element
 * itself, rather than by a full-screen element with a hole in it. That keeps the
 * lit area genuinely untouched and means one element moves instead of four.
 */
export const OVERLAY_CSS = `
:host { all: initial; }
.cutout {
  position: fixed;
  pointer-events: none;
  box-sizing: border-box;
  transition: left 180ms ease, top 180ms ease, width 180ms ease, height 180ms ease;
}
@media (prefers-reduced-motion: reduce) {
  .cutout { transition: none; }
}
`;
