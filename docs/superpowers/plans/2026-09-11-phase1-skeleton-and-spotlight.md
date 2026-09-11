# Phase 1: Skeleton and Spotlight — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dimmed viewport with exactly one element lit up, which tracks that element through scroll and resize, while every other part of the host page stays clickable.

**Architecture:** Framework-agnostic geometry and rect-tracking live in `@pointto/core` with no DOM framework dependency. `@pointto/react` wraps them in a `GuideProvider` context and renders the overlay through a React portal into a Shadow DOM root attached to `document.body`, so host-app CSS cannot reach our internals while the cutout math still uses viewport coordinates from `getBoundingClientRect()`.

**Tech Stack:** TypeScript, pnpm workspaces, tsup (ESM + CJS + d.ts), Vitest, jsdom, @testing-library/react, Vite (playground only).

**Spec:** [BUILD-SPEC.md](../../../BUILD-SPEC.md) §5.4, §5.5, §7, §9.1. Decisions: [2026-09-11-pointto-decisions.md](../specs/2026-09-11-pointto-decisions.md).

## Global Constraints

- **License:** MIT. `LICENSE` must exist at repo root. Hackathon rule, not a preference.
- **Package scope:** `@pointto/core`, `@pointto/react`, `@pointto/cli`. No other scope.
- **Node:** 24.x is installed locally; `engines.node` floor is `>=20`.
- **Package manager:** pnpm workspaces. Do not add a `package-lock.json`.
- **Builds:** tsup, emitting ESM + CJS + type declarations for every published package.
- **`@pointto/core` must not import React.** A Vue adapter must remain plausible without a rewrite. Enforced by a test in Task 1.
- **Overlay is `pointer-events: none`.** The rest of the host UI stays clickable. Never add a click-blocking layer. (§6)
- **Commit after every task.** Judges read the commit history; do not squash the phase into one commit.
- **Never spotlight a wrong element.** Where a target cannot be resolved, render nothing and report failure upward. (§5.3)
- **Respect `prefers-reduced-motion`.** No transitions when it is set.

---

### Task 1: Workspace scaffold, license, and manifest types

**Files:**
- Create: `LICENSE`, `.gitignore`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/tsup.config.ts`
- Create: `packages/core/src/types.ts`, `packages/core/src/manifest.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/manifest.test.ts`, `packages/core/src/no-react.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Manifest`, `ManifestRoute`, `ManifestElement`, `Anchor`, `AnchorKind`, `ManifestFlow` types; `parseManifest(input: unknown): Manifest`; `ManifestError extends Error` with a `path: string` property.

- [ ] **Step 1: Create the workspace files**

`pnpm-workspace.yaml`:

```yaml
packages:
  - 'packages/*'
  - 'examples/*'
  - 'server'
```

Root `package.json`:

```json
{
  "name": "pointto-monorepo",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "pnpm -r --filter \"./packages/*\" build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b --pretty false"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "tsup": "^8.3.0",
    "vitest": "^2.1.0",
    "jsdom": "^25.0.0"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    environmentMatchGlobs: [['packages/react/**', 'jsdom']],
    include: ['packages/**/*.test.{ts,tsx}'],
  },
});
```

`.gitignore`:

```
node_modules/
dist/
.env
.env.local
*.log
.DS_Store
storage-state.json
```

- [ ] **Step 2: Create the MIT LICENSE**

Write standard MIT license text at `LICENSE`, copyright line `Copyright (c) 2026 pointto contributors`. This file existing is a hackathon submission rule, not a preference.

- [ ] **Step 3: Create the core package files**

`packages/core/package.json`:

```json
{
  "name": "@pointto/core",
  "version": "0.0.1",
  "description": "Framework-agnostic resolver, manifest types, and spotlight geometry for pointto.",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist"],
  "scripts": { "build": "tsup" },
  "publishConfig": { "access": "public" }
}
```

`packages/core/tsup.config.ts`:

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
});
```

`packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 4: Write the failing manifest tests**

`packages/core/src/manifest.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ManifestError, parseManifest } from './manifest';

const valid = {
  version: 1,
  generatedAt: '2026-09-12T00:00:00Z',
  baseUrl: 'http://localhost:3000',
  routes: [
    {
      path: '/settings/team',
      label: 'Team settings',
      elements: [
        {
          id: 'team.invite-member',
          purpose: 'Opens the invite dialog',
          aliases: ['add someone'],
          anchors: [{ kind: 'testid', value: 'invite-member-btn', confidence: 1 }],
        },
      ],
    },
  ],
};

