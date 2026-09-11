# Phase 3: Text-Mode Intent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user types "how do I add a product?" into a widget, the app navigates to the right screen if needed, and the right button lights up. The entire product works end to end with no voice. This is the safety net (§9.3).

**Architecture:** Intent matching is a framework-free `IntentResolver` interface in `pointto-core` with one implementation, `LexicalIntentResolver`, that scores manifest elements by token overlap against their aliases, purpose, id, and route label. Phase 4 plugs an LLM-backed resolver into the same interface, so text and voice share one engine (§5.5 "full parity"). Cross-route guidance goes through a small `RouterAdapter` with a default `history.pushState` implementation; after navigating, the element is polled for briefly because it does not exist until the new route renders (§11 "not yet rendered ≠ missing"). The widget renders inside the existing shadow root next to the overlay.

**Tech Stack:** As before. No new dependencies.

**Spec:** [BUILD-SPEC.md](../../../BUILD-SPEC.md) §5.5, §5.6 (`navigate`), §9.3, §11. Decisions doc §1 (single `pointto` package).

## Global Constraints

Phase 1 and 2 constraints still apply. Additionally:

- **No network calls and no API keys in this phase.** The lexical resolver is the guaranteed offline floor.
- **Never light a low-confidence guess.** Below the score threshold, the widget says it could not find it and offers the top candidates as suggestions. Between two close candidates, it asks rather than picks.
- **The widget lives in the shadow root.** Host CSS must not reach it.
- **Escape always closes the widget** and there is always a visible Exit control (§5.5).
- **`spotlightId` stays synchronous and unchanged.** The new async path is `guide(id)`; existing callers and tests are untouched.

---

### Task 1: Lexical intent resolver

**Files:**
- Create: `packages/core/src/intent.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/intent.test.ts`

**Interfaces:**
- Produces:
  - `interface IntentMatch { elementId: string; routePath: string; score: number; matchedOn: string[] }`
  - `interface IntentResolver { resolve(query: string, manifest: Manifest): Promise<IntentMatch[]> }` — ranked, best first, empty when nothing plausible.
  - `class LexicalIntentResolver implements IntentResolver` with `constructor(opts?: { minScore?: number })`.
  - `tokenize(s: string): string[]` exported for reuse by the scanner later.

Scoring, deliberately simple and explainable: tokenize both sides (lowercase, strip punctuation, drop a small English stopword list, crude singularisation by trimming a trailing `s`). Each element gets `3 × (query tokens found in aliases) + 2 × (found in purpose) + 1 × (found in id or route label)`, divided by the query token count so long questions do not score higher than short ones. Anything under `minScore` (default `0.34`, i.e. at least one strong hit per three query tokens) is dropped.

- [ ] **Step 1: Write the failing test**

