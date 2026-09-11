import { describe, expect, it } from 'vitest';
import { computeCutout, rectsApproxEqual } from './geometry';

describe('computeCutout', () => {
  it('expands the target by the padding on every side', () => {
    const c = computeCutout({ x: 100, y: 50, width: 200, height: 40 }, { padding: 8 });
    expect(c).toMatchObject({ x: 92, y: 42, width: 216, height: 56 });
  });

  it('defaults to a small padding rather than hugging the element exactly', () => {
    const c = computeCutout({ x: 100, y: 50, width: 200, height: 40 });
    expect(c.x).toBeLessThan(100);
    expect(c.width).toBeGreaterThan(200);
  });

  it('clamps the cutout to the viewport so it never bleeds off screen', () => {
    const c = computeCutout(
      { x: 2, y: 2, width: 50, height: 50 },
      { padding: 10, viewport: { width: 800, height: 600 } },
    );
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
    // left edge moved from -8 to 0, so width shrinks by the same 8
    expect(c.width).toBe(62);
  });

  it('clamps the right and bottom edges to the viewport', () => {
    const c = computeCutout(
      { x: 750, y: 560, width: 60, height: 60 },
      { padding: 0, viewport: { width: 800, height: 600 } },
    );
    expect(c.x + c.width).toBe(800);
    expect(c.y + c.height).toBe(600);
  });

  it('shrinks the radius so it can never exceed half the smaller dimension', () => {
    const c = computeCutout({ x: 0, y: 0, width: 20, height: 10 }, { padding: 0, radius: 999 });
    expect(c.radius).toBe(5);
  });

  it('returns a zero-size cutout for a zero-size target, so nothing is lit', () => {
    const c = computeCutout({ x: 10, y: 10, width: 0, height: 0 }, { padding: 8 });
    expect(c.width).toBe(0);
    expect(c.height).toBe(0);
  });

  it('never produces negative dimensions for a target fully off screen', () => {
    const c = computeCutout(
      { x: -500, y: -500, width: 50, height: 50 },
      { viewport: { width: 800, height: 600 } },
    );
    expect(c.width).toBeGreaterThanOrEqual(0);
    expect(c.height).toBeGreaterThanOrEqual(0);
  });
});

describe('rectsApproxEqual', () => {
  it('treats sub-pixel jitter as equal, to avoid repaint loops on scroll', () => {
    expect(
      rectsApproxEqual({ x: 0, y: 0, width: 10, height: 10 }, { x: 0.2, y: 0, width: 10, height: 10 }),
    ).toBe(true);
  });

  it('treats a real move as different', () => {
    expect(
      rectsApproxEqual({ x: 0, y: 0, width: 10, height: 10 }, { x: 4, y: 0, width: 10, height: 10 }),
    ).toBe(false);
  });
});