describe('parseManifest', () => {
  it('accepts a valid manifest and returns it typed', () => {
    const m = parseManifest(structuredClone(valid));
    expect(m.routes[0]!.elements[0]!.id).toBe('team.invite-member');
  });

  it('accepts a null purpose, because the labeler must be allowed to abstain', () => {
    const input = structuredClone(valid) as Record<string, any>;
    input.routes[0].elements[0].purpose = null;
    expect(parseManifest(input).routes[0]!.elements[0]!.purpose).toBeNull();
  });

  it('defaults aliases to an empty array when absent', () => {
    const input = structuredClone(valid) as Record<string, any>;
    delete input.routes[0].elements[0].aliases;
    expect(parseManifest(input).routes[0]!.elements[0]!.aliases).toEqual([]);
  });

  it('rejects an unsupported version', () => {
    const input = { ...structuredClone(valid), version: 2 };
    expect(() => parseManifest(input)).toThrowError(ManifestError);
    expect(() => parseManifest(input)).toThrowError(/version/);
  });

  it('rejects an element with no anchors, since it could never be resolved', () => {
    const input = structuredClone(valid);
    input.routes[0]!.elements[0]!.anchors = [];
    expect(() => parseManifest(input)).toThrowError(/anchors/);
  });

  it('reports the json path of the offending element', () => {
    const input = structuredClone(valid) as Record<string, any>;
    delete input.routes[0].elements[0].id;
    try {
      parseManifest(input);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as ManifestError).path).toBe('routes[0].elements[0].id');
    }
  });

  it('rejects duplicate element ids across routes', () => {
    const input = structuredClone(valid);
    input.routes.push(structuredClone(input.routes[0]!));
    expect(() => parseManifest(input)).toThrowError(/duplicate/i);
  });

  it('rejects a flow step that names an unknown element id', () => {
    const input = structuredClone(valid) as Record<string, any>;
    input.flows = [{ id: 'f', intent: 'x', steps: ['team.nope'] }];
    expect(() => parseManifest(input)).toThrowError(/team\.nope/);
  });
});
```

`packages/core/src/no-react.test.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sourceFiles(join(dir, e.name))
      : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')
        ? [join(dir, e.name)]
        : [],
  );
}

