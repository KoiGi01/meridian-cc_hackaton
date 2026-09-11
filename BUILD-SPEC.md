# BUILD SPEC: Voice-driven in-app navigation layer

> Handoff document for Claude Code. Read this fully before writing any code.
> Package name is not decided yet. It appears as `PKGNAME` throughout. Ask before choosing one.

---

## 0. Read this first

Before writing any AssemblyAI integration code, fetch and follow:

```
https://www.assemblyai.com/docs/agent-instructions.md
```

That is AssemblyAI's official integration prompt for AI coding agents. It exists specifically because model training data on their API is stale. There is also a docs MCP server and a Claude Code skill available from their docs.

**Critical model note:** as of September 2, 2026, `universal-3-pro` is deprecated and returns an error. The flagship is `universal-3.5-pro`. Any tutorial, blog post, or training-data memory referencing Universal-3 Pro is out of date. Verify every model string against live docs.

Do not guess API field names, event names, or schemas. Fetch the live docs. The key references:

- Voice Agent API overview: `/docs/voice-agents/voice-agent-api`
- Client-side tools: `/docs/voice-agents/voice-agent-api/tools/client-side-tools`
- Events reference: `/docs/voice-agents/voice-agent-api/events-reference`
- Message sequence: `/docs/voice-agents/voice-agent-api/message-sequence`
- Browser integration: `/docs/voice-agents/voice-agent-api/browser-integration`
- Inline session config: `/docs/voice-agents/voice-agent-api/session-configuration`
- Language selection: `/docs/voice-agents/voice-agent-api/language-selection`
- Transcription context and keyterms: `/docs/voice-agents/voice-agent-api/transcription-prompt`

---

## 1. What we are building

A library that developers install into their web app. It adds a widget. A user opens the widget, asks a question out loud, and the application navigates to the right screen and spotlights the exact UI element they need, while the agent explains in speech.

**One line:** the app answers questions by pointing, not by writing.

Three deliverables:

1. **`PKGNAME` (npm package)** — the runtime widget, spotlight overlay, element resolver, voice session client.
2. **`PKGNAME-cli` (npm package or bin in the same package)** — scans a target app and generates a manifest.
3. **Token server** — a minimal backend that mints ephemeral AssemblyAI tokens and receives events.

Plus a **demo app**, deployed and publicly reachable, which is what hackathon judges will actually click.

---

## 2. Hard constraints

- **Deadline:** September 30, 2026, 09:00 America/Merida. Treat September 29 end-of-day as the real cutoff.
- **License:** MIT. A `LICENSE` file must exist at repo root. This is a hackathon rule, not a preference.
- **Repo must be public.**
- **Demo must be reachable by URL.** A local-only demo scores as broken.
- **Commit history matters.** Judges look at the repo. Commit continuously, do not squash the whole project into one push.

## 3. Non-goals

Do not build these. They are roadmap slides, not code:

- Automatic route discovery / crawler. The developer supplies a route list.
- Analytics dashboard
- User accounts, billing, multi-tenancy
- Vue, Angular, Svelte support. React only.
- Agent that clicks on the user's behalf. This is a deliberate product position, not a missing feature.
- Blocking the rest of the UI during guidance. Also deliberate. See section 6.

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────┐
│ BUILD TIME (runs once, on the developer's machine)  │
│                                                     │
│  routes.json ──▶ CLI ──▶ Playwright                 │
│                            │                        │
│                            ▼                        │
│                   accessibility snapshot            │
│                            │                        │
│                            ▼                        │
│                     LLM labeling                    │
│                            │                        │
│                            ▼                        │
│                   PKGNAME.manifest.json             │
│                   (committed to the repo)           │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ RUNTIME (in the end user's browser)                 │
│                                                     │
│  <GuideProvider manifest={manifest}>                │
│         │                                           │
│         ├── Widget (mic button, transcript, cancel) │
│         ├── SpotlightOverlay                        │
│         ├── ElementResolver                         │
│         └── VoiceSession ──── WSS ──▶ AssemblyAI    │
│                   │                                 │
│                   └── token ──▶ Token server        │
└─────────────────────────────────────────────────────┘
```

### Why the accessibility tree and not the DOM

This is the decision that makes the project feasible. Do not deviate from it without raising it first.

A real dashboard's serialized DOM is hundreds of thousands of tokens: wrapper divs, utility class soup, inline styles, SVG paths. It is too large to send to an LLM, too expensive, and too slow.

Playwright's accessibility snapshot returns the same page as a small semantic tree: roles, accessible names, hierarchy. It is one to two orders of magnitude smaller and already labeled with meaning, because it is what screen readers consume.

Use `page.accessibility.snapshot()` (or the current Playwright equivalent, verify the API) as the primary source. Fall back to targeted DOM queries only to collect anchor attributes (section 5.2).

---

## 5. Component specs

### 5.1 CLI

```bash
npx PKGNAME scan --config guide.config.json
```

Config input:

```json
{
  "baseUrl": "http://localhost:3000",
  "auth": {
    "type": "form",
    "loginUrl": "/login",
    "steps": [
      { "fill": "input[name=email]", "value": "demo@example.com" },
      { "fill": "input[name=password]", "value": "env:DEMO_PASSWORD" },
      { "click": "button[type=submit]" },
      { "waitFor": "[data-app-ready]" }
    ]
  },
  "routes": [
    { "path": "/dashboard", "label": "Dashboard" },
    { "path": "/settings/team", "label": "Team settings" }
  ],
  "output": "./src/PKGNAME.manifest.json",
  "llm": { "provider": "anthropic", "model": "<pick current>" }
}
```

Steps:

1. Launch Playwright, run the auth sequence once, reuse the storage state across routes.
2. For each route: navigate, wait for network idle plus a settle delay, take an accessibility snapshot.
3. For each interactive node (button, link, textbox, checkbox, menuitem, tab), collect the anchor set defined in 5.2.
4. Batch the nodes per route and send to an LLM for labeling. Ask for strict JSON output.
5. Write the manifest. Print a summary of counts and anything that looked ambiguous.

LLM labeling prompt should ask, per element: what it does in plain language, alternative phrasings a non-expert user might say for it, and the task category it belongs to. Instruct it to return `null` rather than invent a purpose for elements it cannot infer. Unlabeled elements are fine; hallucinated ones are not.

### 5.2 Manifest schema

The anchor cascade is the core reliability mechanism. Each element stores several ways to be found, ordered by durability.

```jsonc
{
  "version": 1,
  "generatedAt": "2026-09-12T00:00:00Z",
  "baseUrl": "http://localhost:3000",
  "routes": [
    {
      "path": "/settings/team",
      "label": "Team settings",
      "elements": [
        {
          "id": "team.invite-member",
          "purpose": "Opens the dialog to invite a new person to the workspace",
          "aliases": ["add someone", "invite a user", "add a teammate", "new member"],
          "category": "team-management",
          "anchors": [
            { "kind": "testid", "value": "invite-member-btn", "confidence": 1.0 },
            { "kind": "role-name", "role": "button", "name": "Invite member", "confidence": 0.8 },
            { "kind": "text", "value": "Invite member", "confidence": 0.6 },
            { "kind": "css", "value": "header > div:nth-child(2) > button", "confidence": 0.3 }
          ],
          "requires": ["team.settings-tab"],
          "destructive": false
        }
      ]
    }
  ],
  "flows": [
    {
      "id": "invite-teammate",
      "intent": "Invite someone to the workspace",
      "steps": ["team.settings-tab", "team.invite-member", "team.invite-email-field", "team.invite-submit"]
    }
  ]
}
```

Notes:

- `id` is stable and human-editable. Developers are expected to hand-correct this file. Optimize for readability.
- `requires` lists elements that must be interacted with first to reach this one. This is what lets the agent build a path rather than just point.
- `flows` are optional pre-declared sequences. They power the linear tour mode, which is the same engine with the intent pre-supplied.
- `destructive: true` triggers a confirmation gate (section 6).

### 5.3 Element resolver

Runtime function: given an element `id`, return a live `HTMLElement` or `null`.

Try anchors in order. Return on first hit that resolves to exactly one visible element in the viewport tree. Log which anchor kind succeeded, because that telemetry is what tells us how brittle the manifest is in the wild.

Handle:
- Element exists but is scrolled out of view → scroll into view, then resolve.
- Element does not exist yet because it is behind a closed menu → check `requires`, guide to the prerequisite first.
- Multiple matches → prefer the one nearest the viewport center, but log the ambiguity.
- No match at all → the agent must say so out loud honestly. It must never spotlight the wrong element. A wrong highlight is worse than an admission of failure.

### 5.4 Spotlight overlay

Implementation: a fixed full-viewport element with a very large `box-shadow` spread and a transparent cutout positioned over the target's bounding rect. Rounded corners, animated transition between targets.

Hard requirements:

- `pointer-events: none` on the overlay. **The rest of the UI stays clickable.** See section 6.
- Re-position on scroll and resize, and on DOM mutation near the target. Use `ResizeObserver` plus a throttled scroll listener.
- Respect `prefers-reduced-motion`.
- Render inside the widget's Shadow DOM so host styles cannot break it, but the cutout math uses viewport coordinates from `getBoundingClientRect()`.
- z-index high but configurable, since host apps have their own modal stacks.

### 5.5 Widget

- Floating trigger button, position configurable.
- **Microphone is off until the user opens the widget.** Never hold an open mic in the background. This is a dealbreaker for enterprise buyers and it will be asked about.
- Shows live transcript of what the user said and what the agent is saying.
- Persistent visible "Exit" control plus `Escape` key.
- **Text input fallback with full parity.** Same intent resolution, same spotlight, no voice. This must work if the user denies mic permission or is in a noisy or open office. Ship this, do not stub it.
- Entire widget inside Shadow DOM.

### 5.6 Voice session and tools

Use the AssemblyAI Voice Agent API over WebSocket, browser-side, authenticated with an ephemeral token from our server. Never ship the API key to the client.

Pass the manifest into the agent's context. It is small enough to fit. Include the element ids, purposes, aliases and route paths. The agent's job is to map a spoken question to an element id and a path to reach it.

Register **client-side tools** (functions our code executes, not server-side HTTP tools):

| Tool | Params | Behavior |
|---|---|---|
| `navigate` | `{ path }` | Route change via the host app's router adapter |
| `highlight` | `{ elementId, note? }` | Resolve and spotlight. Returns success/failure so the agent knows whether it can claim it worked |
| `awaitInteraction` | `{ elementId, timeoutMs }` | Resolves when the user actually clicks the target |
| `getCurrentContext` | `{}` | Returns current route and which manifest elements are currently present on screen |

`getCurrentContext` matters more than it looks. It is what lets the agent recover when the app is not in the state it assumed.

Also configure: `language_codes` left on automatic multilingual detection (the API handles code-switching across six languages natively, we get localization for free), keyterms loaded from the manifest's element names so the model transcribes product-specific vocabulary correctly, and `voice_focus` on.

### 5.7 Drift detection (the differentiator)

This is the feature that separates the project from every existing tour library. Prioritize it accordingly.

While a target is spotlighted, listen for clicks anywhere in the document (capture phase, passive).

On a click that is not the target:

1. Check whether the clicked element is in the manifest.
2. If it advances toward the goal or is a reasonable alternative path, adapt silently and re-spotlight from the new state.
3. If it leads away from the goal, the agent speaks a short correction naming where the user actually went and where they need to be.
4. If it is unknown, call `getCurrentContext` and re-orient before saying anything.

Tone rule: correct once, briefly, without scolding. If the user ignores the correction twice, stop correcting and offer to start over or exit.

Latency note: the Voice Agent API runs around one second end to end. Do not round-trip trivial UI feedback through the model. Visual response to a click should be immediate and local; only the spoken correction goes through the agent.

### 5.8 Token server

Minimal. Two endpoints.

```
POST /api/voice/token
  → mints an ephemeral AssemblyAI voice agent token
  → short TTL, origin-checked, rate limited per IP
  → returns { token, expiresAt }

POST /api/events
  → accepts batched runtime events
  → { sessionId, type, elementId?, anchorKindUsed?, resolved?, ts }
  → for the hackathon: append to a log. No database.
```

No auth system, no user table, no dashboard.

---

## 6. Product decisions that are not up for negotiation

These will look like missing features. They are intentional. Do not "fix" them.

**The UI is never locked.** The overlay dims the rest of the screen but everything stays clickable. Reasons: we run inside someone else's application and must never trap a user in their own tool; users legitimately need to detour mid-task; and a guided flow where the user cannot go wrong never has to demonstrate that it understands anything. Drift detection (5.7) is only possible because drift is possible.

**The agent guides, it does not click.** No tool that performs the user's action for them. The user retains control and learns where the feature lives. This is the product's defensible position against autonomous UI agents.

**One exception, confirmation gating.** For elements marked `destructive: true`, intercept and require an explicit spoken or clicked confirmation before spotlighting as an action to take.

**The linear tour is not separate code.** It is the same engine with the intent pre-supplied from a `flows` entry. If you find yourself writing a second code path for it, stop.

---

## 7. Repo layout

```
/
├── packages/
│   ├── core/            # resolver, manifest types, intent matching (framework-agnostic)
│   ├── react/           # GuideProvider, widget, overlay
│   └── cli/             # Playwright scanner + LLM labeling
├── examples/
│   └── demo-app/        # the deployed demo
├── server/              # token + events
├── LICENSE              # MIT, required
└── README.md
```

Monorepo with pnpm workspaces. Build with `tsup`. Ship ESM and CJS, with type declarations. Keep `core` free of React so a Vue adapter is plausible later without a rewrite.

**Publish to npm for real during the hackathon.** A judge being able to `npm install` and mount it in their own app is the strongest possible evidence the thing exists. Almost nothing else in the submission field will have an installable artifact.

## 8. Demo app choice

Do not build a toy dashboard. Pick a real open source React admin app or dashboard, fork it, and run the scanner against code we did not write. That is the proof this is a framework and not a bespoke demo. Propose two or three candidates before committing.

## 9. Build order

Sequence matters. Each phase should end with something demonstrable, so we always have a submittable artifact.

1. **Skeleton and spotlight.** Monorepo, React provider, overlay rendering against a hardcoded element id. No voice, no manifest. Get the visual working first, because it is the whole demo.
2. **Manifest and resolver.** Hand-write a small manifest by hand. Build the anchor cascade. Prove resolution survives a renamed button.
3. **Text-mode intent.** Typed question in, element id out, spotlight fires. The entire product works at this point without any voice. This is the safety net.
4. **Voice session.** Swap text input for the Voice Agent API with client-side tools. Text mode stays as fallback.
5. **CLI scanner.** Playwright plus accessibility snapshot plus LLM labeling, generating what we hand-wrote in phase 2.
6. **Drift detection.** Click listening, correction, adaptation.
7. **Token server, deploy, npm publish.**
8. **Multi-step flows and the linear tour mode.**
9. **Polish, README, demo recording.**

Phase 3 is the checkpoint that matters. If voice integration goes badly, we still have a working product to submit.

## 10. Testing

- Unit: anchor cascade resolution, including deliberately broken anchors.
- E2E: Playwright script that asks a question in text mode and asserts the correct element gets spotlighted.
- Manual: rename a button in the demo app, do not regenerate the manifest, confirm the cascade still resolves via a lower-confidence anchor. Record this. It is a good thing to show in the pitch video.

## 11. Things that will bite

- Portals and modals render outside the React tree. The resolver must query the whole document, not a subtree.
- Virtualized lists mean the target may not exist in the DOM until scrolled. Handle absence as "not yet rendered", not "missing".
- Host app CSS can use `!important` and extreme z-index values. Shadow DOM protects our internals but not our stacking context.
- Route changes are framework-specific. Define a small router adapter interface and provide a React Router implementation; let the host supply their own otherwise.
- Accessibility snapshots differ between headless and headed Playwright in some cases. Scan headed if results look thin.
- Mic permission in an iframe requires explicit `allow` attributes. The demo deployment must account for this.

## 12. Open questions to raise before building

1. Package name.
2. Which LLM and provider for the CLI labeling step.
3. Which open source app to use as the demo target.
4. Whether the manifest ships in the host repo (current plan) or is fetched from our server.