`packages/core/src/intent.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LexicalIntentResolver, tokenize } from './intent';
import type { Manifest } from './types';

const manifest: Manifest = {
  version: 1,
  generatedAt: '2026-09-11T00:00:00Z',
  baseUrl: 'http://localhost',
  routes: [
    {
      path: '/products',
      label: 'Products',
      elements: [
        {
          id: 'products.create',
          purpose: 'Opens the form for adding a new product to the catalogue',
          aliases: ['add a product', 'new product', 'create a product', 'add an item to the menu'],
          anchors: [{ kind: 'text', value: 'Add new product', confidence: 0.4 }],
          destructive: false,
        },
        {
          id: 'products.nav',
          purpose: 'Sidebar link that opens the product catalogue',
          aliases: ['products', 'catalogue', 'menu items'],
          anchors: [{ kind: 'text', value: 'Products', confidence: 0.4 }],
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
          purpose: 'Opens the form for adding a new store location',
          aliases: ['add a store', 'new store', 'open a new branch'],
          anchors: [{ kind: 'text', value: 'Add new store', confidence: 0.4 }],
          destructive: false,
        },
      ],
    },
  ],
};

const resolver = new LexicalIntentResolver();

describe('tokenize', () => {
  it('lowercases, strips punctuation, and drops stopwords', () => {
    expect(tokenize('How do I add a Product?')).toEqual(['add', 'product']);
  });

  it('singularises crudely so "products" matches "product"', () => {
    expect(tokenize('products')).toEqual(['product']);
  });
});

describe('LexicalIntentResolver', () => {
  it('ranks the obvious answer first', async () => {
    const [best] = await resolver.resolve('how do I add a product?', manifest);
    expect(best?.elementId).toBe('products.create');
  });

  it('carries the route path so the caller can navigate', async () => {
    const [best] = await resolver.resolve('open a new branch', manifest);
    expect(best?.elementId).toBe('stores.create');
    expect(best?.routePath).toBe('/stores');
  });

  it('weights aliases above purpose text', async () => {
    // "menu" appears only in an alias of products.create; "catalogue" in an alias of products.nav.
    const [best] = await resolver.resolve('add an item to the menu', manifest);
    expect(best?.elementId).toBe('products.create');
  });

  it('returns nothing rather than a weak guess for an unrelated question', async () => {
    expect(await resolver.resolve('what is the weather today', manifest)).toEqual([]);
  });

  it('returns an empty list for an empty query', async () => {
    expect(await resolver.resolve('   ', manifest)).toEqual([]);
  });

  it('explains what it matched on', async () => {
    const [best] = await resolver.resolve('new product', manifest);
    expect(best?.matchedOn).toContain('alias');
  });

  it('returns more than one candidate when several are plausible', async () => {
    const matches = await resolver.resolve('add new', manifest);
    expect(matches.map((m) => m.elementId)).toEqual(
      expect.arrayContaining(['products.create', 'stores.create']),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm vitest run packages/core/src/intent.test.ts` → `Failed to resolve import "./intent"`.

- [ ] **Step 3: Implement**

`packages/core/src/intent.ts`:

```ts
import type { Manifest } from './types';

export interface IntentMatch {
  elementId: string;
  routePath: string;
  /** 0..1-ish. Compare between candidates, do not treat as a probability. */
  score: number;
  /** Which fields contributed: 'alias' | 'purpose' | 'id' | 'route'. */
  matchedOn: string[];
}

/**
 * Maps a natural-language request to manifest element ids, best first.
 * Text mode and voice mode both go through this interface; only the
 * implementation differs. An empty result means "nothing plausible" and the
 * caller must say so rather than pick something.
 */
export interface IntentResolver {
  resolve(query: string, manifest: Manifest): Promise<IntentMatch[]>;
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'i', 'me', 'my', 'we', 'you',
  'is', 'are', 'do', 'does', 'can', 'how', 'where', 'what', 'want', 'need', 'please', 'it', 'this',
  'that', 'with', 'at', 'from', 'by', 'up', 'go', 'get', 'find', 'show', 'let',
]);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t));
}

function overlap(query: string[], text: string): number {
  const bag = new Set(tokenize(text));
  return query.filter((t) => bag.has(t)).length;
}

/**
 * Explainable token-overlap scoring. Aliases are what a user would actually
 * say, so they weigh most; purpose is descriptive prose; id and route label
 * are weak hints. Normalised by query length so verbosity is not rewarded.
 */
export class LexicalIntentResolver implements IntentResolver {
  private readonly minScore: number;

  constructor(opts: { minScore?: number } = {}) {
    this.minScore = opts.minScore ?? 0.34;
  }

  async resolve(query: string, manifest: Manifest): Promise<IntentMatch[]> {
    const q = tokenize(query);
    if (q.length === 0) return [];

    const matches: IntentMatch[] = [];

    for (const route of manifest.routes) {
      for (const el of route.elements) {
        const matchedOn: string[] = [];
        let raw = 0;

        const aliasHits = Math.max(0, ...el.aliases.map((a) => overlap(q, a)));
        if (aliasHits > 0) { raw += 3 * aliasHits; matchedOn.push('alias'); }

        const purposeHits = el.purpose ? overlap(q, el.purpose) : 0;
        if (purposeHits > 0) { raw += 2 * purposeHits; matchedOn.push('purpose'); }

        const idHits = overlap(q, el.id.replace(/[.\-_]/g, ' '));
        if (idHits > 0) { raw += idHits; matchedOn.push('id'); }

        const routeHits = overlap(q, route.label);
        if (routeHits > 0) { raw += routeHits; matchedOn.push('route'); }

        const score = raw / (3 * q.length);
        if (score >= this.minScore) {
          matches.push({ elementId: el.id, routePath: route.path, score, matchedOn });
        }
      }
    }

    return matches.sort((a, b) => b.score - a.score);
  }
}
```

