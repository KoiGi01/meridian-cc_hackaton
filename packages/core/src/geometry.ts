export interface Rect { x: number; y: number; width: number; height: number }
export interface Cutout { x: number; y: number; width: number; height: number; radius: number }

export interface CutoutOptions {
  /** Breathing room around the target, in css pixels. */
  padding?: number;
  /** Corner radius of the lit area, clamped to half the smaller dimension. */
  radius?: number;
  /** When supplied, the cutout is clipped to these bounds. */
  viewport?: { width: number; height: number };
}

const DEFAULT_PADDING = 6;
const DEFAULT_RADIUS = 8;

/**
 * Turns a target's viewport rect into the lit rectangle the overlay punches out.
 * A zero-size target yields a zero-size cutout: we light nothing rather than
 * light the wrong thing.
 */
export function computeCutout(target: Rect, opts: CutoutOptions = {}): Cutout {
  const { padding = DEFAULT_PADDING, radius = DEFAULT_RADIUS, viewport } = opts;

  if (target.width <= 0 || target.height <= 0) {
    return { x: target.x, y: target.y, width: 0, height: 0, radius: 0 };
  }

  let left = target.x - padding;
  let top = target.y - padding;
  let right = target.x + target.width + padding;
  let bottom = target.y + target.height + padding;

  if (viewport) {
    left = Math.min(Math.max(left, 0), viewport.width);
    top = Math.min(Math.max(top, 0), viewport.height);
    right = Math.max(Math.min(right, viewport.width), 0);
    bottom = Math.max(Math.min(bottom, viewport.height), 0);
  }

  const width = Math.max(right - left, 0);
  const height = Math.max(bottom - top, 0);

  return {
    x: left,
    y: top,
    width,
    height,
    radius: Math.max(Math.min(radius, Math.min(width, height) / 2), 0),
  };
}

export function rectsApproxEqual(a: Rect, b: Rect, epsilon = 0.5): boolean {
  return (
    Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.width - b.width) < epsilon &&
    Math.abs(a.height - b.height) < epsilon
  );
}
