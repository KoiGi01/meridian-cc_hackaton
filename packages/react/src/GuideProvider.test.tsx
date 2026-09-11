import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuideProvider, useGuide } from './GuideProvider';

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
});
