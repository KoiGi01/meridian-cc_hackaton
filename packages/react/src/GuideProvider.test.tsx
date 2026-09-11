import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuideProvider, useGuide } from './GuideProvider';

/** Two routes, so cross-route guidance can be exercised. */
const twoRouteManifest = {
  version: 1 as const,
  generatedAt: '2026-09-12T00:00:00Z',
  baseUrl: 'http://localhost:5173',
  routes: [
    {
      path: '/',
      label: 'Home',
      elements: [
        {
          id: 'team.invite-member',
          purpose: 'Opens the invite dialog',
          aliases: ['invite someone', 'add a teammate'],
          anchors: [
            { kind: 'testid' as const, value: 'invite-btn', confidence: 1 },
            { kind: 'text' as const, value: 'Invite member', confidence: 0.6 },
          ],
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
          anchors: [{ kind: 'text' as const, value: 'Add new store', confidence: 0.6 }],
          destructive: false,
        },
      ],
    },
  ],
};

function makeRouter(start = '/') {
  let path = start;
  const calls: string[] = [];
  return {
    calls,
    adapter: {
      currentPath: () => path,
      navigate: (p: string) => {
        path = p;
        calls.push(p);
      },
    },
  };
}

const rect = { x: 10, y: 20, width: 100, height: 30 };

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    fn(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
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
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function Harness() {
  const { spotlight, clear } = useGuide();
  return (
    <div>
      <button data-testid="target" onClick={(e) => spotlight(e.currentTarget)}>
        Invite member
      </button>
      <button data-testid="clear" onClick={() => clear()}>
        Clear
      </button>
    </div>
  );
}

function shadow(): ShadowRoot | null {
  return document.querySelector('[data-pointto-root]')?.shadowRoot ?? null;
}

describe('GuideProvider', () => {
  it('renders nothing highlighted before anything is spotlighted', () => {
    render(
      <GuideProvider>
        <Harness />
      </GuideProvider>,
    );
    expect(shadow()?.querySelector('[data-pointto-cutout]')).toBeNull();
  });

  it('mounts its overlay host in a shadow root so host css cannot reach it', () => {
    render(
      <GuideProvider>
        <Harness />
      </GuideProvider>,
    );
    expect(shadow()).not.toBeNull();
  });

  it('renders a cutout positioned over the target once spotlighted', () => {
    render(
      <GuideProvider>
        <Harness />
      </GuideProvider>,
    );
    act(() => screen.getByTestId('target').click());

    const cutout = shadow()!.querySelector('[data-pointto-cutout]') as HTMLElement;
    expect(cutout).not.toBeNull();
    // default padding 6 applied to { x: 10, y: 20, w: 100, h: 30 }
    expect(cutout.style.left).toBe('4px');
    expect(cutout.style.top).toBe('14px');
    expect(cutout.style.width).toBe('112px');
    expect(cutout.style.height).toBe('42px');
  });

  it('never blocks clicks on the host app', () => {
    render(
      <GuideProvider>
        <Harness />
      </GuideProvider>,
    );
    act(() => screen.getByTestId('target').click());

    const cutout = shadow()!.querySelector('[data-pointto-cutout]') as HTMLElement;
    expect(cutout.style.pointerEvents).toBe('none');
  });

  it('removes the cutout when cleared', () => {
    render(
      <GuideProvider>
        <Harness />
      </GuideProvider>,
    );
    act(() => screen.getByTestId('target').click());
    expect(shadow()!.querySelector('[data-pointto-cutout]')).not.toBeNull();

    act(() => screen.getByTestId('clear').click());
    expect(shadow()!.querySelector('[data-pointto-cutout]')).toBeNull();
  });

  it('clears when spotlight is called with null, rather than lighting the wrong thing', () => {
    function NullHarness() {
      const { spotlight } = useGuide();
      return <button data-testid="nullify" onClick={() => spotlight(null)} />;
    }
    render(
      <GuideProvider>
        <NullHarness />
      </GuideProvider>,
    );
    act(() => screen.getByTestId('nullify').click());
    expect(shadow()!.querySelector('[data-pointto-cutout]')).toBeNull();
  });

  it('removes its shadow host from the document on unmount', () => {
    const { unmount } = render(
      <GuideProvider>
        <Harness />
      </GuideProvider>,
    );
    expect(document.querySelector('[data-pointto-root]')).not.toBeNull();
    unmount();
    expect(document.querySelector('[data-pointto-root]')).toBeNull();
  });

  // Regression: the first browser run rendered no cutout at all for a target
  // below the fold, because the viewport clamp collapsed it to zero height.
  // jsdom hid this by mocking getBoundingClientRect to a constant on-screen rect.
  it('scrolls an off-screen target into view instead of silently lighting nothing', () => {
    const scrollSpy = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          x: 10,
          y: 5000,
          width: 100,
          height: 30,
          top: 5000,
          left: 10,
          right: 110,
          bottom: 5030,
          toJSON: () => '',
        }) as DOMRect,
    );
    // jsdom does not implement scrollIntoView at all, so there is nothing to spy on.
    HTMLElement.prototype.scrollIntoView = scrollSpy;

    render(
      <GuideProvider>
        <Harness />
      </GuideProvider>,
    );
    act(() => screen.getByTestId('target').click());

    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' }));
  });

  it('throws a useful error when useGuide is called outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Harness />)).toThrowError(/GuideProvider/);
  });

  describe('spotlightId', () => {
    const manifest = {
      version: 1 as const,
      generatedAt: '2026-09-12T00:00:00Z',
      baseUrl: 'http://localhost:5173',
      routes: [
        {
          path: '/',
          label: 'Home',
          elements: [
            {
              id: 'team.invite-member',
              purpose: 'Opens the invite dialog',
              aliases: ['add someone'],
              anchors: [
                { kind: 'testid' as const, value: 'invite-btn', confidence: 1 },
                { kind: 'text' as const, value: 'Invite member', confidence: 0.6 },
              ],
              destructive: false,
            },
          ],
        },
      ],
    };

    function IdHarness({ id }: { id: string }) {
      const { spotlightId, lastOutcome } = useGuide();
      return (
        <div>
          <button data-testid="ask" onClick={() => spotlightId(id)}>
            ask
          </button>
          <span data-testid="status">{lastOutcome?.status ?? 'none'}</span>
          <span data-testid="won">
            {lastOutcome?.status === 'resolved' ? lastOutcome.anchorKind : ''}
          </span>
          <button data-testid="invite-btn">Invite member</button>
        </div>
      );
    }

    it('resolves a manifest id and lights the matching element', () => {
      render(
        <GuideProvider manifest={manifest}>
          <IdHarness id="team.invite-member" />
        </GuideProvider>,
      );
      act(() => screen.getByTestId('ask').click());
      expect(screen.getByTestId('status').textContent).toBe('resolved');
      expect(screen.getByTestId('won').textContent).toBe('testid');
      expect(shadow()!.querySelector('[data-pointto-cutout]')).not.toBeNull();
    });

    it('reports not-found and lights nothing when the id is not in the manifest', () => {
      render(
        <GuideProvider manifest={manifest}>
          <IdHarness id="team.nonexistent" />
        </GuideProvider>,
      );
      act(() => screen.getByTestId('ask').click());
      expect(screen.getByTestId('status').textContent).toBe('not-found');
      expect(shadow()!.querySelector('[data-pointto-cutout]')).toBeNull();
    });

    // Regression: asking for the same element twice used to be a silent no-op,
    // because the overlay effect keyed only on target identity. A user who asks,
    // scrolls away, and asks again is the common case, not an edge case.
    it('re-scrolls to the target when the same element is requested again', () => {
      const scrollSpy = vi.fn();
      HTMLElement.prototype.scrollIntoView = scrollSpy;
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
        () =>
          ({
            x: 10,
            y: 5000,
            width: 100,
            height: 30,
            top: 5000,
            left: 10,
            right: 110,
            bottom: 5030,
            toJSON: () => '',
          }) as DOMRect,
      );

      render(
        <GuideProvider manifest={manifest}>
          <IdHarness id="team.invite-member" />
        </GuideProvider>,
      );

      act(() => screen.getByTestId('ask').click());
      act(() => screen.getByTestId('ask').click());

      expect(scrollSpy).toHaveBeenCalledTimes(2);
    });

    it('reports not-found when no manifest was supplied at all', () => {
      render(
        <GuideProvider>
          <IdHarness id="team.invite-member" />
        </GuideProvider>,
      );
      act(() => screen.getByTestId('ask').click());
      expect(screen.getByTestId('status').textContent).toBe('not-found');
    });
  });
  describe('guide and ask', () => {
    let router: ReturnType<typeof makeRouter>;
    beforeEach(() => {
      router = makeRouter('/');
    });

    function AskHarness({ q, id }: { q?: string; id?: string }) {
      const { ask, guide } = useGuide();
      const [out, setOut] = useState('');
      return (
        <div>
          <button
            data-testid="go"
            onClick={async () => setOut(JSON.stringify(q ? await ask(q) : await guide(id!)))}
          >
            go
          </button>
          <pre data-testid="out">{out}</pre>
          <button data-testid="invite-btn">Invite member</button>
        </div>
      );
    }

    it('guide() lights an element on the current route without navigating', async () => {
      render(
        <GuideProvider manifest={twoRouteManifest} router={router.adapter} widget={false}>
          <AskHarness id="team.invite-member" />
        </GuideProvider>,
      );
      await act(async () => {
        screen.getByTestId('go').click();
      });
      await waitFor(() => expect(screen.getByTestId('out').textContent).toContain('"resolved"'));
      expect(router.calls).toEqual([]);
    });

    it('guide() navigates first when the element lives on another route', async () => {
      render(
        <GuideProvider manifest={twoRouteManifest} router={router.adapter} widget={false}>
          <AskHarness id="stores.create" />
        </GuideProvider>,
      );
      await act(async () => {
        screen.getByTestId('go').click();
      });
      await waitFor(() => expect(router.calls).toEqual(['/stores']));
    });

    it('guide() reports unknown-id for an id not in the manifest', async () => {
      render(
        <GuideProvider manifest={twoRouteManifest} router={router.adapter} widget={false}>
          <AskHarness id="nope" />
        </GuideProvider>,
      );
      await act(async () => {
        screen.getByTestId('go').click();
      });
      await waitFor(() => expect(screen.getByTestId('out').textContent).toContain('"unknown-id"'));
    });

    it('ask() maps a typed question to the element and lights it', async () => {
      render(
        <GuideProvider manifest={twoRouteManifest} router={router.adapter} widget={false}>
          <AskHarness q="how do I invite someone?" />
        </GuideProvider>,
      );
      await act(async () => {
        screen.getByTestId('go').click();
      });
      await waitFor(() => expect(screen.getByTestId('out').textContent).toContain('"guided"'));
      expect(shadow()!.querySelector('[data-pointto-cutout]')).not.toBeNull();
    });

    it('ask() returns no-match and lights nothing for an unrelated question', async () => {
      render(
        <GuideProvider manifest={twoRouteManifest} router={router.adapter} widget={false}>
          <AskHarness q="what is the weather" />
        </GuideProvider>,
      );
      await act(async () => {
        screen.getByTestId('go').click();
      });
      await waitFor(() => expect(screen.getByTestId('out').textContent).toContain('"no-match"'));
      expect(shadow()!.querySelector('[data-pointto-cutout]')).toBeNull();
    });
  });

  describe('GuideWidget', () => {
    function shadowEl(sel: string) {
      return shadow()!.querySelector(sel) as HTMLElement | null;
    }

    it('starts closed with only the trigger visible', () => {
      render(
        <GuideProvider manifest={twoRouteManifest}>
          <div />
        </GuideProvider>,
      );
      expect(shadowEl('[data-pointto-trigger]')).not.toBeNull();
      expect(shadowEl('[data-pointto-panel]')).toBeNull();
    });

    it('opens on trigger click and closes on Escape', () => {
      render(
        <GuideProvider manifest={twoRouteManifest}>
          <div />
        </GuideProvider>,
      );
      act(() => shadowEl('[data-pointto-trigger]')!.click());
      expect(shadowEl('[data-pointto-panel]')).not.toBeNull();
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
      expect(shadowEl('[data-pointto-panel]')).toBeNull();
    });

    it('always shows an exit control while open', () => {
      render(
        <GuideProvider manifest={twoRouteManifest}>
          <div />
        </GuideProvider>,
      );
      act(() => shadowEl('[data-pointto-trigger]')!.click());
      expect(shadowEl('[data-pointto-exit]')).not.toBeNull();
    });

    it('answers a typed question by lighting the element and replying with its purpose', async () => {
      render(
        <GuideProvider manifest={twoRouteManifest}>
          <button data-testid="invite-btn">Invite member</button>
        </GuideProvider>,
      );
      act(() => shadowEl('[data-pointto-trigger]')!.click());
      const input = shadowEl('[data-pointto-input]') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(input, { target: { value: 'how do I invite someone' } });
        fireEvent.submit(input.closest('form')!);
      });
      await waitFor(() =>
        expect(shadowEl('[data-pointto-transcript]')!.textContent).toContain('Opens the invite dialog'),
      );
      expect(shadowEl('[data-pointto-cutout]')).not.toBeNull();
    });

    it('says it could not find it and lights nothing for an unrelated question', async () => {
      render(
        <GuideProvider manifest={twoRouteManifest}>
          <div />
        </GuideProvider>,
      );
      act(() => shadowEl('[data-pointto-trigger]')!.click());
      const input = shadowEl('[data-pointto-input]') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(input, { target: { value: 'what is the weather' } });
        fireEvent.submit(input.closest('form')!);
      });
      await waitFor(() =>
        expect(shadowEl('[data-pointto-transcript]')!.textContent).toMatch(/couldn.t find/i),
      );
      expect(shadowEl('[data-pointto-cutout]')).toBeNull();
    });

    it('never touches the microphone', () => {
      const getUserMedia = vi.fn();
      vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } });
      render(
        <GuideProvider manifest={twoRouteManifest}>
          <div />
        </GuideProvider>,
      );
      act(() => shadowEl('[data-pointto-trigger]')!.click());
      expect(getUserMedia).not.toHaveBeenCalled();
    });

    it('can be disabled with widget={false}', () => {
      render(
        <GuideProvider manifest={twoRouteManifest} widget={false}>
          <div />
        </GuideProvider>,
      );
      expect(shadowEl('[data-pointto-trigger]')).toBeNull();
    });
  });
});
