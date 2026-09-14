# Phase 6: Drift detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While the guide is pointing at something, the user can wander. If they click the lit control the light goes out; if they leave the screen it lives on, the agent says one short sentence about where they went and where they need to be — and when they come back, the light is waiting for them without being asked again.

**Architecture:** A pure `DriftTracker` in core holds the *quest* (the element the user asked for, how many corrections have been spoken, whether what is lit right now is the goal or a waypoint on the way back). A DOM `watchGoal` in core listens for clicks on `document` (capture, passive) and watches the route and the target node; it reports `reached` / `drift` / `lost` / `replaced` as values. The provider glues them: the tracker decides, the provider lights or clears locally and immediately, and only the spoken correction goes to the agent via `reply.create { instructions }` — queued behind the same "`reply.done` is the latest event" rule as tool results. With no voice session the same correction is rendered as text in the widget. Drift is classified by **where the click took the user** (route + target), never by guessing what the clicked element does: the generated manifest has no link between a sidebar entry and its route, and a wrong correction is worse than none.

**Tech Stack:** No new dependencies. jsdom for the DOM watcher tests; the real browser (Playwright MCP against the Refine demo) for the final pass.

**Spec:** [BUILD-SPEC.md](../../../BUILD-SPEC.md) §5.6 (`awaitInteraction`, `getCurrentContext`), §5.7, §6. Design decisions approved in chat on 2026-09-14: (a) outcome-based classification; (b) after a correction the model may `highlight` a catalog element that leads back — it lights the way, it never navigates the user back; (c) the destructive confirmation gate is enforced at runtime and the scanner flags logout/sign-out so the demo has one.

## Verified API facts (re-fetched 2026-09-14 from the events reference)

| | |
|---|---|
| `reply.create` | "Ask the agent to generate a reply right now, optionally with custom `instructions`." `instructions`: "One-shot instruction the agent uses to compose this reply. Does not modify `system_prompt`." Generates a normal `reply.started … reply.done` sequence. |
| `conversation.message` | `{ role: "user" \| "system", content }`. Does not by itself make the agent reply. |
| `tool.result` | "Send this when `reply.done` is the latest event you've received." |
| Cancel | There is **no** `reply.cancel`. Nothing is documented about sending `reply.create` mid-reply, so we never do: corrections queue until `reply.done`, and are dropped if the user barged in (`status: "interrupted"`). |

## Global Constraints

All earlier constraints apply. Additionally:

- **The UI is never locked; the agent never clicks.** The watcher is passive (`{ capture: true, passive: true }`), never calls `preventDefault`, never navigates. Only `guide()` navigates, and only when the *user* asked for an element on another screen. (§6)
- **Visual feedback is local and immediate.** Light on/off never waits for the model. Only speech goes through the agent. (§5.7 latency note)
- **Correct once, briefly, without scolding. After two ignored corrections, offer to start over and stop.** `MAX_CORRECTIONS = 2`.
- **Text/voice parity.** Every correction that can be spoken can be shown as text when no session is open.
- **A wrong highlight is worse than an admitted failure.** No element-purpose heuristics; classification uses only the route and the target node.
- **Test in English only.**
- **Only `App.tsx` and our own manifest files may change in `examples/demo-app`.**

---

### Task 1: `DriftTracker` and correction text (core, pure)

**Files:**
- Create: `packages/core/src/drift.ts`
- Test: `packages/core/src/drift.test.ts`
- Modify: `packages/core/src/index.ts` (export)

**Produces:**

