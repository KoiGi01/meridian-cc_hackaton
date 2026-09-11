// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scrollIntoViewIfNeeded } from './scroll-into-view';

let el: HTMLElement;
let rect = { x: 10, y: 20, width: 100, height: 30 };
let scrollSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
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
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q }));
  scrollSpy = vi.fn();
  el = document.createElement('button');
  el.scrollIntoView = scrollSpy;
  document.body.appendChild(el);
  // jsdom's default window is 1024x768
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  rect = { x: 10, y: 20, width: 100, height: 30 };
});

describe('scrollIntoViewIfNeeded', () => {
  it('does not scroll an element that is already fully visible', () => {
    scrollIntoViewIfNeeded(el);
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it('scrolls an element that sits below the fold', () => {
    rect = { x: 10, y: 2000, width: 100, height: 30 };
    scrollIntoViewIfNeeded(el);
    expect(scrollSpy).toHaveBeenCalledOnce();
  });

  it('scrolls an element that sits above the viewport', () => {
    rect = { x: 10, y: -500, width: 100, height: 30 };
    scrollIntoViewIfNeeded(el);
    expect(scrollSpy).toHaveBeenCalledOnce();
  });

  it('scrolls an element only partly cut off at the bottom', () => {
    rect = { x: 10, y: 750, width: 100, height: 100 };
    scrollIntoViewIfNeeded(el);
    expect(scrollSpy).toHaveBeenCalledOnce();
  });

  it('centres the target rather than leaving it flush against an edge', () => {
    rect = { x: 10, y: 2000, width: 100, height: 30 };
    scrollIntoViewIfNeeded(el);
    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' }));
  });

  it('scrolls smoothly by default', () => {
    rect = { x: 10, y: 2000, width: 100, height: 30 };
    scrollIntoViewIfNeeded(el);
    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
  });

  it('jumps instantly when the user prefers reduced motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: true, media: q }));
    rect = { x: 10, y: 2000, width: 100, height: 30 };
    scrollIntoViewIfNeeded(el);
    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
  });
});
