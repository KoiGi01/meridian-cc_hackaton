# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Orientation

Read [BUILD-SPEC.md](BUILD-SPEC.md) before touching code — it is the design document and the build order (§9). [docs/superpowers/specs/2026-09-11-pointto-decisions.md](docs/superpowers/specs/2026-09-11-pointto-decisions.md) closes its open questions. Each phase has a plan in `docs/superpowers/plans/`. Progress is tracked in the "Status" section of [README.md](README.md) and in [docs/QA-MANUAL.md](docs/QA-MANUAL.md), which gets a new checkpoint section every time a phase lands.

The planning doc [proyecto-guia-de-voz.md](proyecto-guia-de-voz.md) is in Spanish and the user works in Spanish; match that language for product discussion unless asked otherwise.

Public repo: https://github.com/KoiGi01/meridian-cc_hackaton — MIT, hackathon rule. Deadline 30 Sep 2026 09:00 Mérida; 29 Sep is the last full day. Commit history is judged: one branch per phase, merged into `main` with `--no-ff`, one commit per task, never squash.

## Commands

```bash
pnpm install
pnpm test                                 # vitest, all packages
pnpm vitest run packages/core             # one package
pnpm vitest run packages/core/src/resolve.test.ts   # one file
pnpm build                                # tsup, ESM + CJS + d.ts for packages/*
pnpm --filter playground dev              # dev harness, http://localhost:5173
pnpm --filter finefoods-antd dev:pointto  # vendored Refine demo, http://localhost:5190
pnpm dev:server                           # token server, http://localhost:8787 — reads ASSEMBLYAI_API_KEY from .env
```

Use `dev:pointto`, never the demo app's own `dev` — `refine dev` hangs on Windows. `dev:pointto` has a `predev` hook that builds the packages first, because the demo app consumes `dist/` and `dist/` is gitignored.

## Layout

```
packages/core     manifest types + validator, geometry, rect tracking, resolver. NO React — enforced by no-react.test.ts.
packages/react    published as `pointto`. GuideProvider / useGuide, GuideWidget, SpotlightOverlay, voice/VoiceSession.
server/           token minting + event log. The ONLY place the AssemblyAI key is used. Node 22+ type-stripping, no deps.
packages/cli      published as `pointto-cli`. Playwright scanner + labeler. Node-only; the only package allowed to hold Playwright or an LLM key.
examples/playground   our own harness. Aliases pointto-* to source, so no build needed.
examples/demo-app     THIRD-PARTY CODE (Refine finefoods-antd). See its PROVENANCE.md before editing anything.
docs/             QA manual, specs, plans, screenshots.
```

## How the pieces fit

`GuideProvider` owns one `target: HTMLElement | null`. `spotlightId(id)` looks the id up in the manifest, runs `resolveElement` from core, sets the target, and returns a `ResolveOutcome` — a value, never a throw, because the voice agent will call this as a tool and must be able to say "I can't find that" out loud. `SpotlightOverlay` scrolls the target into view, tracks its rect via `observeRect`, computes a cutout, and renders a single fixed `div` whose 9999px `box-shadow` is the dim. The overlay is `pointer-events: none`; the host UI is never blocked.

`resolveElement` walks an element's anchors most-durable-first (`testid` → `role-name` → `text` → `css`) and takes the first that matches exactly one visible element. Unique-from-weak beats ambiguous-from-strong. No match returns `not-found` — a wrong highlight is worse than an admitted failure. The outcome reports which anchor won; that is the telemetry for manifest brittleness.

## Voice (AssemblyAI Voice Agent API)

Facts verified live 2026-09-11 and snapshotted in `docs/superpowers/specs/assemblyai-agent-instructions-2026-09-11.md`; the table in `docs/superpowers/plans/2026-09-11-phase4-voice.md` is the quick reference. Re-fetch `https://www.assemblyai.com/docs/agent-instructions.md` before changing anything in `voice/` or `agent-session.ts`.

