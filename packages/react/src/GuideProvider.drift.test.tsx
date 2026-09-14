import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { Manifest } from 'pointto-core';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuideProvider, useGuide, type GuideContextValue } from './GuideProvider';
import type { AgentEvent } from './voice/VoiceSession';

/**
 * A fake VoiceSession so the provider's live-session path can be driven
 * without a socket: captures the tool runner and exposes `say`.
 */
const { sessions, FakeSession } = vi.hoisted(() => {
  type Opts = { onToolCall: (n: string, a: Record<string, unknown>) => Promise<unknown>; onEvent: (e: AgentEvent) => void };
  class FakeSession {
    state = 'listening';
    say = vi.fn();
    stop = vi.fn();
    sendText = vi.fn();
    constructor(public opts: Opts) {
      sessions.push(this);
    }
    async start() {}
  }
  const sessions: FakeSession[] = [];
  return { sessions, FakeSession };
});
vi.mock('./voice/VoiceSession', () => ({ VoiceSession: FakeSession }));

const manifest: Manifest = {
  version: 1,
  generatedAt: '2026-09-14T00:00:00Z',
  baseUrl: 'http://localhost:5173',
  routes: [
    {
      path: '*',
      label: 'Everywhere',
      elements: [
        {
          id: 'app.stores',
          purpose: 'Navigates to the stores page',
          aliases: ['stores'],
          anchors: [{ kind: 'testid', value: 'nav-stores', confidence: 1 }],
          destructive: false,
        },
        {
          id: 'app.logout',
          purpose: 'Logs out',
          aliases: ['sign out', 'log me out'],
          anchors: [{ kind: 'testid', value: 'nav-logout', confidence: 1 }],
          destructive: true,
        },
      ],
    },
    {
      path: '/',
      label: 'Home',
      elements: [
        {
          id: 'team.invite-member',
          purpose: 'Opens the invite dialog',
          aliases: ['invite someone', 'add a teammate'],
          anchors: [{ kind: 'testid', value: 'invite-btn', confidence: 1 }],
          destructive: false,
        },
      ],
    },
    {
      path: '/stores',
      label: 'Stores',
      elements: [
        {
          id: 'stores.create',
          purpose: 'Opens the form for adding a new store',
          aliases: ['add a store', 'new store'],
          anchors: [{ kind: 'testid', value: 'add-store', confidence: 1 }],
          destructive: false,
        },
      ],
    },
  ],
};

let api: GuideContextValue;
let events: AgentEvent[];
let navigate: (p: string) => void;
let currentPath: () => string;

/**
 * A tiny host app with a router: the sidebar is on every screen, each route
 * renders its own button, and links navigate in a bubbling click handler —
 * after our capture listener, like React Router does.
 */
function App({ voice }: { voice?: boolean }) {
  const [path, setPath] = useState('/');
  const pathRef = { current: path };
  currentPath = () => pathRef.current;
  navigate = (p: string) => {
    pathRef.current = p;
    setPath(p);
  };
  const [router] = useState(() => ({
    currentPath: () => currentPath(),
    navigate: (p: string) => navigate(p),
  }));
  return (
    <GuideProvider
      manifest={manifest}
      router={router}
      widget={false}
      {...(voice ? { voice: { tokenEndpoint: 'http://localhost:8787/api/voice/token' } } : {})}
    >
      <Probe />
      <nav>
        <a data-testid="nav-home" onClick={() => navigate('/')}>Home</a>
        <a data-testid="nav-stores" onClick={() => navigate('/stores')}>Stores</a>
        <a data-testid="nav-orders" onClick={() => navigate('/orders')}>Orders</a>
        <a data-testid="nav-logout">Logout</a>
      </nav>
      {path === '/' && <button data-testid="invite-btn">Invite member</button>}
      {path === '/stores' && <button data-testid="add-store">Add new store</button>}
      {path === '/orders' && <p data-testid="orders-screen">Orders</p>}
    </GuideProvider>
  );
}

function Probe() {
  const g = useGuide();
  api = g;
  useEffect(() => g.onAgentEvent((e) => events.push(e)), [g]);
  return null;
}

const shadow = () => document.querySelector('[data-pointto-root]')?.shadowRoot ?? null;
const cutout = () => shadow()?.querySelector('[data-pointto-cutout]') ?? null;
const drifts = () => events.filter((e) => e.type === 'drift');

async function click(testId: string) {
  await act(async () => {
    screen.getByTestId(testId).dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    // The frame after the click, then the observer's microtask.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

/**
 * Awaits a provider promise while letting React flush. Inside one long
 * async act() the re-render that puts the next screen on the page would be
 * held until the scope ends, and guide()'s poll for the button would time out.
 */
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  let out!: T;
  const tracked = p.then((v) => {
    out = v;
    done = true;
  });
  while (!done) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
  await tracked;
  return out;
}

const guide = (id: string) => settle(api.guide(id));

beforeEach(() => {
  events = [];
  sessions.length = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // Deferred like the real thing: a router's bubbling handler runs first.
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const w = this.isConnected ? 100 : 0;
    return { x: 10, y: 20, width: w, height: 30, top: 20, left: 10, right: 10 + w, bottom: 50, toJSON: () => '' } as DOMRect;
  });
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
});

