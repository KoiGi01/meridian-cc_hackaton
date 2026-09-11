# Phase 2: Manifest and Resolver — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Given an element id from a hand-written manifest, find that element on a live page — and keep finding it after the host app renames the button.

**Architecture:** `resolveElement` walks an element's anchors in manifest order (most durable first) and returns the first that matches exactly one *visible* element. It never guesses: no match returns a typed failure that the caller must handle, because a wrong highlight is worse than an admitted failure. Every success reports which anchor kind won, since that telemetry is how we learn how brittle real manifests are.

**Tech Stack:** TypeScript, Vitest + jsdom, Playwright (demo app only), Refine finefoods-antd as the third-party scan target.

**Spec:** [BUILD-SPEC.md](../../../BUILD-SPEC.md) §5.2, §5.3, §9.2, §11. Decisions: [2026-09-11-pointto-decisions.md](../specs/2026-09-11-pointto-decisions.md).

## Global Constraints

Everything in the Phase 1 plan's Global Constraints still applies. Additionally:

- **Never resolve to a wrong element.** Ambiguity and absence are reported, never papered over. (§5.3)
- **Query the whole document, never a subtree.** Portals and modals render outside the React tree. (§11)
- **An element missing because it has not rendered yet is not the same as an element that is gone.** Virtualized lists and closed menus are "not yet", not "missing". (§11)
- **The demo app is third-party code.** Do not restyle it, do not refactor it, do not fix its lint. The only edits permitted are the ones that mount our provider. Its MIT notice and provenance stay intact.
- **No secrets in `guide.config.json`.** finefoods auth accepts any credentials, so use obvious dummy values.

---

### Task 1: Element visibility

**Files:**
- Create: `packages/core/src/visibility.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/visibility.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `isVisible(el: Element): boolean` — true only when the element is rendered, displayed, and has non-zero size.

Why this is its own unit: "exactly one *visible* match" is the heart of the cascade, and visibility has more edge cases than the cascade itself. A `display:none` menu item and a genuinely absent element must both count as "not resolvable right now".

- [ ] **Step 1: Write the failing test**

`packages/core/src/visibility.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isVisible } from './visibility';

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

