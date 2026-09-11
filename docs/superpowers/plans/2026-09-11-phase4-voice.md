# Phase 4: Voice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user presses a mic button in the widget, says "how do I add a store?", and the agent navigates, lights the button, and says what it is — out loud. Text typed while a session is open goes through the same agent.

**Architecture:** A minimal token server exchanges the API key for single-use tokens (§5.8; the key never reaches the browser). `pointto-core` gains a pure `buildSessionUpdate(manifest)` that turns the manifest into the agent's system prompt, keyterms, and flat-schema tool definitions, plus a `ToolGate` state machine encoding the "send `tool.result` only when `reply.done` is the latest event" rule. `pointto` gains a browser-only `VoiceSession` (WebSocket + AudioWorklet capture + scheduled PCM playback) whose tool calls dispatch to the existing `guide()`. The widget gets a mic button; text input routes through the agent when a session is open and through the lexical resolver otherwise.

**Tech Stack:** Node 20 `http` (no framework) for the server. Browser `WebSocket`, `AudioContext`, `AudioWorklet`. No new npm dependencies.

**Spec:** [BUILD-SPEC.md](../../../BUILD-SPEC.md) §5.5, §5.6, §5.8, §9.4. AssemblyAI facts verified live on 2026-09-11 and snapshotted at [assemblyai-agent-instructions-2026-09-11.md](../specs/assemblyai-agent-instructions-2026-09-11.md).

## Verified API facts (do not work from memory)

| | |
|---|---|
| WebSocket | `wss://agents.assemblyai.com/v1/ws?token=<token>` |
| Token mint | `GET https://agents.assemblyai.com/v1/token?expires_in_seconds=300` with `Authorization: Bearer <KEY>` — **Bearer is required on this product only.** Tokens are single-use. |
| First message | `session.update` immediately, before `session.ready`. Inline config: `system_prompt`, `greeting`, `input.{format, keyterms, turn_detection, language_codes, voice_focus}`, `output.{voice, format}`, `tools`. |
| Audio | PCM16 mono **24 kHz**, base64 **inside JSON**. `input.audio` carries `audio`; `reply.audio` carries `data`. Send audio only after `session.ready`. |
| Tools | Flat schema `{type:"function", name, description, parameters}`. Server sends `tool.call {call_id, name, arguments}`. Reply `tool.result {call_id, result: <JSON string>, is_error?}` **only when `reply.done` is the latest event**; drop pending results if `reply.done.status === "interrupted"`. |
| Text in | `conversation.message {role:"user", content}` then `reply.create`. |
| Speak on demand | `reply.create {instructions}` (Phase 6 will use this for corrections). |
| End | `session.end`, so the 30 s resume window is not billed. |
| Voices | `lola` = Spanish + English. Others: `anna`, `alba`, `george`, … Invented names fail silently. |
| Languages | Omit `language_codes` for automatic detection and code-switching. |
| Browser | `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false } })`. Chromium honours `AudioContext({ sampleRate: 24000 })`; Firefox/Safari do not, so resample in the worklet when `ctx.sampleRate !== 24000`. |

## Global Constraints

All earlier constraints apply. Additionally:

- **The API key exists only in `server/` and `.env`.** A test greps `packages/` for the key's env var name and fails if found.
- **`navigator.mediaDevices.getUserMedia` is called only inside `VoiceSession.start()`**, which runs only from the mic button. The existing widget test that asserts it is never called on open still passes.
- **The agent guides, it does not click.** No tool performs a user action. (§6)
- **The lexical resolver stays.** With no session, text works exactly as in Phase 3.
- **Tool results are values, never throws**, and errors are specific enough for the model to recover (name what failed and what to do next).

---

