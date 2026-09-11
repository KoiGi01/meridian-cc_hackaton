// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isVisible } from './visibility';

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

function withRect(el: HTMLElement, rect: { width: number; height: number }) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: rect.width,
    bottom: rect.height,
    width: rect.width,
    height: rect.height,
    toJSON: () => '',
  } as DOMRect);
  return el;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('isVisible', () => {
  it('accepts a normal rendered element', () => {
    expect(isVisible(withRect(mount('<button>Go</button>'), { width: 80, height: 20 }))).toBe(true);
  });

  it('rejects an element with display none', () => {
    const el = mount('<button style="display:none">Go</button>');
    expect(isVisible(withRect(el, { width: 0, height: 0 }))).toBe(false);
  });

  it('rejects an element with visibility hidden', () => {
    const el = mount('<button style="visibility:hidden">Go</button>');
    expect(isVisible(withRect(el, { width: 80, height: 20 }))).toBe(false);
  });

  it('rejects a zero-size element, which cannot be pointed at', () => {
    expect(isVisible(withRect(mount('<button>Go</button>'), { width: 0, height: 0 }))).toBe(false);
  });

  it('rejects an element detached from the document', () => {
    const orphan = document.createElement('button');
    expect(isVisible(withRect(orphan, { width: 80, height: 20 }))).toBe(false);
  });

  it('rejects an element inside a display-none ancestor', () => {
    document.body.innerHTML = '<div style="display:none"><button id="t">Go</button></div>';
    const el = document.getElementById('t') as HTMLElement;
    expect(isVisible(withRect(el, { width: 0, height: 0 }))).toBe(false);
  });

  it('accepts an element scrolled out of view, which exists and can be scrolled to', () => {
    const el = mount('<button>Go</button>');
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 5000,
      top: 5000,
      left: 0,
      right: 80,
      bottom: 5020,
      width: 80,
      height: 20,
      toJSON: () => '',
    } as DOMRect);
    expect(isVisible(el)).toBe(true);
  });
});