function withRect(el: HTMLElement, rect: { width: number; height: number }) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: rect.width, bottom: rect.height,
    width: rect.width, height: rect.height, toJSON: () => '',
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
      x: 0, y: 5000, top: 5000, left: 0, right: 80, bottom: 5020,
      width: 80, height: 20, toJSON: () => '',
    } as DOMRect);
    expect(isVisible(el)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/core/src/visibility.test.ts`
Expected: FAIL — `Failed to resolve import "./visibility"`.

- [ ] **Step 3: Write the implementation**

`packages/core/src/visibility.ts`:

```ts
/**
 * True when the element is actually on the page and could be pointed at.
 *
 * Deliberately NOT a viewport check: an element scrolled below the fold is
 * visible for our purposes, because we scroll to it before lighting it. What we
 * are excluding is elements that are hidden, collapsed, or detached — a closed
 * menu's items, for instance, which are "not yet" rather than "gone".
 */
export function isVisible(el: Element): boolean {
  if (!el.isConnected) return false;

  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  if (style.display === 'none') return false;

  return true;
}
```

- [ ] **Step 4: Export it**

Add to `packages/core/src/index.ts`:

```ts
export { isVisible } from './visibility';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core`
Expected: PASS, 46 tests total.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): element visibility test for the resolver cascade"
```

---

### Task 2: Anchor matching

**Files:**
- Create: `packages/core/src/anchors.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/anchors.test.ts`

**Interfaces:**
- Consumes: `Anchor` from `./types`, `isVisible` from Task 1.
- Produces: `matchAnchor(anchor: Anchor, root?: ParentNode): HTMLElement[]` — every visible element matching that one anchor, document order.

Each anchor kind gets its own matcher. `role-name` is matched against the accessible name, approximated by `aria-label`, then `aria-labelledby`, then text content — the scanner reads real accessibility names from Playwright, so the runtime must approximate the same notion.

- [ ] **Step 1: Write the failing test**

`packages/core/src/anchors.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { matchAnchor } from './anchors';

beforeEach(() => {
  // Every element in these tests is considered laid out.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 80, bottom: 20,
    width: 80, height: 20, toJSON: () => '',
  } as DOMRect);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('matchAnchor', () => {
  it('finds by data-testid', () => {
    document.body.innerHTML = '<button data-testid="invite-btn">Invite</button>';
    const hits = matchAnchor({ kind: 'testid', value: 'invite-btn', confidence: 1 });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.textContent).toBe('Invite');
  });

  it('escapes testid values so an odd value cannot break the selector', () => {
    document.body.innerHTML = '<button data-testid="a.b:c">Invite</button>';
    expect(matchAnchor({ kind: 'testid', value: 'a.b:c', confidence: 1 })).toHaveLength(1);
  });

  it('finds by role and accessible name from aria-label', () => {
    document.body.innerHTML = '<button aria-label="Invite member">+</button>';
    const hits = matchAnchor({ kind: 'role-name', role: 'button', name: 'Invite member', confidence: 0.8 });
    expect(hits).toHaveLength(1);
  });

  it('falls back to text content for the accessible name', () => {
    document.body.innerHTML = '<button>Invite member</button>';
    const hits = matchAnchor({ kind: 'role-name', role: 'button', name: 'Invite member', confidence: 0.8 });
    expect(hits).toHaveLength(1);
  });

  it('matches the accessible name case-insensitively and ignores stray whitespace', () => {
    document.body.innerHTML = '<button>  invite   MEMBER </button>';
    const hits = matchAnchor({ kind: 'role-name', role: 'button', name: 'Invite member', confidence: 0.8 });
    expect(hits).toHaveLength(1);
  });

  it('treats an anchor element as the link role', () => {
    document.body.innerHTML = '<a href="/x">Billing</a>';
    expect(matchAnchor({ kind: 'role-name', role: 'link', name: 'Billing', confidence: 0.8 })).toHaveLength(1);
  });

  it('honours an explicit role attribute over the tag name', () => {
    document.body.innerHTML = '<div role="button">Save</div>';
    expect(matchAnchor({ kind: 'role-name', role: 'button', name: 'Save', confidence: 0.8 })).toHaveLength(1);
  });

  it('finds by exact trimmed text', () => {
    document.body.innerHTML = '<button> Invite member </button>';
    expect(matchAnchor({ kind: 'text', value: 'Invite member', confidence: 0.6 })).toHaveLength(1);
  });

  it('does not match text that merely contains the value', () => {
    document.body.innerHTML = '<button>Invite member to workspace</button>';
    expect(matchAnchor({ kind: 'text', value: 'Invite member', confidence: 0.6 })).toHaveLength(0);
  });

  it('prefers the innermost element when text is nested, not its container', () => {
    document.body.innerHTML = '<div><button><span>Invite member</span></button></div>';
    const hits = matchAnchor({ kind: 'text', value: 'Invite member', confidence: 0.6 });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.tagName).toBe('SPAN');
  });

  it('finds by css selector', () => {
    document.body.innerHTML = '<header><div></div><div><button>Go</button></div></header>';
    expect(matchAnchor({ kind: 'css', value: 'header > div:nth-child(2) > button', confidence: 0.3 })).toHaveLength(1);
  });

  it('returns nothing rather than throwing on a malformed css selector', () => {
    document.body.innerHTML = '<button>Go</button>';
    expect(matchAnchor({ kind: 'css', value: '>>> not a selector', confidence: 0.3 })).toEqual([]);
  });

  it('skips hidden matches', () => {
    document.body.innerHTML = '<button data-testid="x" style="visibility:hidden">A</button>';
    expect(matchAnchor({ kind: 'testid', value: 'x', confidence: 1 })).toEqual([]);
  });

  it('returns every match when an anchor is ambiguous', () => {
    document.body.innerHTML = '<button>Edit</button><button>Edit</button>';
    expect(matchAnchor({ kind: 'text', value: 'Edit', confidence: 0.6 })).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/core/src/anchors.test.ts`
Expected: FAIL — `Failed to resolve import "./anchors"`.

- [ ] **Step 3: Write the implementation**

`packages/core/src/anchors.ts`:

```ts
import type { Anchor } from './types';
import { isVisible } from './visibility';

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Implicit ARIA roles for the handful of tags a manifest actually anchors to. */
const IMPLICIT_ROLE: Record<string, string> = {
  BUTTON: 'button',
  A: 'link',
  INPUT: 'textbox',
  TEXTAREA: 'textbox',
  SELECT: 'combobox',
  SUMMARY: 'button',
};

function roleOf(el: Element): string | null {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit.toLowerCase();
  return IMPLICIT_ROLE[el.tagName] ?? null;
}

/**
 * Approximates the accessible name the scanner recorded from Playwright's
 * accessibility tree. Full accname computation is far larger than this; these
 * three sources cover what real dashboards actually use.
 */
function accessibleName(el: Element): string {
  const label = el.getAttribute('aria-label');
  if (label) return label;

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ');
    if (text.trim()) return text;
  }

  return el.textContent ?? '';
}

function queryAll(root: ParentNode, selector: string): HTMLElement[] {
  try {
    return [...root.querySelectorAll<HTMLElement>(selector)];
  } catch {
    // A malformed selector in a manifest must not take the whole widget down.
    return [];
  }
}

/**
 * Every currently visible element matching a single anchor, in document order.
 * Returning all matches rather than the first is deliberate: the caller needs to
 * know when an anchor is ambiguous.
 */
export function matchAnchor(anchor: Anchor, root: ParentNode = document): HTMLElement[] {
  let candidates: HTMLElement[];

  switch (anchor.kind) {
    case 'testid':
      candidates = queryAll(root, `[data-testid="${CSS.escape(anchor.value)}"]`);
      break;

    case 'role-name': {
      const want = normalize(anchor.name);
      candidates = queryAll(root, '*').filter(
        (el) => roleOf(el) === anchor.role.toLowerCase() && normalize(accessibleName(el)) === want,
      );
      break;
    }

    case 'text': {
      const want = normalize(anchor.value);
      candidates = queryAll(root, '*').filter((el) => {
        if (normalize(el.textContent ?? '') !== want) return false;
        // Prefer the innermost element carrying the text, not its wrappers.
        return ![...el.children].some((child) => normalize(child.textContent ?? '') === want);
      });
      break;
    }

    case 'css':
      candidates = queryAll(root, anchor.value);
      break;
  }

  return candidates.filter(isVisible);
}
```

- [ ] **Step 4: Export it**

Add to `packages/core/src/index.ts`:

```ts
export { matchAnchor } from './anchors';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core`
Expected: PASS, 60 tests total.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): anchor matchers for testid, role-name, text, and css"
```

---

### Task 3: The resolver cascade

**Files:**
- Create: `packages/core/src/resolve.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/resolve.test.ts`

**Interfaces:**
- Consumes: `ManifestElement`, `Manifest`, `AnchorKind` from `./types`; `matchAnchor` from Task 2.
- Produces:
  - `type ResolveOutcome = { status: 'resolved'; element: HTMLElement; anchorKind: AnchorKind; anchorIndex: number; ambiguous: boolean } | { status: 'not-found'; tried: AnchorKind[] }`
  - `resolveElement(element: ManifestElement, root?: ParentNode): ResolveOutcome`
  - `findElementById(manifest: Manifest, id: string): ManifestElement | null`

This is the reliability mechanism the whole product rests on (§5.3), and the rename-survival proof in Task 4 is what makes it demonstrable.

- [ ] **Step 1: Write the failing test**

`packages/core/src/resolve.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findElementById, resolveElement } from './resolve';
import type { Manifest, ManifestElement } from './types';

