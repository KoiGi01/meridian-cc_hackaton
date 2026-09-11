// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeRect } from './observe-rect';

let el: HTMLElement;
let rect = { x: 10, y: 20, width: 100, height: 30 };

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // jsdom has no layout engine, so getBoundingClientRect always returns zeroes.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        ...rect,
        top: rect.y,
        left: rect.x,
        right: rect.x + rect.width,
        bottom: rect.y + rect.height,
        toJSON: () => '',
      }) as DOMRect,
  );
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    fn(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  el = document.createElement('button');
  document.body.appendChild(el);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  rect = { x: 10, y: 20, width: 100, height: 30 };
});

describe('observeRect', () => {
  it('reports the current rect immediately, without waiting for an event', () => {
    const cb = vi.fn();
    observeRect(el, cb);
    expect(cb).toHaveBeenCalledWith({ x: 10, y: 20, width: 100, height: 30 });
  });

  it('reports a new rect on scroll', () => {
    const cb = vi.fn();
    observeRect(el, cb);
    cb.mockClear();
    rect = { x: 10, y: -40, width: 100, height: 30 };
    window.dispatchEvent(new Event('scroll'));
    expect(cb).toHaveBeenCalledWith({ x: 10, y: -40, width: 100, height: 30 });
  });

  it('reports a new rect on resize', () => {
    const cb = vi.fn();
    observeRect(el, cb);
    cb.mockClear();
    rect = { x: 5, y: 20, width: 80, height: 30 };
    window.dispatchEvent(new Event('resize'));
    expect(cb).toHaveBeenCalledWith({ x: 5, y: 20, width: 80, height: 30 });
  });

  it('does not re-notify when the rect has not meaningfully changed', () => {
    const cb = vi.fn();
    observeRect(el, cb);
    cb.mockClear();
    window.dispatchEvent(new Event('scroll'));
    expect(cb).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe', () => {
    const cb = vi.fn();
    const stop = observeRect(el, cb);
    stop();
    cb.mockClear();
    rect = { x: 999, y: 999, width: 10, height: 10 };
    window.dispatchEvent(new Event('scroll'));
    expect(cb).not.toHaveBeenCalled();
  });
});
