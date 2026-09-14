// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchGoal, type GoalWatchEvent } from './goal-watch';
import type { ManifestElement } from './types';

const entry: ManifestElement = {
  id: 'products.add',
  purpose: null,
  aliases: [],
  destructive: false,
  anchors: [{ kind: 'testid', value: 'add', confidence: 1 }],
};

let path: string;
let events: GoalWatchEvent[];
let stop: (() => void) | null;

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.querySelector('[data-testid="add"]') as HTMLElement;
}

function watch(target: HTMLElement, overrides: Partial<Parameters<typeof watchGoal>[0]> = {}) {
  stop = watchGoal({
    target,
    entry,
    goalPath: '/products',
    currentPath: () => path,
    onEvent: (e) => events.push(e),
    ...overrides,
  });
  return stop;
}

/** Dispatches a click and lets the next frame run, as a browser would. */
async function click(el: Element) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  await flush();
}

/** MutationObserver callbacks are microtasks; rAF is stubbed as a 0 ms timer. */
async function flush() {
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  path = '/products';
  events = [];
  stop = null;
  // Like the real thing, the frame runs after the whole click dispatch, so a
  // router's bubbling handler has already changed the URL by then.
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const w = this.isConnected ? 80 : 0;
    return { x: 0, y: 0, top: 0, left: 0, right: w, bottom: 20, width: w, height: 20, toJSON: () => '' } as DOMRect;
  });
});

afterEach(() => {
  stop?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('watchGoal', () => {
  it('reports reached when the target is clicked, then stops listening', async () => {
    const target = mount('<button data-testid="add">Add</button>');
    watch(target);
    await click(target);
    await click(target);
    expect(events).toEqual([{ kind: 'reached' }]);
  });

  it('reports reached for a click inside the target', async () => {
    const target = mount('<button data-testid="add"><span id="icon">+</span> Add</button>');
    watch(target);
    await click(document.getElementById('icon')!);
    expect(events).toEqual([{ kind: 'reached' }]);
  });

  it('ignores clicks inside our own host', async () => {
    const target = mount('<button data-testid="add">Add</button><div id="ours"><button id="mic">mic</button></div>');
    watch(target, { ignoreWithin: document.getElementById('ours') });
    path = '/orders'; // even if the route changed, a click on our widget is not the user wandering
    await click(document.getElementById('mic')!);
    expect(events).toEqual([]);
  });

  it('reports drift when a click elsewhere leaves the goal screen', async () => {
    const target = mount('<button data-testid="add">Add</button><a id="orders">Orders</a>');
    watch(target);
    const link = document.getElementById('orders')!;
    link.addEventListener('click', () => {
      path = '/orders';
    });
    await click(link);
    expect(events).toEqual([{ kind: 'drift', path: '/orders' }]);
    // Stopped: a later click on the target no longer reports.
    await click(target);
    expect(events).toHaveLength(1);
  });

  it('stays quiet for a click elsewhere on the same screen', async () => {
    const target = mount('<button data-testid="add">Add</button><button id="other">Other</button>');
    watch(target);
    await click(document.getElementById('other')!);
    expect(events).toEqual([]);
  });

  it('never drifts by route for a global goal', async () => {
    const target = mount('<button data-testid="add">Add</button><a id="orders">Orders</a>');
    watch(target, { goalPath: '*' });
    document.getElementById('orders')!.addEventListener('click', () => {
      path = '/orders';
    });
    await click(document.getElementById('orders')!);
    expect(events).toEqual([]);
  });

  it('reports drift when the route changes without a click (back button)', async () => {
    const target = mount('<button data-testid="add">Add</button>');
    watch(target);
    path = '/orders';
    document.body.appendChild(document.createElement('p')); // the new screen renders
    await flush();
    expect(events).toEqual([{ kind: 'drift', path: '/orders' }]);
  });

  it('reports replaced with the new node when the host swaps the target', async () => {
    const target = mount('<div id="wrap"><button data-testid="add">Add</button></div>');
    watch(target);
    target.remove();
    const fresh = document.createElement('button');
    fresh.dataset.testid = 'add';
    fresh.textContent = 'Add';
    document.getElementById('wrap')!.appendChild(fresh);
    await flush();
    await vi.advanceTimersByTimeAsync(200);
    expect(events).toEqual([{ kind: 'replaced', element: fresh }]);
    // Keeps watching the new node.
    await click(fresh);
    expect(events[1]).toEqual({ kind: 'reached' });
  });

  it('reports lost when the target disappears for longer than the grace period', async () => {
    const target = mount('<button data-testid="add">Add</button>');
    watch(target, { graceMs: 500 });
    target.remove();
    await flush();
    await vi.advanceTimersByTimeAsync(300);
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(400);
    expect(events).toEqual([{ kind: 'lost' }]);
  });

  it('reports lost immediately for a raw spotlight with no manifest entry', async () => {
    const target = mount('<button data-testid="add">Add</button>');
    watch(target, { entry: null });
    target.remove();
    await flush();
    expect(events).toEqual([{ kind: 'lost' }]);
  });

  it('reports nothing after stop()', async () => {
    const target = mount('<button data-testid="add">Add</button>');
    watch(target)();
    await click(target);
    expect(events).toEqual([]);
  });
});