afterEach(() => {
  // Not automatic without vitest globals: an unmounted-but-alive provider
  // would keep watching the body and answer the next test's clicks.
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('drift detection', () => {
  it('turns the light off when the user clicks the lit control, and says nothing', async () => {
    render(<App />);
    await guide('team.invite-member');
    expect(cutout()).not.toBeNull();
    await click('invite-btn');
    expect(cutout()).toBeNull();
    expect(drifts()).toEqual([{ type: 'drift', kind: 'reached', elementId: 'team.invite-member' }]);
  });

  it('corrects in text when the user leaves the goal screen with no session open', async () => {
    render(<App />);
    await guide('stores.create');
    expect(currentPath()).toBe('/stores');
    expect(cutout()).not.toBeNull();

    await click('nav-orders');
    expect(cutout()).toBeNull();
    const [d] = drifts();
    expect(d).toMatchObject({ kind: 'drift', elementId: 'stores.create', attempt: 1, final: false, spoken: false });
    expect(String(d!.text)).toContain('Stores');
    expect(String(d!.text)).toContain('/orders'); // no label for /orders in the manifest: the path is said instead
  });

  it('relights the goal silently when the user comes back on their own', async () => {
    render(<App />);
    await guide('stores.create');
    await click('nav-orders');
    expect(cutout()).toBeNull();

    await click('nav-stores');
    await waitFor(() => expect(cutout()).not.toBeNull());
    expect(drifts().map((e) => e.kind)).toEqual(['drift', 'relit']);
  });

  it('after the second ignored correction offers to start over, then stays quiet', async () => {
    render(<App />);
    await guide('stores.create');
    await click('nav-orders'); // 1
    await click('nav-stores');
    await waitFor(() => expect(cutout()).not.toBeNull());
    await click('nav-orders'); // 2
    await click('nav-stores');
    await waitFor(() => expect(cutout()).not.toBeNull());
    await click('nav-orders'); // 3: the offer
    const kinds = drifts().map((e) => `${e.kind}:${e.attempt ?? ''}${e.final ? '!' : ''}`);
    expect(kinds).toEqual(['drift:1', 'relit:', 'drift:2', 'relit:', 'drift:3!']);
    expect(String(drifts().at(-1)!.text)).toMatch(/start over/i);

    // The quest is gone: coming back relights nothing, leaving again says nothing.
    await click('nav-stores');
    await new Promise((r) => setTimeout(r, 20));
    expect(cutout()).toBeNull();
    await click('nav-orders');
    expect(drifts()).toHaveLength(5);
  });

  it('a new question starts a fresh count', async () => {
    render(<App />);
    await guide('stores.create');
    await click('nav-orders');
    await settle(api.ask('add a store'));
    await click('nav-orders');
    expect(drifts().filter((e) => e.kind === 'drift').map((e) => e.attempt)).toEqual([1, 1]);
  });

  it('does not mistake its own navigation for the user wandering', async () => {
    render(<App />);
    await guide('team.invite-member');
    await guide('stores.create'); // navigates / → /stores while a light is on
    await new Promise((r) => setTimeout(r, 20));
    expect(drifts().filter((e) => e.kind === 'drift')).toEqual([]);
    expect(cutout()).not.toBeNull();
  });

  it('keeps the quest while the way back is lit, and relights the goal once the user takes it', async () => {
    render(<App />);
    await guide('stores.create');
    await click('nav-orders');
    // The agent lights the sidebar link: a waypoint, not a new quest.
    await guide('app.stores');
    expect(cutout()).not.toBeNull();
    await click('nav-stores');
    await waitFor(() => expect(cutout()).not.toBeNull());
    expect(drifts().map((e) => `${e.kind}:${e.elementId}`)).toEqual([
      'drift:stores.create',
      'reached:app.stores',
      'relit:stores.create',
    ]);
    // Still the same quest: the next drift is the second correction.
    await click('nav-orders');
    expect(drifts().at(-1)).toMatchObject({ kind: 'drift', attempt: 2 });
  });

  it('asks before lighting a destructive element in text mode, and lights it once confirmed', async () => {
    render(<App />);
    const res = await settle(api.ask('log me out'));
    expect(res).toMatchObject({ status: 'needs-confirmation', match: { elementId: 'app.logout' } });
    expect(cutout()).toBeNull();
    await settle(api.confirmGuide('app.logout'));
    expect(cutout()).not.toBeNull();
  });

  describe('with a live session', () => {
    it('speaks the correction through the agent instead of showing text', async () => {
      render(<App voice />);
      await act(async () => {
        await api.startVoice();
      });
      await guide('stores.create');
      await click('nav-orders');
      const s = sessions[0]!;
      expect(s.say).toHaveBeenCalledOnce();
      expect(String(s.say.mock.calls[0]![0])).toContain('/orders');
      expect(String(s.say.mock.calls[0]![0])).toContain('stores.create');
      expect(drifts()[0]).toMatchObject({ kind: 'drift', spoken: true });
    });

    it('await_interaction resolves when the user clicks, and rejects when they wander', async () => {
      render(<App voice />);
      await act(async () => {
        await api.startVoice();
      });
      const run = sessions[0]!.opts.onToolCall;
      await guide('team.invite-member');
      const p = run('await_interaction', { element_id: 'team.invite-member' });
      await click('invite-btn');
      await expect(p).resolves.toEqual({ status: 'clicked', element_id: 'team.invite-member' });

      await guide('stores.create');
      const p2 = run('await_interaction', { element_id: 'stores.create' });
      await click('nav-orders');
      await expect(p2).rejects.toThrow(/went to \/orders instead of clicking "stores.create"/);
    });

    it('the navigate tool ends the quest rather than reading its own move as drift', async () => {
      render(<App voice />);
      await act(async () => {
        await api.startVoice();
      });
      const run = sessions[0]!.opts.onToolCall;
      await guide('stores.create');
      await settle(run('navigate', { path: '/' }));
      await settle(new Promise((r) => setTimeout(r, 20)));
      expect(cutout()).toBeNull();
      expect(drifts()).toEqual([]);
      expect(sessions[0]!.say).not.toHaveBeenCalled();
    });
  });
});