describe('@pointto/core framework independence', () => {
  it('never imports react', () => {
    const offenders = sourceFiles(import.meta.dirname).filter((f) =>
      /from ['"]react/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core`
Expected: FAIL — `Failed to resolve import "./manifest"`.

- [ ] **Step 6: Write the types**

`packages/core/src/types.ts`:

```ts
export type AnchorKind = 'testid' | 'role-name' | 'text' | 'css';

export interface TestIdAnchor { kind: 'testid'; value: string; confidence: number }
export interface RoleNameAnchor { kind: 'role-name'; role: string; name: string; confidence: number }
export interface TextAnchor { kind: 'text'; value: string; confidence: number }
export interface CssAnchor { kind: 'css'; value: string; confidence: number }

export type Anchor = TestIdAnchor | RoleNameAnchor | TextAnchor | CssAnchor;

export interface ManifestElement {
  id: string;
  /** Null when the labeler could not infer a purpose. Never invent one. */
  purpose: string | null;
  aliases: string[];
  category?: string;
  anchors: Anchor[];
  /** Element ids that must be interacted with first to reach this one. */
  requires?: string[];
  destructive?: boolean;
}

export interface ManifestRoute { path: string; label: string; elements: ManifestElement[] }
export interface ManifestFlow { id: string; intent: string; steps: string[] }

export interface Manifest {
  version: 1;
  generatedAt: string;
  baseUrl: string;
  routes: ManifestRoute[];
  flows?: ManifestFlow[];
}
```

- [ ] **Step 7: Write the validator**

`packages/core/src/manifest.ts`:

```ts
import type { Anchor, Manifest, ManifestElement, ManifestFlow, ManifestRoute } from './types';

export class ManifestError extends Error {
  constructor(message: string, readonly path: string) {
    super(`${path}: ${message}`);
    this.name = 'ManifestError';
  }
}

function obj(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new ManifestError('expected an object', path);
  }
  return v as Record<string, unknown>;
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.length === 0) throw new ManifestError('expected a non-empty string', path);
  return v;
}

function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new ManifestError('expected an array', path);
  return v;
}

function parseAnchor(v: unknown, path: string): Anchor {
  const a = obj(v, path);
  const confidence = typeof a.confidence === 'number' ? a.confidence : 0.5;
  switch (a.kind) {
    case 'testid':
      return { kind: 'testid', value: str(a.value, `${path}.value`), confidence };
    case 'role-name':
      return {
        kind: 'role-name',
        role: str(a.role, `${path}.role`),
        name: str(a.name, `${path}.name`),
        confidence,
      };
    case 'text':
      return { kind: 'text', value: str(a.value, `${path}.value`), confidence };
    case 'css':
      return { kind: 'css', value: str(a.value, `${path}.value`), confidence };
    default:
      throw new ManifestError(`unknown anchor kind ${JSON.stringify(a.kind)}`, `${path}.kind`);
  }
}

function parseElement(v: unknown, path: string): ManifestElement {
  const e = obj(v, path);
  const anchors = arr(e.anchors, `${path}.anchors`).map((a, i) => parseAnchor(a, `${path}.anchors[${i}]`));
  if (anchors.length === 0) {
    throw new ManifestError('element has no anchors, so it could never be resolved', `${path}.anchors`);
  }
  return {
    id: str(e.id, `${path}.id`),
    purpose: e.purpose === null || e.purpose === undefined ? null : str(e.purpose, `${path}.purpose`),
    aliases:
      e.aliases === undefined
        ? []
        : arr(e.aliases, `${path}.aliases`).map((a, i) => str(a, `${path}.aliases[${i}]`)),
    ...(e.category === undefined ? {} : { category: str(e.category, `${path}.category`) }),
    anchors,
    ...(e.requires === undefined
      ? {}
      : { requires: arr(e.requires, `${path}.requires`).map((r, i) => str(r, `${path}.requires[${i}]`)) }),
    destructive: e.destructive === true,
  };
}

function parseRoute(v: unknown, path: string): ManifestRoute {
  const r = obj(v, path);
  return {
    path: str(r.path, `${path}.path`),
    label: str(r.label, `${path}.label`),
    elements: arr(r.elements, `${path}.elements`).map((e, i) => parseElement(e, `${path}.elements[${i}]`)),
  };
}

export function parseManifest(input: unknown): Manifest {
  const m = obj(input, '$');
  if (m.version !== 1) {
    throw new ManifestError(`unsupported version ${String(m.version)}, expected 1`, '$.version');
  }

  const routes = arr(m.routes, 'routes').map((r, i) => parseRoute(r, `routes[${i}]`));

  const seen = new Set<string>();
  for (const [ri, route] of routes.entries()) {
    for (const [ei, el] of route.elements.entries()) {
      if (seen.has(el.id)) {
        throw new ManifestError(
          `duplicate element id ${JSON.stringify(el.id)}`,
          `routes[${ri}].elements[${ei}].id`,
        );
      }
      seen.add(el.id);
    }
  }

  let flows: ManifestFlow[] | undefined;
  if (m.flows !== undefined) {
    flows = arr(m.flows, 'flows').map((f, i) => {
      const flow = obj(f, `flows[${i}]`);
      const steps = arr(flow.steps, `flows[${i}].steps`).map((s, si) => str(s, `flows[${i}].steps[${si}]`));
      for (const [si, step] of steps.entries()) {
        if (!seen.has(step)) {
          throw new ManifestError(
            `flow step references unknown element id ${step}`,
            `flows[${i}].steps[${si}]`,
          );
        }
      }
      return {
        id: str(flow.id, `flows[${i}].id`),
        intent: str(flow.intent, `flows[${i}].intent`),
        steps,
      };
    });
  }

  return {
    version: 1,
    generatedAt: str(m.generatedAt, 'generatedAt'),
    baseUrl: str(m.baseUrl, 'baseUrl'),
    routes,
    ...(flows === undefined ? {} : { flows }),
  };
}
```

`packages/core/src/index.ts`:

```ts
export * from './types';
export { ManifestError, parseManifest } from './manifest';
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm install && pnpm vitest run packages/core`
Expected: PASS, 9 tests.

- [ ] **Step 9: Verify the build emits both formats and types**

Run: `pnpm --filter @pointto/core build && ls packages/core/dist`
Expected: `index.js`, `index.cjs`, `index.d.ts` all present.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(core): workspace scaffold, MIT license, and manifest schema validator"
```

---

### Task 2: Spotlight geometry

**Files:**
- Create: `packages/core/src/geometry.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/geometry.test.ts`

**Interfaces:**
- Consumes: nothing beyond the package from Task 1.
- Produces: `Rect` (`{ x, y, width, height }`), `Cutout` (`{ x, y, width, height, radius }`), `CutoutOptions` (`{ padding?, radius?, viewport? }`), `computeCutout(target: Rect, opts?: CutoutOptions): Cutout`, `rectsApproxEqual(a: Rect, b: Rect, epsilon?: number): boolean`.

- [ ] **Step 1: Write the failing test**

`packages/core/src/geometry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeCutout, rectsApproxEqual } from './geometry';

describe('computeCutout', () => {
  it('expands the target by the padding on every side', () => {
    const c = computeCutout({ x: 100, y: 50, width: 200, height: 40 }, { padding: 8 });
    expect(c).toMatchObject({ x: 92, y: 42, width: 216, height: 56 });
  });

  it('defaults to a small padding rather than hugging the element exactly', () => {
    const c = computeCutout({ x: 100, y: 50, width: 200, height: 40 });
    expect(c.x).toBeLessThan(100);
    expect(c.width).toBeGreaterThan(200);
  });

  it('clamps the cutout to the viewport so it never bleeds off screen', () => {
    const c = computeCutout(
      { x: 2, y: 2, width: 50, height: 50 },
      { padding: 10, viewport: { width: 800, height: 600 } },
    );
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
    // left edge moved from -8 to 0, so width shrinks by the same 8
    expect(c.width).toBe(62);
  });

  it('clamps the right and bottom edges to the viewport', () => {
    const c = computeCutout(
      { x: 750, y: 560, width: 60, height: 60 },
      { padding: 0, viewport: { width: 800, height: 600 } },
    );
    expect(c.x + c.width).toBe(800);
    expect(c.y + c.height).toBe(600);
  });

  it('shrinks the radius so it can never exceed half the smaller dimension', () => {
    const c = computeCutout({ x: 0, y: 0, width: 20, height: 10 }, { padding: 0, radius: 999 });
    expect(c.radius).toBe(5);
  });

  it('returns a zero-size cutout for a zero-size target, so nothing is lit', () => {
    const c = computeCutout({ x: 10, y: 10, width: 0, height: 0 }, { padding: 8 });
    expect(c.width).toBe(0);
    expect(c.height).toBe(0);
  });

  it('never produces negative dimensions for a target fully off screen', () => {
    const c = computeCutout({ x: -500, y: -500, width: 50, height: 50 }, { viewport: { width: 800, height: 600 } });
    expect(c.width).toBeGreaterThanOrEqual(0);
    expect(c.height).toBeGreaterThanOrEqual(0);
  });
});

describe('rectsApproxEqual', () => {
  it('treats sub-pixel jitter as equal, to avoid repaint loops on scroll', () => {
    expect(rectsApproxEqual({ x: 0, y: 0, width: 10, height: 10 }, { x: 0.2, y: 0, width: 10, height: 10 })).toBe(true);
  });

  it('treats a real move as different', () => {
    expect(rectsApproxEqual({ x: 0, y: 0, width: 10, height: 10 }, { x: 4, y: 0, width: 10, height: 10 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/core/src/geometry.test.ts`
Expected: FAIL — `Failed to resolve import "./geometry"`.

- [ ] **Step 3: Write the implementation**

`packages/core/src/geometry.ts`:

```ts
export interface Rect { x: number; y: number; width: number; height: number }
export interface Cutout { x: number; y: number; width: number; height: number; radius: number }

export interface CutoutOptions {
  /** Breathing room around the target, in css pixels. */
  padding?: number;
  /** Corner radius of the lit area, clamped to half the smaller dimension. */
  radius?: number;
  /** When supplied, the cutout is clipped to these bounds. */
  viewport?: { width: number; height: number };
}

const DEFAULT_PADDING = 6;
const DEFAULT_RADIUS = 8;

/**
 * Turns a target's viewport rect into the lit rectangle the overlay punches out.
 * A zero-size target yields a zero-size cutout: we light nothing rather than
 * light the wrong thing.
 */
export function computeCutout(target: Rect, opts: CutoutOptions = {}): Cutout {
  const { padding = DEFAULT_PADDING, radius = DEFAULT_RADIUS, viewport } = opts;

  if (target.width <= 0 || target.height <= 0) {
    return { x: target.x, y: target.y, width: 0, height: 0, radius: 0 };
  }

  let left = target.x - padding;
  let top = target.y - padding;
  let right = target.x + target.width + padding;
  let bottom = target.y + target.height + padding;

  if (viewport) {
    left = Math.min(Math.max(left, 0), viewport.width);
    top = Math.min(Math.max(top, 0), viewport.height);
    right = Math.max(Math.min(right, viewport.width), 0);
    bottom = Math.max(Math.min(bottom, viewport.height), 0);
  }

  const width = Math.max(right - left, 0);
  const height = Math.max(bottom - top, 0);

  return {
    x: left,
    y: top,
    width,
    height,
    radius: Math.max(Math.min(radius, Math.min(width, height) / 2), 0),
  };
}

export function rectsApproxEqual(a: Rect, b: Rect, epsilon = 0.5): boolean {
  return (
    Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.width - b.width) < epsilon &&
    Math.abs(a.height - b.height) < epsilon
  );
}
```

- [ ] **Step 4: Export it**

Add to `packages/core/src/index.ts`:

```ts
export * from './geometry';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core`
Expected: PASS, 18 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): spotlight cutout geometry with viewport clamping"
```

---

### Task 3: Rect tracking

**Files:**
- Create: `packages/core/src/observe-rect.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/observe-rect.test.ts`

**Interfaces:**
- Consumes: `Rect`, `rectsApproxEqual` from Task 2.
- Produces: `observeRect(el: Element, cb: (rect: Rect) => void, opts?: { epsilon?: number }): () => void` — calls `cb` immediately with the current rect, then on every change, and returns an unsubscribe function.

Why this lives in core and not react: the overlay must follow a target through scroll, resize, and layout shifts caused by the host app, and none of that is React-specific. Task 4 consumes it through a thin hook.

- [ ] **Step 1: Write the failing test**

`packages/core/src/observe-rect.test.ts`:

```ts
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
    () => ({ ...rect, top: rect.y, left: rect.x, right: rect.x + rect.width, bottom: rect.y + rect.height, toJSON: () => '' }) as DOMRect,
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/core/src/observe-rect.test.ts`
Expected: FAIL — `Failed to resolve import "./observe-rect"`.

- [ ] **Step 3: Write the implementation**

`packages/core/src/observe-rect.ts`:

```ts
import type { Rect } from './geometry';
import { rectsApproxEqual } from './geometry';

function toRect(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

/**
 * Calls `cb` with the element's viewport rect now, and again whenever it moves
 * or resizes. Scroll is listened for in the capture phase so that scrolling
 * inside any nested container is caught, not just the window.
 *
 * Returns an unsubscribe function.
 */
export function observeRect(
  el: Element,
  cb: (rect: Rect) => void,
  opts: { epsilon?: number } = {},
): () => void {
  const { epsilon = 0.5 } = opts;
  let last: Rect | null = null;
  let frame: number | null = null;
  let stopped = false;

  const emit = () => {
    frame = null;
    if (stopped) return;
    const next = toRect(el);
    if (last && rectsApproxEqual(last, next, epsilon)) return;
    last = next;
    cb(next);
  };

  const schedule = () => {
    if (stopped || frame !== null) return;
    frame = requestAnimationFrame(emit);
  };

  emit();

  // Capture phase catches scrolls inside nested scroll containers too.
  window.addEventListener('scroll', schedule, { passive: true, capture: true });
  window.addEventListener('resize', schedule, { passive: true });

  const ro = new ResizeObserver(schedule);
  ro.observe(el);
  if (el.ownerDocument.body) ro.observe(el.ownerDocument.body);

  return () => {
    stopped = true;
    if (frame !== null) cancelAnimationFrame(frame);
    window.removeEventListener('scroll', schedule, { capture: true });
    window.removeEventListener('resize', schedule);
    ro.disconnect();
  };
}
```

- [ ] **Step 4: Export it**

Add to `packages/core/src/index.ts`:

```ts
export { observeRect } from './observe-rect';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core`
Expected: PASS, 23 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): track a target element's rect through scroll and resize"
```

---

### Task 4: React provider and spotlight overlay

**Files:**
- Create: `packages/react/package.json`, `packages/react/tsconfig.json`, `packages/react/tsup.config.ts`
- Create: `packages/react/src/shadow-root.ts`, `packages/react/src/overlay-styles.ts`
- Create: `packages/react/src/SpotlightOverlay.tsx`, `packages/react/src/GuideProvider.tsx`, `packages/react/src/index.ts`
- Test: `packages/react/src/GuideProvider.test.tsx`

**Interfaces:**
- Consumes: `computeCutout`, `observeRect`, `Rect`, `Cutout` from `@pointto/core`.
- Produces:
  - `<GuideProvider options?: GuideOptions>` where `GuideOptions = { zIndex?: number; padding?: number; radius?: number; dimOpacity?: number }`
  - `useGuide(): { target: HTMLElement | null; spotlight(el: HTMLElement | null): void; clear(): void }`
  - `SpotlightOverlay` is internal; it is not exported from the package entry.

- [ ] **Step 1: Create the package files**

`packages/react/package.json`:

```json
{
  "name": "@pointto/react",
  "version": "0.0.1",
  "description": "React provider, widget, and spotlight overlay for pointto.",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist"],
  "scripts": { "build": "tsup" },
  "peerDependencies": { "react": ">=18", "react-dom": ">=18" },
  "dependencies": { "@pointto/core": "workspace:*" },
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "publishConfig": { "access": "public" }
}
```

`packages/react/tsup.config.ts`:

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ['react', 'react-dom'],
});
```

`packages/react/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "jsx": "react-jsx" },
  "include": ["src"]
}
```

- [ ] **Step 2: Write the failing test**

`packages/react/src/GuideProvider.test.tsx`:

```tsx
import { render, screen, act } from '@testing-library/react';
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

  it('throws a useful error when useGuide is called outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Harness />)).toThrowError(/GuideProvider/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run packages/react`
Expected: FAIL — `Failed to resolve import "./GuideProvider"`.

- [ ] **Step 4: Write the shadow-root helper**

`packages/react/src/shadow-root.ts`:

```ts
/**
 * Creates the detached host element that carries our shadow root. Everything we
 * render lives inside it, so the host application's stylesheets cannot reach
 * our internals and ours cannot leak into theirs.
 */
export function createShadowHost(doc: Document = document): {
  host: HTMLElement;
  shadow: ShadowRoot;
  destroy: () => void;
} {
  const host = doc.createElement('div');
  host.setAttribute('data-pointto-root', '');
  const shadow = host.attachShadow({ mode: 'open' });
  doc.body.appendChild(host);
  return { host, shadow, destroy: () => host.remove() };
}
```

- [ ] **Step 5: Write the overlay styles**

`packages/react/src/overlay-styles.ts`:

```ts
/**
 * The dim is produced by an enormous box-shadow spread on the cutout element
 * itself, rather than by a full-screen element with a hole in it. That keeps the
 * lit area genuinely untouched and means one element moves instead of four.
 */
export const OVERLAY_CSS = `
:host { all: initial; }
.cutout {
  position: fixed;
  pointer-events: none;
  box-sizing: border-box;
  transition: left 180ms ease, top 180ms ease, width 180ms ease, height 180ms ease;
}
@media (prefers-reduced-motion: reduce) {
  .cutout { transition: none; }
}
`;
```

- [ ] **Step 6: Write the overlay**

`packages/react/src/SpotlightOverlay.tsx`:

```tsx
import { computeCutout, observeRect, type Rect } from '@pointto/core';
import { useEffect, useState } from 'react';
import { OVERLAY_CSS } from './overlay-styles';

export interface SpotlightOverlayProps {
  target: HTMLElement | null;
  zIndex: number;
  padding: number;
  radius: number;
  dimOpacity: number;
}

export function SpotlightOverlay({ target, zIndex, padding, radius, dimOpacity }: SpotlightOverlayProps) {
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (!target) {
      setRect(null);
      return;
    }
    return observeRect(target, setRect);
  }, [target]);

  if (!target || !rect) return <style>{OVERLAY_CSS}</style>;

  const cutout = computeCutout(rect, {
    padding,
    radius,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  });

  // A zero-size cutout means we could not place the light. Render nothing
  // rather than dim the screen around an empty rectangle.
  if (cutout.width === 0 || cutout.height === 0) return <style>{OVERLAY_CSS}</style>;

  return (
    <>
      <style>{OVERLAY_CSS}</style>
      <div
        className="cutout"
        data-pointto-cutout=""
        style={{
          left: `${cutout.x}px`,
          top: `${cutout.y}px`,
          width: `${cutout.width}px`,
          height: `${cutout.height}px`,
          borderRadius: `${cutout.radius}px`,
          boxShadow: `0 0 0 9999px rgba(0, 0, 0, ${dimOpacity})`,
          zIndex,
          pointerEvents: 'none',
        }}
      />
    </>
  );
}
```

- [ ] **Step 7: Write the provider**

`packages/react/src/GuideProvider.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createShadowHost } from './shadow-root';
import { SpotlightOverlay } from './SpotlightOverlay';

export interface GuideOptions {
  zIndex?: number;
  padding?: number;
  radius?: number;
  dimOpacity?: number;
}

export interface GuideContextValue {
  target: HTMLElement | null;
  spotlight: (el: HTMLElement | null) => void;
  clear: () => void;
}

const GuideContext = createContext<GuideContextValue | null>(null);

export function useGuide(): GuideContextValue {
  const ctx = useContext(GuideContext);
  if (!ctx) throw new Error('useGuide must be called inside a <GuideProvider>');
  return ctx;
}

export function GuideProvider({ children, options }: { children: ReactNode; options?: GuideOptions }) {
  const { zIndex = 2147483000, padding = 6, radius = 8, dimOpacity = 0.6 } = options ?? {};
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [shadow, setShadow] = useState<ShadowRoot | null>(null);

  useEffect(() => {
    const { shadow: s, destroy } = createShadowHost();
    setShadow(s);
    return destroy;
  }, []);

  const spotlight = useCallback((el: HTMLElement | null) => setTarget(el), []);
  const clear = useCallback(() => setTarget(null), []);

  const value = useMemo<GuideContextValue>(() => ({ target, spotlight, clear }), [target, spotlight, clear]);

  return (
    <GuideContext.Provider value={value}>
      {children}
      {shadow &&
        createPortal(
          <SpotlightOverlay
            target={target}
            zIndex={zIndex}
            padding={padding}
            radius={radius}
            dimOpacity={dimOpacity}
          />,
          shadow,
        )}
    </GuideContext.Provider>
  );
}
```

`packages/react/src/index.ts`:

```ts
export { GuideProvider, useGuide } from './GuideProvider';
export type { GuideOptions, GuideContextValue } from './GuideProvider';
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm install && pnpm vitest run packages/react`
Expected: PASS, 8 tests.

- [ ] **Step 9: Verify the build**

Run: `pnpm --filter @pointto/react build && ls packages/react/dist`
Expected: `index.js`, `index.cjs`, `index.d.ts`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(react): GuideProvider and shadow-dom spotlight overlay"
```

---

### Task 5: Playground host page and QA manual

**Files:**
- Create: `examples/playground/package.json`, `examples/playground/vite.config.ts`, `examples/playground/index.html`, `examples/playground/tsconfig.json`
- Create: `examples/playground/src/main.tsx`, `examples/playground/src/App.tsx`
- Create: `docs/QA-MANUAL.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `GuideProvider`, `useGuide` from `@pointto/react`.
- Produces: a runnable page at `pnpm --filter playground dev`. No exported API.

The playground is deliberately not the Refine fork. Phase 1 proves the overlay mechanics against a page whose layout we control; the Refine fork arrives in Phase 2 with the manifest and resolver, where it actually proves something.

- [ ] **Step 1: Create the Vite app**

`examples/playground/package.json`:

```json
{
  "name": "playground",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build", "preview": "vite preview" },
  "dependencies": {
    "@pointto/react": "workspace:*",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^5.4.0"
  }
}
```

`examples/playground/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [react()], server: { port: 5173 } });
```

`examples/playground/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>pointto playground</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`examples/playground/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "noEmit": true },
  "include": ["src"]
}
```

`examples/playground/src/main.tsx`:

```tsx
import { GuideProvider } from '@pointto/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GuideProvider>
      <App />
    </GuideProvider>
  </StrictMode>,
);
```

- [ ] **Step 2: Build the host page**

The page must contain, at minimum: a target far enough down the page that scrolling is required, a second target to prove the light moves between them, and a control that proves the host UI stays clickable while dimmed.

`examples/playground/src/App.tsx`:

```tsx
import { useGuide } from '@pointto/react';
import { useRef, useState } from 'react';

const panel: React.CSSProperties = {
  border: '1px solid #d4d4d8',
  borderRadius: 12,
  padding: 24,
  margin: '48px 0',
  background: '#fff',
};

export function App() {
  const inviteRef = useRef<HTMLButtonElement>(null);
  const billingRef = useRef<HTMLButtonElement>(null);
  const { spotlight, clear } = useGuide();
  const [clicks, setClicks] = useState(0);

  return (
    <main style={{ font: '16px/1.5 system-ui, sans-serif', maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <h1>pointto playground</h1>
      <p>Phase 1 harness. No voice, no manifest — just the spotlight.</p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', position: 'sticky', top: 0, background: '#fafafa', padding: '12px 0', zIndex: 10 }}>
        <button onClick={() => spotlight(inviteRef.current)}>Spotlight “Invite member”</button>
        <button onClick={() => spotlight(billingRef.current)}>Spotlight “Billing”</button>
        <button onClick={clear}>Clear</button>
      </div>

      <section style={panel}>
        <h2>Proof the host UI stays clickable</h2>
        <p>
          This counter must still increment while the screen is dimmed. Clicked{' '}
          <strong data-testid="click-count">{clicks}</strong> times.
        </p>
        <button onClick={() => setClicks((c) => c + 1)}>Click me while dimmed</button>
      </section>

      <div style={{ height: '70vh' }} aria-hidden />

      <section style={panel}>
        <h2>Team settings</h2>
        <button ref={inviteRef} data-testid="invite-member-btn">
          Invite member
        </button>
      </section>

      <div style={{ height: '70vh' }} aria-hidden />

      <section style={panel}>
        <h2>Billing</h2>
        <button ref={billingRef} data-testid="billing-btn">
          Manage billing
        </button>
      </section>

      <div style={{ height: '40vh' }} aria-hidden />
    </main>
  );
}
```

- [ ] **Step 3: Run it and confirm by eye**

Run: `pnpm install && pnpm --filter playground dev`
Open `http://localhost:5173`. Confirm each of:
1. Clicking "Spotlight Invite member" dims the page and lights one button.
2. Scrolling keeps the light glued to the button.
3. Resizing the window keeps it glued.
4. The counter still increments while dimmed.
5. "Clear" removes the dim entirely.

- [ ] **Step 4: Write the QA manual**

Create `docs/QA-MANUAL.md` with a "How to run" preamble (`pnpm install`, `pnpm --filter playground dev`, open `http://localhost:5173`) and a "Checkpoint 1" section containing a numbered table of the five checks above, each with Steps / Expected / Pass-Fail columns, plus these failure-mode rows:

| # | Steps | Expected | Pass/Fail |
|---|---|---|---|
| 1.6 | Enable "Reduce motion" in your OS accessibility settings, reload, switch spotlights | The light jumps between targets with no sliding animation | |
| 1.7 | Spotlight a target, then scroll it fully off screen | The light shrinks against the viewport edge and never draws outside the window | |
| 1.8 | Open devtools and inspect the dimmed area | The overlay element reports `pointer-events: none` | |
| 1.9 | Inspect `<body>` in devtools | Exactly one `<div data-pointto-root>` exists, and its contents are inside a shadow root | |

Write it for a tester who has not read the build spec: say what to click, not what the code does.

- [ ] **Step 5: Write the README**

`README.md` covering: one-line description, MIT license note, the monorepo layout from §7, install and dev commands, and a "Status" section saying Phase 1 of 9 is complete with a link to the QA manual and the build spec.

- [ ] **Step 6: Run the whole suite and typecheck**

Run: `pnpm test && pnpm build`
Expected: all tests pass, all packages build.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(playground): phase 1 host page, QA manual, and README"
```

---

## Definition of done for Phase 1

- `pnpm test` green; `pnpm build` emits ESM, CJS, and `.d.ts` for both packages.
- The playground demonstrates a target that stays lit through scroll and resize, with the host UI still clickable.
- `docs/QA-MANUAL.md` Checkpoint 1 exists and a tester can follow it without reading any spec.
- `LICENSE` exists at repo root.
- At least five commits, one per task.

## Deliberately not in Phase 1

Manifest file loading, the anchor cascade resolver, the widget UI, text input, voice, the Refine fork, the token server. Each has its own phase in §9 and its own plan.
