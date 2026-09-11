// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManifestElement } from './types';
import { waitForElement } from './wait-for-element';

const el: ManifestElement = {
  id: 'x',
  purpose: null,
  aliases: [],
  destructive: false,
  anchors: [{ kind: 'testid', value: 'late', confidence: 1 }],
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 80,
    bottom: 20,
    width: 80,
    height: 20,
    toJSON: () => '',
  } as DOMRect);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('waitForElement', () => {
  it('resolves immediately when the element is already present', async () => {
    document.body.innerHTML = '<button data-testid="late">go</button>';
    const p = waitForElement(el, { timeoutMs: 1000, intervalMs: 50 });
    await vi.advanceTimersByTimeAsync(0);
    expect((await p).status).toBe('resolved');
  });

  it('keeps trying and succeeds once the element appears', async () => {
    const p = waitForElement(el, { timeoutMs: 1000, intervalMs: 50 });
    await vi.advanceTimersByTimeAsync(120);
    document.body.innerHTML = '<button data-testid="late">go</button>';
    await vi.advanceTimersByTimeAsync(100);
    expect((await p).status).toBe('resolved');
  });

  it('gives up with not-found after the timeout', async () => {
    const p = waitForElement(el, { timeoutMs: 300, intervalMs: 50 });
    await vi.advanceTimersByTimeAsync(400);
    expect((await p).status).toBe('not-found');
  });
});