```ts
export const MAX_CORRECTIONS = 2;
/** A pending (unlit) quest is forgotten after this long. */
export const QUEST_TTL_MS = 120_000;

export interface Quest {
  goalId: string;
  /** Route path of the goal, '*' for global elements. */
  goalPath: string;
  corrections: number;
  /** What is lit right now. 'none' = the goal is pending, waiting for the user to come back. */
  lit: 'goal' | 'waypoint' | 'none';
  pendingSince: number | null;
}

export type LitRole = 'goal' | 'waypoint';

export class DriftTracker {
  get quest(): Quest | null;
  /**
   * Something was lit. Returns 'waypoint' when a quest is pending elsewhere and
   * the lit element is global (route '*') and the user is not on the goal's
   * screen — that is the agent lighting the way back. Anything else starts a
   * new quest.
   */
  lit(id: string, path: string, currentPath: string, now?: number): LitRole;
  /** The user clicked the lit element. */
  reached(id: string): 'goal-done' | 'waypoint-done' | 'none';
  /** The user left the screen (drift) or the target vanished (lost). */
  left(now?: number): { attempt: number; final: boolean } | null;
  /** The route changed while the goal was pending. True = relight the goal now. */
  routeChanged(path: string, now?: number): boolean;
  reset(): void;
}

export interface CorrectionContext {
  kind: 'drift' | 'lost';
  attempt: number; // 1 or 2 = correct; 3 = final offer
  goal: { id: string; purpose: string | null; screen: string | null; path: string };
  now: { path: string; screen: string | null; visibleIds: string[] };
}
/** Shown in the widget when no voice session is open. */
export function correctionText(ctx: CorrectionContext): string;
/** Sent as `reply.create.instructions` when a session is open. */
export function correctionInstruction(ctx: CorrectionContext): string;
```