const inviteButton: ManifestElement = {
  id: 'team.invite-member',
  purpose: 'Opens the invite dialog',
  aliases: ['add someone'],
  anchors: [
    { kind: 'testid', value: 'invite-btn', confidence: 1 },
    { kind: 'role-name', role: 'button', name: 'Invite member', confidence: 0.8 },
    { kind: 'text', value: 'Invite member', confidence: 0.6 },
    { kind: 'css', value: 'main > button', confidence: 0.3 },
  ],
  destructive: false,
};

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 80, bottom: 20,
    width: 80, height: 20, toJSON: () => '',
  } as DOMRect);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('resolveElement', () => {
  it('resolves on the most durable anchor when everything is intact', () => {
    document.body.innerHTML = '<main><button data-testid="invite-btn">Invite member</button></main>';
    const out = resolveElement(inviteButton);
    expect(out.status).toBe('resolved');
    if (out.status !== 'resolved') return;
    expect(out.anchorKind).toBe('testid');
    expect(out.anchorIndex).toBe(0);
  });

  // The headline reliability claim: the host app renamed the button and did not
  // regenerate the manifest.
  it('survives the test id being removed by falling through to role and name', () => {
    document.body.innerHTML = '<main><button>Invite member</button></main>';
    const out = resolveElement(inviteButton);
    expect(out.status).toBe('resolved');
    if (out.status !== 'resolved') return;
    expect(out.anchorKind).toBe('role-name');
  });

  it('survives a renamed button by falling all the way through to the css anchor', () => {
    document.body.innerHTML = '<main><button>Add a teammate</button></main>';
    const out = resolveElement(inviteButton);
    expect(out.status).toBe('resolved');
    if (out.status !== 'resolved') return;
    expect(out.anchorKind).toBe('css');
    expect(out.element.textContent).toBe('Add a teammate');
  });

  it('reports which anchor won, so manifest brittleness can be measured', () => {
    document.body.innerHTML = '<main><button>Invite member</button></main>';
    const out = resolveElement(inviteButton);
    if (out.status !== 'resolved') throw new Error('expected resolution');
    expect(out.anchorIndex).toBe(1);
  });

  it('returns not-found rather than guessing when nothing matches', () => {
    document.body.innerHTML = '<main><section>nothing here</section></main>';
    const out = resolveElement(inviteButton);
    expect(out.status).toBe('not-found');
    if (out.status !== 'not-found') return;
    expect(out.tried).toEqual(['testid', 'role-name', 'text', 'css']);
  });

  it('skips an ambiguous anchor in favour of a lower one that is unique', () => {
    // Two buttons share the text, but only one carries the test id.
    document.body.innerHTML =
      '<main><button data-testid="invite-btn">Invite member</button><button>Invite member</button></main>';
    const out = resolveElement(inviteButton);
    if (out.status !== 'resolved') throw new Error('expected resolution');
    expect(out.anchorKind).toBe('testid');
    expect(out.ambiguous).toBe(false);
  });

  it('resolves an ambiguous anchor to the match nearest the viewport centre, and says so', () => {
    document.body.innerHTML = '<main><button>Invite member</button><button>Invite member</button></main>';
    const [far, near] = [...document.querySelectorAll('button')] as HTMLElement[];
    vi.spyOn(far, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 80, bottom: 20, width: 80, height: 20, toJSON: () => '',
    } as DOMRect);
    vi.spyOn(near, 'getBoundingClientRect').mockReturnValue({
      x: 500, y: 380, top: 380, left: 500, right: 580, bottom: 400,
      width: 80, height: 20, toJSON: () => '',
    } as DOMRect);

    const textOnly: ManifestElement = { ...inviteButton, anchors: [inviteButton.anchors[2]!] };
    const out = resolveElement(textOnly);
    if (out.status !== 'resolved') throw new Error('expected resolution');
    expect(out.element).toBe(near);
    expect(out.ambiguous).toBe(true);
  });

  it('finds elements rendered outside the react tree, such as a portalled modal', () => {
    // The portal target is a sibling of the app root, not a descendant.
    document.body.innerHTML =
      '<div id="root"><main></main></div><div id="portal"><button data-testid="invite-btn">Invite member</button></div>';
    expect(resolveElement(inviteButton).status).toBe('resolved');
  });
});