- [ ] **Step 4: Export** — add `export { LexicalIntentResolver, tokenize } from './intent'; export type { IntentMatch, IntentResolver } from './intent';` to `packages/core/src/index.ts`.

- [ ] **Step 5: Run** — `pnpm vitest run packages/core` → PASS, 71 core tests.

- [ ] **Step 6: Commit** — `feat(core): lexical intent resolver behind an IntentResolver interface`

---

### Task 2: Wait for an element that has not rendered yet

**Files:**
- Create: `packages/core/src/wait-for-element.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/wait-for-element.test.ts`

**Interfaces:**
- Produces: `waitForElement(element: ManifestElement, opts?: { timeoutMs?: number; intervalMs?: number; root?: ParentNode }): Promise<ResolveOutcome>` — resolves immediately on success, retries until timeout, then returns the last `not-found`.

After a route change the target does not exist until React renders the new screen. Treating that first miss as "missing" would make every cross-route request fail. This polls briefly (default 2000 ms / 100 ms) — long enough for a route render, short enough that a real miss still reads as prompt.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManifestElement } from './types';
import { waitForElement } from './wait-for-element';

const el: ManifestElement = {
  id: 'x', purpose: null, aliases: [], destructive: false,
  anchors: [{ kind: 'testid', value: 'late', confidence: 1 }],
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 80, bottom: 20, width: 80, height: 20, toJSON: () => '',
  } as DOMRect);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

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
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

```ts
import { resolveElement, type ResolveOutcome } from './resolve';
import type { ManifestElement } from './types';

/**
 * Resolves now, and if that misses, keeps trying until the timeout. Needed
 * after navigation: the target does not exist until the new route renders,
 * and that is "not yet", not "missing" (BUILD-SPEC 11).
 */
export function waitForElement(
  element: ManifestElement,
  opts: { timeoutMs?: number; intervalMs?: number; root?: ParentNode } = {},
): Promise<ResolveOutcome> {
  const { timeoutMs = 2000, intervalMs = 100, root } = opts;
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve) => {
    const attempt = () => {
      const outcome = resolveElement(element, root);
      if (outcome.status === 'resolved' || Date.now() >= deadline) {
        resolve(outcome);
        return;
      }
      setTimeout(attempt, intervalMs);
    };
    attempt();
  });
}
```

- [ ] **Step 4: Export, run (74 core tests), commit** — `feat(core): waitForElement for targets that render after navigation`

---

### Task 3: Router adapter and the async `guide()` path

**Files:**
- Create: `packages/react/src/router.ts`
- Modify: `packages/react/src/GuideProvider.tsx`, `packages/react/src/index.ts`
- Test: `packages/react/src/GuideProvider.test.tsx` (extend)

**Interfaces:**
- Produces:
  - `interface RouterAdapter { currentPath(): string; navigate(path: string): void }`
  - `createHistoryRouter(): RouterAdapter` — default; `pushState` then dispatches `popstate`, which is what `BrowserRouter` listens to.
  - `GuideProvider` gains props `router?: RouterAdapter` and `intent?: IntentResolver`.
  - `useGuide()` gains `guide(id: string): Promise<GuideResult>` and `ask(query: string): Promise<AskResult>`, where
    - `type GuideResult = { status: 'resolved'; elementId: string; navigated: boolean } | { status: 'not-found'; elementId: string; navigated: boolean } | { status: 'unknown-id'; elementId: string }`
    - `type AskResult = { status: 'guided'; match: IntentMatch; result: GuideResult } | { status: 'ambiguous'; candidates: IntentMatch[] } | { status: 'no-match' }`

`ask` is the whole text-mode pipeline in one call: resolve intent → if ambiguous (top two within 0.15) return candidates → else `guide(best)`. `guide` navigates when the element's route differs from the current path, then `waitForElement`, then lights it.