- [ ] **Step 1: Write the failing tests** (`drift.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { DriftTracker, MAX_CORRECTIONS, QUEST_TTL_MS, correctionInstruction, correctionText } from './drift';

describe('DriftTracker', () => {
  it('starts a quest when an element is lit', () => {
    const t = new DriftTracker();
    expect(t.lit('products.add', '/products', '/products')).toBe('goal');
    expect(t.quest).toMatchObject({ goalId: 'products.add', goalPath: '/products', corrections: 0, lit: 'goal' });
  });

  it('clicking the goal ends the quest', () => {
    const t = new DriftTracker();
    t.lit('products.add', '/products', '/products');
    expect(t.reached('products.add')).toBe('goal-done');
    expect(t.quest).toBeNull();
  });

  it('counts corrections and gives up on the third drift', () => {
    const t = new DriftTracker();
    t.lit('products.add', '/products', '/products');
    expect(t.left()).toEqual({ attempt: 1, final: false });
    expect(t.quest?.lit).toBe('none');
    t.lit('products.add', '/products', '/products'); // relit after the user came back
    expect(t.left()).toEqual({ attempt: 2, final: false });
    t.lit('products.add', '/products', '/products');
    expect(t.left()).toEqual({ attempt: MAX_CORRECTIONS + 1, final: true });
    expect(t.quest).toBeNull();
  });

  it('lighting a global element while the quest is pending elsewhere is a waypoint, not a new quest', () => {
    const t = new DriftTracker();
    t.lit('products.add', '/products', '/products');
    t.left(); // user went to /orders
    expect(t.lit('app.products', '*', '/orders')).toBe('waypoint');
    expect(t.quest?.goalId).toBe('products.add');
    expect(t.reached('app.products')).toBe('waypoint-done');
    expect(t.quest?.goalId).toBe('products.add'); // still pending
  });

  it('lighting a global element with no pending quest is a new quest', () => {
    const t = new DriftTracker();
    expect(t.lit('app.products', '*', '/orders')).toBe('goal');
  });

  it('lighting any element while on the goal screen replaces the quest', () => {
    const t = new DriftTracker();
    t.lit('products.add', '/products', '/products');
    t.left();
    expect(t.lit('stores.add', '/stores', '/stores')).toBe('goal');
    expect(t.quest?.goalId).toBe('stores.add');
  });

  it('relights when the route returns to the goal while pending, once', () => {
    const t = new DriftTracker();
    t.lit('products.add', '/products', '/products');
    t.left();
    expect(t.routeChanged('/orders')).toBe(false);
    expect(t.routeChanged('/products')).toBe(true);
    expect(t.routeChanged('/products')).toBe(false); // provider lights it and calls lit(); no double fire
  });

  it('forgets a pending quest after the TTL', () => {
    const t = new DriftTracker();
    t.lit('products.add', '/products', '/products', 0);
    t.left(0);
    expect(t.routeChanged('/products', QUEST_TTL_MS + 1)).toBe(false);
    expect(t.quest).toBeNull();
  });

  it('a global goal never drifts by route', () => {
    const t = new DriftTracker();
    t.lit('app.products', '*', '/orders');
    expect(t.quest?.goalPath).toBe('*');
  });

  it('left() with no quest is null', () => {
    expect(new DriftTracker().left()).toBeNull();
  });
});

const ctx = {
  kind: 'drift' as const,
  attempt: 1,
  goal: { id: 'products.add-new-product', purpose: 'Opens a form to add a new product', screen: 'Products', path: '/products' },
  now: { path: '/orders', screen: 'Orders', visibleIds: ['orders.export', 'app.products'] },
};

describe('correctionText', () => {
  it('names where the user is and where the goal lives', () => {
    const s = correctionText(ctx);
    expect(s).toContain('Orders');
    expect(s).toContain('Products');
    expect(s).not.toMatch(/wrong|mistake|oops/i);
  });
  it('offers to start over on the final attempt', () => {
    expect(correctionText({ ...ctx, attempt: 3 })).toMatch(/start over|stop/i);
  });
  it('handles a lost target on the same screen', () => {
    expect(correctionText({ ...ctx, kind: 'lost', now: { ...ctx.now, path: '/products', screen: 'Products' } })).toMatch(/can.t see|no longer/i);
  });
});

describe('correctionInstruction', () => {
  it('carries the context the model needs and the tone rule', () => {
    const s = correctionInstruction(ctx);
    expect(s).toContain('/orders');
    expect(s).toContain('products.add-new-product');
    expect(s).toContain('/products');
    expect(s).toContain('orders.export');
    expect(s).toMatch(/one sentence/i);
    expect(s).toMatch(/highlight/);
    expect(s).toMatch(/do not navigate|never navigate/i);
  });
  it('on the final attempt tells the model to offer to start over and stop correcting', () => {
    const s = correctionInstruction({ ...ctx, attempt: 3 });
    expect(s).toMatch(/start over/i);
    expect(s).not.toMatch(/call highlight/i);
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run packages/core/src/drift.test.ts` — fails: module not found.
- [ ] **Step 3: Implement `drift.ts`.** The tracker is a small state machine; the texts are template strings. Guidance for the copy: the local text for drift is `You're on ${now.screen ?? now.path} now. ${goalName} is on the ${goal.screen} screen.`; for lost it is `I can't see ${goalName} any more — it was on this screen a moment ago.`; the final attempt appends `Want me to start over, or should I stop pointing?`. `goalName` is the id's last segment with dashes turned to spaces (`add new product`), in quotes; the purpose is not spoken (it is a description, not a name). The instruction is one paragraph: what happened (`The user was being pointed at "${goal.id}" (${goal.purpose}) on screen "${goal.screen}" (path ${goal.path}), and just went to path ${now.path} ("${now.screen}") instead. Visible catalog elements there: ${ids}.`), then the rule for attempts 1–2: `Say ONE short, friendly sentence naming where they are now and where the goal is. Do not scold, do not repeat the greeting. If a catalog element on the "Everywhere" screen takes them to "${goal.screen}", call highlight on it so they can see the way back. Never call navigate: the user chooses where to go.`; for attempt 3: `You have already corrected them twice. Do not correct again and do not call highlight. In one sentence, offer to start over or to stop pointing, and wait for their answer.`
- [ ] **Step 4: Run** — all pass. Export `DriftTracker`, `correctionText`, `correctionInstruction`, `MAX_CORRECTIONS`, `QUEST_TTL_MS`, types `Quest`, `LitRole`, `CorrectionContext` from `index.ts`. `pnpm vitest run packages/core` stays green, including `no-react.test.ts`.
- [ ] **Step 5: Commit** — `feat(core): DriftTracker — the quest state machine and the correction copy`

---

### Task 2: `watchGoal` — the DOM watcher (core)

**Files:**
- Create: `packages/core/src/goal-watch.ts`
- Test: `packages/core/src/goal-watch.test.ts` (`// @vitest-environment jsdom`)
- Modify: `packages/core/src/index.ts`

**Produces:**

```ts
export type GoalWatchEvent =
  | { kind: 'reached' }
  | { kind: 'drift'; path: string }
  | { kind: 'lost' }
  | { kind: 'replaced'; element: HTMLElement };

export interface GoalWatchOptions {
  target: HTMLElement;
  /** The manifest entry the target was resolved from; null for a raw spotlight (no re-resolve possible). */
  entry: ManifestElement | null;
  /** The goal's route path; '*' or null never drifts by route. */
  goalPath: string | null;
  currentPath: () => string;
  /** Clicks inside this node (our shadow host) are ignored. */
  ignoreWithin?: Element | null;
  /** How long a detached target may stay missing before it counts as lost. Default 1500. */
  graceMs?: number;
  onEvent: (e: GoalWatchEvent) => void;
}
/** Returns the stop function. After 'reached', 'drift' or 'lost' the watcher stops itself. */
export function watchGoal(opts: GoalWatchOptions): () => void;
```

Behaviour:
- `document.addEventListener('click', onClick, { capture: true, passive: true })`. The clicked node is `e.composedPath()[0]` (falls back to `e.target`) so clicks inside host shadow roots still count. If `ignoreWithin` contains it → ignore. If the path contains `target` → emit `reached`, stop. Otherwise schedule `check()` on the next animation frame (React Router changes the URL in a bubbling handler, after our capture listener; the frame is when the outcome is visible).
- `MutationObserver` on `document.body` (`childList, subtree`) → schedule `check()` (one per frame).
- `check()`: (1) if `goalPath && goalPath !== '*' && currentPath() !== goalPath` → emit `drift { path }`, stop. (2) else if `!target.isConnected`: if `entry` is null → emit `lost`, stop; else `await waitForElement(entry, { timeoutMs: graceMs })` (guard with an `inFlight` flag so overlapping checks do not double-fire) → resolved: update the local `target`, emit `replaced { element }`; not resolved: emit `lost`, stop. Re-check the route after the await, since it may have changed meanwhile.
- `stop()` removes the listener, disconnects the observer, cancels the pending frame, and makes later events no-ops.

- [ ] **Step 1: Write the failing tests.** Use `vi.stubGlobal('requestAnimationFrame', fn => { fn(0); return 1 })` and `vi.useFakeTimers()` where the grace period matters. Cases:
  - clicking the target emits `reached` and the listener is removed (a second click emits nothing);
  - clicking inside a descendant of the target emits `reached`;
  - clicking inside `ignoreWithin` emits nothing;
  - a click elsewhere, with `currentPath` now returning a different path, emits `drift` with that path;
  - a click elsewhere with the same path and the target still connected emits nothing;
  - `goalPath: '*'` never emits `drift` even if the path changes;
  - removing the target node and inserting a matching one emits `replaced` with the new node (needs `entry` with a `text` anchor and `document.body` mutation; flush the observer with `await Promise.resolve()` + a macrotask);
  - removing the target with no replacement emits `lost` after `graceMs`;
  - `stop()` before the click prevents any event.
- [ ] **Step 2: Run** — fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — passes. `pnpm vitest run packages/core` green.
- [ ] **Step 5: Commit** — `feat(core): watchGoal — clicks, route, and the target node, reported as values`

---

### Task 3: Agent config — `await_interaction`, `confirmed`, correction rules; `ToolGate.idle` (core, pure)

**Files:**
- Modify: `packages/core/src/agent-session.ts`, `packages/core/src/tool-gate.ts`
- Test: `packages/core/src/agent-session.test.ts`, `packages/core/src/tool-gate.test.ts`

**Produces:**
- Tool `await_interaction { element_id (enum ids, required), timeout_ms (integer, optional) }`. Description: `Only for multi-step guidance. Waits until the user clicks the control you highlighted, then returns, so you can guide the next step. Do not call it for a single "where is" question.`
- `highlight.parameters.properties.confirmed: { type: 'boolean', description: 'Pass true only after the user explicitly confirmed a DESTRUCTIVE action.' }` (not required).
- Prompt rules replaced/added: `- Elements marked DESTRUCTIVE: ask the user to confirm first. Only after they say yes, call highlight with confirmed: true.` and `- Sometimes you will receive an instruction that the user wandered away from what you pointed at. Follow it: one short friendly sentence, never scold, never navigate for them.`
- `ToolGate.idle: boolean` — true when `reply.done` is the latest event.

- [ ] **Step 1: Write the failing tests.** In `agent-session.test.ts`: tools include `await_interaction` with `element_id.enum` equal to every id; `highlight` has an optional `confirmed` boolean and `required` is still `['element_id']`; the prompt mentions `confirmed: true` and `wandered`. In `tool-gate.test.ts`: `idle` is false initially, true after `reply.done`, false after `reply.started` and after `input.speech.started`.
- [ ] **Step 2: Run** — fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — `pnpm vitest run packages/core` green.
- [ ] **Step 5: Commit** — `feat(core): await_interaction tool, confirmed flag, and the correction rule in the prompt`

---

### Task 4: `VoiceSession.say(instructions)` (react)

**Files:**
- Modify: `packages/react/src/voice/VoiceSession.ts`
- Test: `packages/react/src/voice/VoiceSession.test.ts`

**Produces:** `say(instructions: string): void` — sends `{ type: 'reply.create', instructions }` immediately if the gate is idle, otherwise queues it and sends it right after the next `reply.done` (after any tool results). A `reply.done` with `status: 'interrupted'` drops queued instructions. `sendText` is unchanged.

- [ ] **Step 1: Write the failing tests** using the existing `FakeSocket`: after `session.ready` + a `reply.done`, `say('x')` sends `reply.create` with `instructions: 'x'` immediately; after `reply.started` (no `reply.done` yet) it is held and sent when `reply.done` arrives, after the queued `tool.result` frames; `reply.done { status: 'interrupted' }` drops it.
- [ ] **Step 2: Run** — fails.
- [ ] **Step 3: Implement** with a `private pendingInstructions: string[]`, flushed in `flushTools()` (rename to `flushPending()`), using `this.gate.idle`.
- [ ] **Step 4: Run** — `pnpm vitest run packages/react/src/voice` green.
- [ ] **Step 5: Commit** — `feat(voice): say() — speak on demand, queued until the agent is idle`

---

### Task 5: Tool runner extraction, destructive gate, `await_interaction` (react)

**Files:**
- Create: `packages/react/src/tools.ts`, `packages/react/src/tools.test.ts` (`// @vitest-environment jsdom`)
- Modify: `packages/react/src/GuideProvider.tsx` (replace the inline `runTool` with `createToolRunner`; `GuideResult` moves to `tools.ts` and is re-exported), `packages/react/src/index.ts` if it exports `GuideResult`

**Produces:**

```ts
export type GuideResult =
  | { status: 'resolved'; elementId: string; navigated: boolean }
  | { status: 'not-found'; elementId: string; navigated: boolean }
  | { status: 'unknown-id'; elementId: string };

export interface ToolDeps {
  manifest: Manifest;
  guide: (id: string) => Promise<GuideResult>;
  router: RouterAdapter;
  /** Resolves with the id when the user clicks it; rejects with a specific message on timeout or when the user went elsewhere. */
  awaitInteraction: (id: string, timeoutMs: number) => Promise<void>;
  /** Called before `navigate` so the provider can end the current quest. */
  onNavigate?: () => void;
}
export const DEFAULT_AWAIT_MS = 30_000;
export const MAX_AWAIT_MS = 120_000;
export function createToolRunner(deps: ToolDeps): (name: string, args: Record<string, unknown>) => Promise<unknown>;
```

Behaviour is the existing `runTool` plus: `highlight` on an entry with `destructive: true` and `args.confirmed !== true` throws `Error('"<id>" is a destructive action: <purpose>. Ask the user to confirm they really want it; only after they say yes, call highlight again with confirmed: true.')`; `await_interaction` validates the id, clamps `timeout_ms` to `[1000, MAX_AWAIT_MS]` (default `DEFAULT_AWAIT_MS`), awaits `deps.awaitInteraction`, returns `{ status: 'clicked', element_id }`, and lets rejections propagate as the error message; `navigate` calls `deps.onNavigate?.()` first.

- [ ] **Step 1: Write the failing tests** with a two-route manifest (one element `destructive: true`), a fake router, a `guide` spy, and an `awaitInteraction` spy: `highlight` returns `{ status: 'highlighted', navigated, purpose }` on success; `highlight` on the destructive id without `confirmed` throws a message containing `confirmed: true` and does **not** call `guide`; with `confirmed: true` it calls `guide`; `await_interaction` with an unknown id throws; with a known id calls `awaitInteraction(id, 30000)` by default and returns `{ status: 'clicked' }`; `timeout_ms: 999999` is clamped to `120000`; a rejection surfaces as a thrown error with the same message; `navigate` to an unknown path throws; `get_current_context` returns `visible_element_ids` for elements present in the jsdom body; unknown tool throws.
- [ ] **Step 2: Run** — fails.
- [ ] **Step 3: Implement** `tools.ts`; in the provider replace `runTool` with `useMemo(() => createToolRunner({...}))` — the `awaitInteraction` and `onNavigate` deps are wired in Task 6; for now pass `awaitInteraction: () => Promise.reject(new Error('not available'))`.
- [ ] **Step 4: Run** — `pnpm test` green (provider tests untouched).
- [ ] **Step 5: Commit** — `refactor(react): tool dispatch in its own module; destructive gate; await_interaction`

---

### Task 6: Provider wiring — quest, watcher, corrections, relight (react)

**Files:**
- Modify: `packages/react/src/GuideProvider.tsx`
- Test: `packages/react/src/GuideProvider.test.tsx` (new `describe('drift')`)

**Produces** (additions to `GuideContextValue`):
```ts
/** Confirms a destructive element the user has said yes to (text mode). */
confirmGuide: (id: string) => Promise<GuideResult>;
```
`AskResult` gains `| { status: 'needs-confirmation'; match: IntentMatch }`.
Agent-bus events (through `onAgentEvent`) emitted by the provider itself:
- `{ type: 'drift', kind: 'reached', elementId }`
- `{ type: 'drift', kind: 'drift' | 'lost', elementId, attempt, final, text, spoken }` — `spoken: true` when a session was live and `say()` was used (the widget then relies on `transcript.agent`), `false` when the widget must render `text`.
- `{ type: 'drift', kind: 'relit', elementId }` — the user came back and the goal was re-lit silently.

Wiring:
- `trackerRef = useRef(new DriftTracker())`; `litRef` (the `ManifestElement` lit) already exists as `litEntryRef`; add `routeOf(entry)` helper (`manifest.routes.find(r => r.elements.includes(entry))?.path ?? null`).
- The existing "re-resolve when detached" effect is **replaced** by one `useEffect` keyed on `[target, request]` that calls `watchGoal({ target, entry: litEntryRef.current, goalPath: routeOf(entry), currentPath: () => routerRef.current.currentPath(), ignoreWithin: shadowHost, onEvent })`. Handler:
  - `replaced` → `setTarget(e.element)`.
  - `reached` → `setTarget(null)`; `const r = tracker.reached(id)`; resolve a pending `await_interaction` promise for that id; emit `reached`. If `r === 'waypoint-done'`, nothing else: the route check below re-lights the goal when the screen changes.
  - `drift` / `lost` → `setTarget(null)`; `const d = tracker.left()`; if `d` is null (raw spotlight, no quest) stop here. Reject a pending `await_interaction` (`The user went to ${path} instead of clicking "${id}".`). Build `CorrectionContext` (`goal` from the manifest entry + its route label; `now` from `routerRef.current.currentPath()`, the matching route's label, and the ids of that route's elements plus the `*` route's that resolve right now — the same computation as `get_current_context`; factor it into `currentContext()` and reuse it in `tools.ts` via a dep). If `sessionRef.current` is live → `session.say(correctionInstruction(ctx))`, `spoken = true`; else `spoken = false`. Emit the `drift` event with `correctionText(ctx)`.
- **Pending quest route watch:** a second effect, active while `tracker.quest?.lit === 'none'` — simplest: a `MutationObserver` on `document.body` plus a `popstate` listener, both calling `checkPending()`, which does `if (tracker.routeChanged(currentPath())) void guide(goalId, { silent: true })`. Store the quest-pending flag in state (`const [pending, setPending] = useState<string | null>(null)`) so the effect can key on it.
- `guide(id)` gains an internal second parameter `{ silent?: boolean }` (not on the public type — use an inner `guideInternal`). Before navigating: `tracker` is **not** reset (the quest survives the agent's own navigation), but the watcher is (light off → effect cleanup). After a successful resolve: `const role = tracker.lit(id, routeOf(entry), currentPath())`; if `silent` emit `relit`. `ask()` first calls `tracker.reset()` (a new question is a new quest) then, if the best match's entry is `destructive`, returns `{ status: 'needs-confirmation', match }` without lighting. `confirmGuide(id)` = `guideInternal(id)` with no gate. `clear()` and `stopVoice()` (exit) call `tracker.reset()` and reject any pending `await_interaction` (`The guide was closed.`). `onNavigate` (the `navigate` tool) calls `tracker.reset()`.
- `awaitInteraction(id, ms)` dep for the tool runner: stores `{ id, resolve, reject, timer }` in `pendingAwaitRef` (one at a time; a new call rejects the previous with `Superseded by a new await_interaction.`); `reached` with a matching id resolves; timeout rejects with `The user has not clicked "${id}" after ${ms} ms.`.

- [ ] **Step 1: Write the failing tests** (`describe('drift')`, reuse `twoRouteManifest`, `makeRouter`, and a harness exposing `guide`, `ask`, `confirmGuide`, `onAgentEvent`, plus a `[data-pointto-root]` lookup for the shadow host). With `requestAnimationFrame` stubbed to run synchronously and the MutationObserver flushed as in the existing re-resolve test:
  - **reached:** guide `team.invite-member`, click the `invite-btn` → cutout gone, event `{ kind: 'reached' }`.
  - **drift, text mode:** guide `stores.create` (router navigates to `/stores`; render the `Add new store` button when the router path is `/stores`), then simulate the user leaving: `router.adapter.navigate('/')` via a host button click on `document.body` (a click outside the target followed by the path change) → cutout gone, `drift` event with `kind: 'drift'`, `attempt: 1`, `spoken: false`, `text` containing `Home` and `Stores`.
  - **relight:** continue — set the path back to `/stores`, re-render so the `Add new store` button is in the DOM, dispatch `popstate` → cutout back, `relit` event, no correction.
  - **give up:** drift three times → third event `final: true`, afterwards leaving again emits nothing.
  - **new question resets:** after one drift, `ask('invite someone')` → next drift has `attempt: 1`.
  - **destructive:** manifest with `destructive: true` on `team.invite-member` → `ask('invite someone')` returns `needs-confirmation` and nothing is lit; `confirmGuide('team.invite-member')` lights it.
  - **await_interaction:** through the tool runner (`createToolRunner` is internal; expose the runner on the context as `runTool` **only** if needed for the test — prefer driving `startVoice` with a mocked `VoiceSession`: `vi.mock('./voice/VoiceSession', …)` capturing `onToolCall`). Call `onToolCall('await_interaction', { element_id: 'team.invite-member' })`, click the button → resolves `{ status: 'clicked' }`; call it again and drift → rejects with a message containing `instead of clicking`.
  - **spoken when live:** with the mocked `VoiceSession` exposing a `say` spy and `state: 'listening'`, a drift calls `say` with a string containing `/` (the path) and the event has `spoken: true`.
- [ ] **Step 2: Run** — fails.
- [ ] **Step 3: Implement.** Keep the provider readable: the drift handler lives in a `useDriftHandler`-style block with a comment that explains the quest/waypoint rule in one paragraph (why lighting a sidebar link after a drift does not start a new quest).
- [ ] **Step 4: Run** — `pnpm test` green, including the old re-resolve regression (now served by `watchGoal`'s `replaced`).
- [ ] **Step 5: Commit** — `feat(react): drift detection — reached, drift, lost, relight; corrections spoken or shown`

---

### Task 7: Widget — corrections as text, the confirmation choice

**Files:**
- Modify: `packages/react/src/GuideWidget.tsx`, `packages/react/src/widget-styles.ts` (only if a new class is needed)
- Test: `packages/react/src/GuideProvider.test.tsx` (`describe('GuideWidget')`)

**Produces:**
- `drift` events with `spoken: false` and `kind` `drift`/`lost` → an agent turn with `text`; if the panel is collapsed, also a caption.
- `ask()` → `needs-confirmation` → an agent turn `That one is marked as destructive (${purpose}). Do you want me to show it anyway?` with two buttons `Yes, show me` (calls `confirmGuide(id)` and then replies with the purpose like `choose()`) and `No` (replies `Okay, I'll leave it.`). Implement as `Turn.confirm?: IntentMatch` next to the existing `choices`.

- [ ] **Step 1: Write the failing tests:** a text-mode drift renders the correction text in the transcript; a destructive question renders the two buttons and nothing is lit; `Yes, show me` lights it; `No` lights nothing.
- [ ] **Step 2: Run** — fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — `pnpm test` green.
- [ ] **Step 5: Commit** — `feat(widget): corrections in text mode; confirm before a destructive element`

---

### Task 8: Scanner flags sign-out as destructive; demo manifest

**Files:**
- Modify: `packages/cli/src/assemble.ts:113`, `packages/cli/src/assemble.test.ts` (create if absent — check `ids.test.ts` for the style), `examples/demo-app/src/pointto.generated.manifest.json` (`app.logout.destructive: true`)

- [ ] **Step 1: Failing test:** an element named `Logout` / `Sign out` / `Cerrar sesión` assembles with `destructive: true`; `Export` does not.
- [ ] **Step 2: Run** — fails.
- [ ] **Step 3: Implement:** regex becomes `/\b(delete|remove|destroy|erase|log ?out|sign ?out|eliminar|borrar|cerrar sesi[oó]n)\b/i`. Set `app.logout.destructive` to `true` in the generated manifest by hand — it is exactly what the widened scanner produces, and a full Gemini rescan takes ten minutes for no other change. Say so in the commit body.
- [ ] **Step 4: Run** — `pnpm test` green; `pnpm build` clean.
- [ ] **Step 5: Commit** — `feat(cli): sign-out counts as destructive; demo manifest gets its confirmation gate`

---

### Task 9: Real-browser verification, QA-MANUAL Checkpoint 6, docs

**Files:**
- Modify: `docs/QA-MANUAL.md` (append "Checkpoint 6 — It notices when you wander"), `README.md` (Status), `docs/HANDOFF.md`, `CLAUDE.md` (drift modules in "How the pieces fit"; the quest/waypoint rule under "Things learned the hard way" if anything bit)

- [ ] **Step 1: Start** `pnpm dev:server` and `pnpm --filter finefoods-antd dev:pointto` (predev builds). Open `http://localhost:5190` with the Playwright MCP.
- [ ] **Step 2: Voice path, no mic** (the MCP browser has no microphone; `sendText` through the live agent exercises everything but the mic): open the widget, press the mic button (session opens; mic unavailable is fine), type `where do I add a product` → the light lands on **Add new product** on `/products`. Click **Orders** in the sidebar → light off immediately; within ~2 s the transcript shows the agent's one-sentence correction (and, if the model chose to, **Products** in the sidebar is lit). Click **Products** → the light is on **Add new product** again with nothing spoken. Click **Add new product** → light off, silence. Record which of these happened.
- [ ] **Step 3: Give-up:** ask again, drift three times (Orders, Customers, Couriers) → two corrections, then the offer, then nothing on a fourth wander.
- [ ] **Step 4: Text mode:** exit the session (mic off), ask the same in text → drift → the templated correction appears in the panel; come back → relit.
- [ ] **Step 5: Destructive:** type `log me out` (text mode) → the confirmation turn with two buttons; `No` lights nothing; ask again, `Yes, show me` lights **Logout**. With a session open: the agent asks for confirmation before lighting it.
- [ ] **Step 6: Lost:** ask for **Add new product**, click it (reached, light off) — then ask for it again while the create drawer is open, close the drawer with its X → if the button was covered/removed, `lost` fires; if the button stays in the DOM, note that `lost` was not reachable in this app and rely on the unit test.
- [ ] **Step 7: Fix whatever the browser disagrees with** (jsdom lied five times before), with a regression test for each. Screenshots into `docs/img/` for the QA manual.
- [ ] **Step 8: Write Checkpoint 6** for a tester who has not read the spec: what to click, what to see, what "wrong" looks like. Update README status (6 of 9), test count, HANDOFF (state, what the browser pass showed, next: Phase 7), CLAUDE.md.
- [ ] **Step 9: Commit** — `docs: checkpoint 6 — drift detection verified in the browser`

---

### Task 10: Merge

- [ ] `pnpm test` and `pnpm build` green on the branch; `git status` clean; `.env` untouched.
- [ ] `git checkout main && git merge --no-ff phase-6-drift -m "Merge phase 6: drift detection" && git push origin main`.

## Self-review

- **§5.7 coverage:** click listening (Task 2); reached / stay / lost / drift outcomes (Tasks 1, 2, 6); silent adaptation on the way back = waypoint + relight (Tasks 1, 6); spoken correction naming where they went and where to be (Task 1 copy, Task 4 channel, Task 6 wiring); unknown click → re-orient before speaking = `now.visibleIds` in the instruction (Task 1, 6); tone rule + give-up after two (Task 1); local visual feedback, model only for speech (Task 6). **§5.6** `awaitInteraction` (Tasks 3, 5, 6). **§6** destructive gate (Tasks 3, 5, 6, 7, 8); never locks, never clicks (constraints). **Parity** (Tasks 6, 7).
- **Naming:** `DriftTracker.lit/reached/left/routeChanged/reset`, `watchGoal`, `correctionText`, `correctionInstruction`, `VoiceSession.say`, `createToolRunner`, `confirmGuide`, event `type: 'drift'` with `kind` — used consistently above.