`buildSessionUpdate(manifest)` in core produces the exact `session.update` JSON (system prompt with the element catalog, keyterms, flat-schema tools). `ToolGate` enforces "send `tool.result` only when `reply.done` is the latest event". `VoiceSession` in react does token → socket → mic-after-ready → audio both ways. The provider owns tool dispatch (`highlight` → `guide()`).

Two things found the hard way against the live API: (1) typed text must ride in `reply.create.instructions`, not just `conversation.message` — a bare `reply.create` replied as if nothing was asked; (2) the prompt must make `highlight` the unambiguous first action, or the model hedges with `get_current_context` and loses the thread.

**Test in English only.** The user asked for this; multilingual stays in the product but is not exercised.

## Scanner (pointto-cli)

`scan --config guide.config.json [--no-llm] [--headed]`. Pipeline: `config.ts` (validates, resolves `env:` values) → `scan.ts` (Playwright; `page.ariaSnapshot({ mode: 'ai' })` — `page.accessibility` no longer exists in 1.63; per ref, `locator('aria-ref=…').evaluate(collect)` gathers anchors the way the RUNTIME computes names) → `aria.ts` (parses the YAML; refs are `e12` on the first page and `f1e12` after any navigation) → `assemble.ts` (hoists elements present on every route into a shared `"*"` route that `guide()` never navigates for; drops pure-number/symbol names; validates with `parseManifest`) → `labeler.ts` (`OpenAICompatibleLabeler` with retries on 429/5xx, per-route fallback to skeleton). Gemini model names go stale: `gemini-2.5-flash` was rejected on 2026-09-11; `gemini-3.6-flash` works. A labeled scan of the demo takes ~10 min on the free tier.

## Things learned the hard way

- **jsdom lies about layout.** Two real bugs passed the unit suite and only showed in a browser: a below-the-fold target rendered nothing (viewport clamp → zero cutout), and re-requesting an already-lit element was a silent no-op (effect keyed on target identity; React reuses the node). Both have regression tests now, but the rule stands: after any change to overlay or resolver behaviour, drive it in a real browser before calling it done.
- **Real apps have no `data-testid`.** The Refine demo has zero. Everything resolves via `role-name`. The scanner (Phase 5) must not assume test ids exist.
- **The demo app is on React 19; the playground and our devDeps are on 18.** Our peer range is `>=18`. Keep it that way — it is a live check that the library is not secretly 18-only.
- **Vendored from a release tag, not `main`.** Refine's `main` pins examples to unpublished workspace versions and will not install. Re-vendoring must use a `@refinedev/core@x.y.z` tag.
- **Only `App.tsx` may change in `examples/demo-app`.** Mounting the provider is the one permitted edit. Do not reformat, lint-fix, or upgrade it. If the widget needs the host restructured, that is a bug in the widget.
- **`vitest.config.ts` aliases `pointto-core` to source.** Otherwise a red-green cycle silently runs against the last `pnpm build`.
- **Hosts replace DOM nodes after you resolve them.** Refine re-renders its table on data load after navigation; the lit node went detached and the light vanished. The provider now watches the DOM with a MutationObserver and re-resolves the same manifest element if the target leaves the document.
- **Do not bulk-edit TypeScript with python/sed heredocs when the text has backslashes.** `` became a literal backspace byte, `
` became a real newline. Use the Edit tool for anything with escapes.

## Product rules that will look like bugs

Non-negotiable, from BUILD-SPEC §6: the UI is never locked (only `destructive: true` elements get a confirmation gate); the agent guides, it never clicks for the user; the mic is off until the widget is opened; text input has full parity with voice; the linear tour is the same engine with the intent pre-supplied, not a second code path.

## Not built yet

Phases 6–9 of BUILD-SPEC §9: drift detection (`awaitInteraction`, `reply.create` corrections), deploy + npm publish (the token server exists; it is not deployed), flows / linear tour, polish and demo video.