- [ ] **Step 1: Write the failing tests** — inside the existing top-level `describe`, using the `manifest` from the `spotlightId` block extended with a second route `/stores` containing `stores.create` (text anchor "Add new store"):

```tsx
describe('guide and ask', () => {
  function makeRouter(start = '/') {
    let path = start;
    return {
      calls: [] as string[],
      adapter: { currentPath: () => path, navigate: (p: string) => { path = p; router.calls.push(p); } },
    };
  }
  let router: ReturnType<typeof makeRouter>;
  beforeEach(() => { router = makeRouter('/'); });

  function AskHarness({ q, id }: { q?: string; id?: string }) {
    const { ask, guide } = useGuide();
    const [out, setOut] = useState('');
    return (
      <div>
        <button data-testid="go" onClick={async () => setOut(JSON.stringify(q ? await ask(q) : await guide(id!)))}>go</button>
        <pre data-testid="out">{out}</pre>
        <button data-testid="invite-btn">Invite member</button>
      </div>
    );
  }

  it('guide() lights an element on the current route without navigating', async () => {
    render(<GuideProvider manifest={manifest} router={router.adapter}><AskHarness id="team.invite-member" /></GuideProvider>);
    await act(async () => { screen.getByTestId('go').click(); });
    await waitFor(() => expect(screen.getByTestId('out').textContent).toContain('"resolved"'));
    expect(router.calls).toEqual([]);
  });

  it('guide() navigates first when the element lives on another route', async () => {
    render(<GuideProvider manifest={manifest} router={router.adapter}><AskHarness id="stores.create" /></GuideProvider>);
    await act(async () => { screen.getByTestId('go').click(); });
    await waitFor(() => expect(router.calls).toEqual(['/stores']));
  });

  it('guide() reports unknown-id for an id not in the manifest', async () => {
    render(<GuideProvider manifest={manifest} router={router.adapter}><AskHarness id="nope" /></GuideProvider>);
    await act(async () => { screen.getByTestId('go').click(); });
    await waitFor(() => expect(screen.getByTestId('out').textContent).toContain('"unknown-id"'));
  });

  it('ask() maps a typed question to the element and lights it', async () => {
    render(<GuideProvider manifest={manifest} router={router.adapter}><AskHarness q="how do I invite someone?" /></GuideProvider>);
    await act(async () => { screen.getByTestId('go').click(); });
    await waitFor(() => expect(screen.getByTestId('out').textContent).toContain('"guided"'));
    expect(shadow()!.querySelector('[data-pointto-cutout]')).not.toBeNull();
  });

  it('ask() returns no-match and lights nothing for an unrelated question', async () => {
    render(<GuideProvider manifest={manifest} router={router.adapter}><AskHarness q="what is the weather" /></GuideProvider>);
    await act(async () => { screen.getByTestId('go').click(); });
    await waitFor(() => expect(screen.getByTestId('out').textContent).toContain('"no-match"'));
    expect(shadow()!.querySelector('[data-pointto-cutout]')).toBeNull();
  });
});
```

The manifest's `team.invite-member` needs aliases `['invite someone', 'add a teammate']` for the ask test.

- [ ] **Step 2: Run to verify they fail** — `guide is not a function`.

- [ ] **Step 3: Implement `router.ts`**

```ts
export interface RouterAdapter {
  currentPath(): string;
  navigate(path: string): void;
}

/**
 * Default adapter. pushState alone does not notify React Router; dispatching
 * popstate afterwards does, and is harmless for apps that do not listen.
 * Host apps with a custom router supply their own adapter instead.
 */
export function createHistoryRouter(): RouterAdapter {
  return {
    currentPath: () => window.location.pathname,
    navigate: (path) => {
      window.history.pushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
  };
}
```

- [ ] **Step 4: Extend the provider** — add `router` and `intent` props with defaults (`createHistoryRouter()`, `new LexicalIntentResolver()`), and:

```tsx
const guide = useCallback(async (id: string): Promise<GuideResult> => {
  const entry = manifest ? findElementById(manifest, id) : null;
  if (!entry || !manifest) return { status: 'unknown-id', elementId: id };

  const route = manifest.routes.find((r) => r.elements.includes(entry));
  const navigated = !!route && route.path !== routerRef.current.currentPath();
  if (navigated && route) routerRef.current.navigate(route.path);

  const outcome = await waitForElement(entry, { timeoutMs: navigated ? 2500 : 300 });
  setLastOutcome(outcome);
  setTarget(outcome.status === 'resolved' ? outcome.element : null);
  setRequest((n) => n + 1);
  return { status: outcome.status, elementId: id, navigated };
}, [manifest]);

const ask = useCallback(async (query: string): Promise<AskResult> => {
  if (!manifest) return { status: 'no-match' };
  const matches = await intentRef.current.resolve(query, manifest);
  if (matches.length === 0) return { status: 'no-match' };
  const [best, second] = matches;
  if (second && best!.score - second.score < 0.15) {
    return { status: 'ambiguous', candidates: matches.slice(0, 3) };
  }
  return { status: 'guided', match: best!, result: await guide(best!.elementId) };
}, [manifest, guide]);
```

Keep `router` and `intent` in refs so changing them does not re-create the callbacks.

- [ ] **Step 5: Run** — `pnpm vitest run packages/react` → PASS, 18 tests.

- [ ] **Step 6: Commit** — `feat(react): guide() and ask() — navigate, wait, light, with a router adapter`

---

### Task 4: The widget

**Files:**
- Create: `packages/react/src/GuideWidget.tsx`, `packages/react/src/widget-styles.ts`
- Modify: `packages/react/src/GuideProvider.tsx` (render it in the portal), `packages/react/src/index.ts`
- Test: `packages/react/src/GuideWidget.test.tsx`

**Interfaces:**
- Produces: `<GuideWidget position?: 'bottom-right' | 'bottom-left' />`, exported. Rendered automatically by `GuideProvider` when `widget !== false`. `GuideProvider` gains `widget?: boolean | { position?: ... }`.

Behaviour (§5.5): a floating trigger button; opening it shows a panel with a text input, a transcript, and an Exit button; Escape closes; submitting runs `ask()` and appends a transcript turn. On `guided`, the reply is the element's `purpose` (or "Here it is."). On `ambiguous`, the reply lists the candidates as clickable chips. On `no-match`, the reply says so and never lights anything. Voice arrives in Phase 4 as a mic button next to the input, driving the same `ask`. Rendered into the shadow root so host CSS cannot reach it.

- [ ] **Step 1: Write the failing test**