describe('findElementById', () => {
  const manifest: Manifest = {
    version: 1,
    generatedAt: '2026-09-12T00:00:00Z',
    baseUrl: 'http://localhost:3000',
    routes: [
      { path: '/a', label: 'A', elements: [inviteButton] },
      { path: '/b', label: 'B', elements: [] },
    ],
  };

  it('finds an element across every route', () => {
    expect(findElementById(manifest, 'team.invite-member')?.id).toBe('team.invite-member');
  });

  it('returns null for an unknown id rather than throwing', () => {
    expect(findElementById(manifest, 'nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/core/src/resolve.test.ts`
Expected: FAIL — `Failed to resolve import "./resolve"`.

- [ ] **Step 3: Write the implementation**

`packages/core/src/resolve.ts`:

```ts
import { matchAnchor } from './anchors';
import type { AnchorKind, Manifest, ManifestElement } from './types';

export type ResolveOutcome =
  | {
      status: 'resolved';
      element: HTMLElement;
      /** Which anchor kind won. Telemetry: this is how we learn what decays. */
      anchorKind: AnchorKind;
      /** Position in the anchor list. 0 means the most durable anchor still works. */
      anchorIndex: number;
      /** True when the winning anchor matched more than one element. */
      ambiguous: boolean;
    }
  | { status: 'not-found'; tried: AnchorKind[] };

function distanceFromViewportCentre(el: HTMLElement): number {
  const r = el.getBoundingClientRect();
  const dx = r.x + r.width / 2 - window.innerWidth / 2;
  const dy = r.y + r.height / 2 - window.innerHeight / 2;
  return Math.hypot(dx, dy);
}

/**
 * Walks the anchor cascade and returns the first anchor that finds the element.
 *
 * Anchors are ordered most-durable-first in the manifest, so falling through is
 * the mechanism that survives a host app renaming a button. A unique match at
 * any level wins immediately; an ambiguous match is only used once every
 * remaining anchor has been tried, and is flagged so the caller can report it.
 *
 * Never returns a best guess. No match is `not-found`, because a wrong
 * highlight is worse than an admitted failure. (BUILD-SPEC 5.3)
 */
export function resolveElement(element: ManifestElement, root: ParentNode = document): ResolveOutcome {
  const tried: AnchorKind[] = [];
  let fallback: { element: HTMLElement; kind: AnchorKind; index: number } | null = null;

  for (const [index, anchor] of element.anchors.entries()) {
    tried.push(anchor.kind);
    const hits = matchAnchor(anchor, root);

    if (hits.length === 1) {
      return { status: 'resolved', element: hits[0]!, anchorKind: anchor.kind, anchorIndex: index, ambiguous: false };
    }

    if (hits.length > 1 && !fallback) {
      // Keep the best candidate, but prefer a unique match from a weaker anchor.
      const nearest = [...hits].sort((a, b) => distanceFromViewportCentre(a) - distanceFromViewportCentre(b))[0]!;
      fallback = { element: nearest, kind: anchor.kind, index };
    }
  }

  if (fallback) {
    return {
      status: 'resolved',
      element: fallback.element,
      anchorKind: fallback.kind,
      anchorIndex: fallback.index,
      ambiguous: true,
    };
  }

  return { status: 'not-found', tried };
}

export function findElementById(manifest: Manifest, id: string): ManifestElement | null {
  for (const route of manifest.routes) {
    for (const element of route.elements) {
      if (element.id === id) return element;
    }
  }
  return null;
}
```

- [ ] **Step 4: Export it**

Add to `packages/core/src/index.ts`:

```ts
export { findElementById, resolveElement } from './resolve';
export type { ResolveOutcome } from './resolve';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core`
Expected: PASS, 70 tests total.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): anchor cascade resolver that survives renamed elements"
```

---

### Task 4: Wire the resolver into React and prove rename survival in a browser

**Files:**
- Modify: `packages/react/src/GuideProvider.tsx`
- Modify: `packages/react/src/index.ts`
- Modify: `examples/playground/src/App.tsx`
- Create: `examples/playground/src/manifest.ts`
- Test: `packages/react/src/GuideProvider.test.tsx` (extend)

**Interfaces:**
- Consumes: `resolveElement`, `findElementById`, `parseManifest`, `type Manifest` from `@pointto/core`.
- Produces: `GuideProvider` gains an optional `manifest` prop; `useGuide()` gains `spotlightId(id: string): ResolveOutcome` and `lastOutcome: ResolveOutcome | null`.

`spotlightId` returns the outcome rather than throwing, because Phase 4's voice agent needs the success or failure as a tool-call result: the agent must be able to say "I cannot find that on this screen" out loud.

- [ ] **Step 1: Write the failing test**

Append to `packages/react/src/GuideProvider.test.tsx`, inside the existing top-level `describe`:

```tsx
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
        <button data-testid="ask" onClick={() => spotlightId(id)}>ask</button>
        <span data-testid="status">{lastOutcome?.status ?? 'none'}</span>
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
    expect(shadow()!.querySelector('[data-pointto-cutout]')).not.toBeNull();
  });

  it('reports not-found and lights nothing when the id is not on screen', () => {
    render(
      <GuideProvider manifest={manifest}>
        <IdHarness id="team.nonexistent" />
      </GuideProvider>,
    );
    act(() => screen.getByTestId('ask').click());
    expect(screen.getByTestId('status').textContent).toBe('not-found');
    expect(shadow()!.querySelector('[data-pointto-cutout]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/react`
Expected: FAIL — `spotlightId is not a function`.

- [ ] **Step 3: Extend the provider**

In `packages/react/src/GuideProvider.tsx`, add `Manifest`, `ResolveOutcome`, `findElementById`, `resolveElement` to the `@pointto/core` import, extend `GuideContextValue` with `spotlightId` and `lastOutcome`, add a `manifest?: Manifest` prop, and implement:

```tsx
const [lastOutcome, setLastOutcome] = useState<ResolveOutcome | null>(null);

const spotlightId = useCallback(
  (id: string): ResolveOutcome => {
    const notFound: ResolveOutcome = { status: 'not-found', tried: [] };

    if (!manifest) {
      setLastOutcome(notFound);
      setTarget(null);
      return notFound;
    }

    const entry = findElementById(manifest, id);
    if (!entry) {
      setLastOutcome(notFound);
      setTarget(null);
      return notFound;
    }

    const outcome = resolveElement(entry);
    setLastOutcome(outcome);
    // On failure we clear rather than leave the previous light burning, so the
    // agent is never narrating one element while another is lit.
    setTarget(outcome.status === 'resolved' ? outcome.element : null);
    return outcome;
  },
  [manifest],
);
```

Include `spotlightId` and `lastOutcome` in the `useMemo` value and its dependency array.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/react`
Expected: PASS, 11 tests.

- [ ] **Step 5: Add a hand-written manifest to the playground**

Create `examples/playground/src/manifest.ts` exporting a `Manifest` covering the two existing playground buttons. Give `team.invite-member` four anchors in durability order (`testid` → `role-name` → `text` → `css`) so the cascade has somewhere to fall.

- [ ] **Step 6: Add rename controls to the playground**

In `examples/playground/src/App.tsx`: pass `manifest` to `GuideProvider` in `main.tsx`, replace the two direct-ref spotlight buttons with ones calling `spotlightId('team.invite-member')` and `spotlightId('billing.manage')`, and add:

- a **"Break the test id"** toggle that removes `data-testid` from the invite button
- a **"Rename the button"** toggle that changes its label from "Invite member" to "Add a teammate"
- a visible readout of `lastOutcome` showing status, which anchor kind won, and whether it was ambiguous

This readout is the demo: a tester can watch resolution degrade from `testid` to `role-name` to `css` while the light keeps landing on the right button.

- [ ] **Step 7: Verify in a real browser**

Run `pnpm --filter playground dev`, then confirm by clicking:
1. Fresh load, spotlight invite → readout says `testid`.
2. Break the test id, spotlight again → readout says `role-name`, same button still lit.
3. Also rename the button → readout says `css`, same button still lit.
4. Remove the button entirely from the page → readout says `not-found` and **nothing is lit**.

Phase 1's lesson applies: do not trust jsdom for this. Check it in the browser.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(react): resolve manifest ids and expose the outcome to callers"
```

---

### Task 5: Fork the Refine demo app

**Files:**
- Create: `examples/demo-app/**` (vendored from refinedev/refine `examples/finefoods-antd`)
- Create: `examples/demo-app/PROVENANCE.md`
- Create: `examples/demo-app/src/pointto.manifest.json`
- Modify: `examples/demo-app/src/App.tsx` (mount `GuideProvider` only)
- Modify: `docs/QA-MANUAL.md`, `README.md`

**Interfaces:**
- Consumes: `@pointto/react`.
- Produces: a running third-party admin app with our widget mounted, and a hand-written manifest for at least two of its routes.

Verified 2026-09-11: `finefoods-antd` uses `@refinedev/simple-rest` against the hosted `https://api.finefoods.refine.dev` (responding 200), and its auth provider only writes `localStorage`, accepting any credentials. No database, no local backend, no secrets.

- [ ] **Step 1: Vendor the example**

Sparse-clone `refinedev/refine` into a temp directory, copy `examples/finefoods-antd` to `examples/demo-app`, and delete the temp clone. Do not add refine as a git submodule: the hackathon repo must stand alone for judges.

- [ ] **Step 2: Record provenance**

Create `examples/demo-app/PROVENANCE.md` stating: vendored from `refinedev/refine` at `examples/finefoods-antd`, the commit SHA, the date, that upstream is MIT licensed, and that the only modification is mounting `GuideProvider`. This is both an honesty requirement and the evidence for the "it works on code we did not write" claim.

- [ ] **Step 3: Get it running untouched**

Install and run it with no modifications at all. Confirm the dashboard, orders, and products pages load real data from the hosted API. If anything fails here, stop and report before modifying a single line — a broken vendored app is a decision to revisit, not a bug to fix.

- [ ] **Step 4: Mount the provider**

Wrap the app in `GuideProvider` with the manifest. This must be the *only* change to third-party source. Do not reformat, do not fix lint, do not upgrade dependencies.

- [ ] **Step 5: Hand-write a manifest for two routes**

Create `examples/demo-app/src/pointto.manifest.json` covering `/products` and `/stores`: for each, the sidebar link and the primary create button, with a full anchor cascade per element. Read the real DOM in the browser to get accurate anchors. Validate it by importing through `parseManifest`.

This is the artifact the Phase 5 CLI must learn to generate. Hand-writing it first defines the target.

- [ ] **Step 6: Prove it on third-party code in a browser**

Spotlight each manifest element in the running demo app. Every one must light the correct control. Record which anchor kind won for each — if most resolve via `css`, the anchors were written badly and need redoing, because `css` is the most brittle and would not survive a real upstream change.

- [ ] **Step 7: Update the QA manual and README**

Add "Checkpoint 2" to `docs/QA-MANUAL.md` in the established format: how to run the demo app, the rename-survival checks, and the not-found check. Explicitly list "the agent still cannot be asked a question in words" under known-and-expected. Update the README status line.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(demo): vendor refine finefoods admin and hand-write its manifest"
```

---

## Definition of done for Phase 2

- `pnpm test` green; `pnpm build` clean.
- Deleting a `data-testid` in a running browser does not stop the light landing on the right element.
- Renaming that element's label does not stop it either.
- Removing the element entirely lights **nothing** and reports `not-found`.
- The Refine demo app runs with our widget mounted, and its manifest resolves against code we did not write.
- `docs/QA-MANUAL.md` Checkpoint 2 exists.

## Deliberately not in Phase 2

Typed questions mapping to element ids (Phase 3), voice (Phase 4), the scanner CLI that generates manifests (Phase 5), drift detection (Phase 6), `requires` prerequisite chains and multi-step flows (Phase 8).