### Task 1: Token server

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/src/index.ts`, `server/src/env.ts`, `server/src/token.ts`, `server/src/events.ts`
- Test: `server/src/token.test.ts`

**Produces:** `POST /api/voice/token` → `{ token, expiresAt }`; `POST /api/events` → `204`, appends JSON lines to `server/events.log`. Both origin-checked against `ALLOWED_ORIGINS` (default: localhost dev ports) and rate-limited per IP (30/min). `GET /health` → `ok`. Port `PORT` (default 8787). Runs with `pnpm --filter pointto-server dev`.

- [ ] **Step 1: Write the failing test** for `mintToken(fetchImpl, apiKey)` — asserts it calls the right URL with `Authorization: Bearer <key>`, returns `{token, expiresAt}`, and turns a non-2xx into a thrown error carrying the status. Test with an injected fake `fetch`.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** `token.ts` (pure, injectable fetch), `env.ts` (reads `../.env` manually — no dotenv dependency — and `process.env` wins), `events.ts` (append-only JSONL), `index.ts` (http server, CORS preflight, origin allowlist, in-memory sliding-window rate limit, routes).
- [ ] **Step 4: Run tests; start the server; `curl -X POST localhost:8787/api/voice/token -H 'Origin: http://localhost:5190'` returns a token.** If AssemblyAI rejects the key, stop and report — that is a credential problem, not a code problem.
- [ ] **Step 5: Commit** — `feat(server): token minting and event collection`

---

### Task 2: Session config and tool gate (core, pure)

**Files:**
- Create: `packages/core/src/agent-session.ts`, `packages/core/src/tool-gate.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/agent-session.test.ts`, `packages/core/src/tool-gate.test.ts`

**Produces:**
- `buildSessionUpdate(manifest, opts?: { voice?, greeting?, languageCodes?, currentPath? }): SessionUpdate` — the exact `session.update` JSON. System prompt: product rules (guide, never claim to have clicked; call `highlight` for any "where/how do I" question; if the tool says not-found, say so honestly; keep replies to one or two sentences; answer in the user's language) followed by a compact catalog of every element (`id — purpose — aliases — route`). `input.keyterms`: every element's `role-name`/`text` anchor value plus route labels, deduplicated, capped at 60. `tools`: `highlight { element_id: enum of ids }`, `navigate { path: enum of routes }`, `get_current_context {}`.
- `ToolGate`: `onEvent(type: string, status?: string)`, `add(callId, resultObject)`, `drain(): Array<{ call_id, result: string }>` — returns queued results only when the last event is `reply.done`; `interrupted` clears the queue.

- [ ] **Step 1: Write failing tests.** For `buildSessionUpdate`: tools use the flat schema (no nested `function` key); `highlight.parameters.properties.element_id.enum` lists every manifest id; keyterms include "Add new product" and "Stores" and contain no duplicates; system prompt mentions each element id; `language_codes` is absent when not supplied; voice defaults to `lola`. For `ToolGate`: result added before `reply.done` is held; drained after `reply.done`; `reply.started` after `reply.done` re-holds; `interrupted` discards; `drain()` empties.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; commit** — `feat(core): agent session config from the manifest, and the tool-result gate`

---

### Task 3: VoiceSession (browser)

**Files:**
- Create: `packages/react/src/voice/VoiceSession.ts`, `packages/react/src/voice/audio.ts`, `packages/react/src/voice/worklet.ts`
- Modify: `packages/react/src/index.ts`
- Test: `packages/react/src/voice/VoiceSession.test.ts` (event handling and tool dispatch with a fake WebSocket; audio is stubbed)

**Produces:** `class VoiceSession` with `start(opts: { tokenEndpoint, sessionUpdate, onToolCall, onEvent })`, `sendText(text)`, `stop()`, and `state: 'idle' | 'connecting' | 'ready' | 'listening' | 'speaking' | 'ended' | 'error'`.

`audio.ts`: `createCapture(ctx, onPcm16Base64)` — `getUserMedia` (echo cancellation on, noise suppression off), `AudioWorkletNode` from a Blob URL built from `worklet.ts`'s source string, worklet converts Float32 → Int16 and resamples to 24 kHz when `sampleRate !== 24000`; `createPlayback(ctx)` — schedules each decoded `reply.audio` chunk at `nextStart = max(now, nextStart)` so chunks butt together, exposes `flush()` for interruptions.

`VoiceSession`: fetch token → open WS → send `session.update` → on `session.ready` start capture → forward `transcript.*`, `reply.*`, `input.speech.*` to `onEvent` → on `tool.call` run `onToolCall(name, args)` and `gate.add(...)`, then `flush` per the gate → on `reply.done` update gate and flush → `interrupted` also flushes playback. `sendText` sends `conversation.message` + `reply.create`. `stop` sends `session.end`, closes, stops tracks, closes contexts.

- [ ] **Step 1: Write failing tests** with a fake WebSocket class: `session.update` is the first frame sent; `input.audio` is never sent before `session.ready`; `tool.call` arriving before `reply.done` does not emit `tool.result` until `reply.done`; `tool.result.result` is a JSON string; `interrupted` drops it; `sendText` emits `conversation.message` then `reply.create`; `stop` emits `session.end`.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; commit** — `feat(react): VoiceSession — token, websocket, audio, gated tool results`

---

### Task 4: Mic button and agent-backed text

**Files:**
- Modify: `packages/react/src/GuideProvider.tsx` (new prop `voice?: { tokenEndpoint: string; voice?: string; greeting?: string }`; new context members `voiceState`, `startVoice()`, `stopVoice()`), `packages/react/src/GuideWidget.tsx`, `packages/react/src/widget-styles.ts`
- Test: extend `GuideProvider.test.tsx`

Tool dispatch lives in the provider, because it owns `guide` and the router:
- `highlight({element_id})` → `guide(id)` → `{ status, navigated, purpose }` or `{ error: "No element with id X on this screen. Ask the user to describe it differently." }`
- `navigate({path})` → router → `{ ok: true, path }`
- `get_current_context()` → `{ path, visible_element_ids: [...] }` from resolving every element on the current route.

Widget: mic button beside the input (🎤 / ■). Pressing starts a session; the transcript shows `transcript.user` and `transcript.agent` turns as they arrive; a status line shows Listening / Speaking. While a session is open, submitting text calls `sendText`; otherwise the Phase 3 path runs unchanged. Exit and Escape also stop the session.

- [ ] **Step 1: Failing tests:** without `voice` config the mic button is absent; with it, present; opening the widget still never calls `getUserMedia`; a fake session's `transcript.agent` event appears in the transcript.
- [ ] **Step 2–4: Implement, run, commit** — `feat(react): mic button, agent-backed text, tool dispatch`

---

### Task 5: Wire up, verify, document

- [ ] **Step 1:** Demo app and playground get `voice={{ tokenEndpoint: 'http://localhost:8787/api/voice/token' }}`. Add root scripts `dev:server`. Playground `vite.config.ts` untouched (server has CORS).
- [ ] **Step 2: Browser verification without a mic** (Playwright cannot supply real speech): start server + demo; press mic; assert `session.ready` arrives, greeting `reply.audio` frames arrive, then `sendText('how do I add a store')` produces a `tool.call highlight` → navigation to `/stores` → light → `transcript.agent` naming the button. This proves token, socket, session config, tool plumbing, and playback scheduling. **Mic capture itself is verified by the human QA in the manual, and the report must say so.**
- [ ] **Step 3:** QA manual Checkpoint 4 with real-microphone checks (English, Spanish, mid-sentence switch, barge-in, denied mic → text still works). README status. CLAUDE.md: add `dev:server` and the voice facts table pointer.
- [ ] **Step 4:** Full suite, build, commit, merge.

## Definition of done

- Server mints a real token from the real key; the key never appears under `packages/`.
- In the browser: mic press → `session.ready` → greeting heard; spoken or typed "how do I add a store" → `/stores` → lit → spoken reply.
- Denying the mic leaves text mode fully working.
- 130+ tests green; Checkpoint 4 in the QA manual.

## Deliberately not in Phase 4

`awaitInteraction` and drift correction (Phase 6). Session resume after disconnect. Deploying the server (Phase 7). Voice selection UI.