```tsx
describe('GuideWidget', () => {
  function shadowEl(sel: string) { return shadow()!.querySelector(sel) as HTMLElement | null; }

  it('starts closed with only the trigger visible', () => {
    render(<GuideProvider manifest={manifest}><div /></GuideProvider>);
    expect(shadowEl('[data-pointto-trigger]')).not.toBeNull();
    expect(shadowEl('[data-pointto-panel]')).toBeNull();
  });

  it('opens on trigger click and closes on Escape', () => {
    render(<GuideProvider manifest={manifest}><div /></GuideProvider>);
    act(() => shadowEl('[data-pointto-trigger]')!.click());
    expect(shadowEl('[data-pointto-panel]')).not.toBeNull();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(shadowEl('[data-pointto-panel]')).toBeNull();
  });

  it('always shows an exit control while open', () => {
    render(<GuideProvider manifest={manifest}><div /></GuideProvider>);
    act(() => shadowEl('[data-pointto-trigger]')!.click());
    expect(shadowEl('[data-pointto-exit]')).not.toBeNull();
  });

  it('answers a typed question by lighting the element and replying with its purpose', async () => {
    render(<GuideProvider manifest={manifest}><button data-testid="invite-btn">Invite member</button></GuideProvider>);
    act(() => shadowEl('[data-pointto-trigger]')!.click());
    const input = shadowEl('[data-pointto-input]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'how do I invite someone' } });
      fireEvent.submit(input.closest('form')!);
    });
    await waitFor(() => expect(shadowEl('[data-pointto-transcript]')!.textContent).toContain('Opens the invite dialog'));
    expect(shadowEl('[data-pointto-cutout]')).not.toBeNull();
  });

  it('says it could not find it and lights nothing for an unrelated question', async () => {
    render(<GuideProvider manifest={manifest}><div /></GuideProvider>);
    act(() => shadowEl('[data-pointto-trigger]')!.click());
    const input = shadowEl('[data-pointto-input]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'what is the weather' } });
      fireEvent.submit(input.closest('form')!);
    });
    await waitFor(() => expect(shadowEl('[data-pointto-transcript]')!.textContent).toMatch(/couldn.t find/i));
    expect(shadowEl('[data-pointto-cutout]')).toBeNull();
  });

  it('can be disabled with widget={false}', () => {
    render(<GuideProvider manifest={manifest} widget={false}><div /></GuideProvider>);
    expect(shadowEl('[data-pointto-trigger]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement.** Styles in `widget-styles.ts` as a CSS string (system font, dark panel, high-contrast, `prefers-reduced-motion` respected, `:host { all: initial }` already set). Component in `GuideWidget.tsx` using `useGuide().ask`, local `open` and `turns` state, `useEffect` for the Escape listener while open, `data-pointto-*` attributes on trigger, panel, input, exit, transcript. On `ambiguous`, render candidate chips that call `guide(candidate.elementId)`.

- [ ] **Step 4: Render it from the provider** — inside the portal, after the overlay: `{widget !== false && <GuideWidget {...(typeof widget === 'object' ? widget : {})} />}`.

- [ ] **Step 5: Run** — `pnpm vitest run packages/react` → PASS, 24 tests.

- [ ] **Step 6: Commit** — `feat(react): text-mode GuideWidget in the shadow root`

---

### Task 5: Wire into both apps, verify in a browser, document

**Files:**
- Modify: `examples/playground/src/App.tsx` (remove the "Ask for" buttons; the widget replaces them; keep the break-the-manifest toggles and the readout)
- Delete: `examples/demo-app/src/pointto-qa-panel.tsx`; Modify: `examples/demo-app/src/App.tsx` (drop the panel import and element), `examples/demo-app/PROVENANCE.md`
- Modify: `docs/QA-MANUAL.md`, `README.md`

- [ ] **Step 1: Playground** — drop the id buttons and `PointtoQaPanel`; add a short hint "Open the widget (bottom-right) and ask: *how do I invite someone?*".

- [ ] **Step 2: Demo app** — remove the QA panel. `App.tsx` goes back to exactly: two import lines and one wrapper element. Update PROVENANCE's "What we changed".

- [ ] **Step 3: Browser verification, demo app.** Phase 1 and 2 both found bugs only here. Check:
  1. On `/products`, ask "how do I add a product" → "Add new product" lights, no navigation.
  2. On `/products`, ask "how do I add a store" → URL becomes `/stores`, "Add new store" lights after the page renders.
  3. Ask "what is the weather" → widget says it could not find it, nothing lit.
  4. Ask "add new" → widget offers products/stores chips; clicking one lights it.
  5. Escape closes the panel; the trigger remains.
  6. Host CSS (antd) does not restyle the widget.

- [ ] **Step 4: QA manual Checkpoint 3** in the established format, and README status → "Checkpoint 3 of 9 — the product works end to end in text mode."

- [ ] **Step 5: Full suite + build, commit** — `feat: text-mode end to end — widget, intent, cross-route guidance`

---

## Definition of done

- Typing a question in the widget lights the right element, navigating first when needed, in both the playground and the Refine app.
- An unrelated question lights nothing and says so.
- A genuinely ambiguous question offers choices instead of guessing.
- Escape closes; Exit is always visible; the widget is unaffected by host CSS.
- `pnpm test` green, `pnpm build` clean, Checkpoint 3 in the QA manual.

## Deliberately not in Phase 3

Voice (Phase 4). LLM-backed intent (Phase 4, via the same `IntentResolver` interface). Non-English questions — the lexical resolver is English-only; multilingual comes from the voice agent's LLM. `requires` chains and flows (Phase 8). Drift detection (Phase 6).
