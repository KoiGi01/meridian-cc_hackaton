# Phase 5: Scanner CLI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `npx pointto-cli scan --config guide.config.json` drives the running app with Playwright, reads each route's accessibility tree, and writes a `pointto.manifest.json` shaped like the one we hand-wrote in Phase 2 — with LLM labels when a key is present, and a reviewable skeleton (`--no-llm`) when it is not.

**Architecture:** Pure, testable units around one Playwright-driving module. `ariaSnapshot({ mode: 'ai' })` (Playwright ≥1.49; `page.accessibility` no longer exists in 1.63) yields a YAML tree with `[ref=eN]` handles; `aria.ts` parses it into interactive nodes; for each ref, one in-page evaluation collects the anchor cascade (`testid` if present, `role-name`, `text`, a generated `css` path). `Labeler` is an interface with two implementations: `OpenAICompatibleLabeler` (Gemini's compat endpoint by default, strict JSON, returns `null` purpose rather than inventing) and `SkeletonLabeler` (no network). `assemble.ts` builds the manifest and validates it with `parseManifest` before writing.

**Spec:** [BUILD-SPEC.md](../../../BUILD-SPEC.md) §5.1, §5.2, §9.5, §11. Decisions §2 (Gemini via OpenAI-compatible shape, `--no-llm` mode).

## Global Constraints

- **Playwright lives only in `pointto-cli`.** Never a dependency of `pointto` or `pointto-core`.
- **Real apps have no test ids** (Phase 2 finding). The scanner must produce a usable cascade without them, and must not emit a `testid` anchor when the element has none.
- **`null` beats invented.** The labeler prompt instructs the model to return `null` for purpose when it cannot infer one; the assembler keeps such elements with `purpose: null`.
- **No secrets in config.** `env:NAME` values in config are resolved from the environment at run time (§5.1); the LLM key comes from `GEMINI_API_KEY` / `POINTTO_LLM_API_KEY`, never the config file.
- **Output is validated** with `parseManifest` before it is written. A scan that produces an invalid manifest fails loudly.

## Tasks

1. **`config.ts`** — parse and validate `guide.config.json` (`baseUrl`, `auth?`, `routes[]`, `output`, `llm?`), resolve `env:` values. TDD.
2. **`aria.ts`** — parse the `mode: 'ai'` YAML into `{ role, name, ref }[]`, keeping interactive roles only. TDD against captured snapshot text.
3. **`ids.ts`** — deterministic, readable ids: `<route-slug>.<name-slug>`, deduplicated with `-2`, `-3`. TDD.
4. **`labeler.ts`** — `Labeler` interface; `SkeletonLabeler`; `OpenAICompatibleLabeler` with injected `fetch`, strict-JSON prompt, batch per route, tolerant parsing (code fences), `null` on abstention. TDD with a fake fetch.
5. **`scan.ts`** — Playwright: launch, run `auth.steps`, per route `goto` → `networkidle` + settle → `ariaSnapshot` → per ref, `locator('aria-ref=…')` and one `evaluate` returning `{ testid, text, css }`. Headed with `--headed`. No unit test; verified live in Task 7.
6. **`assemble.ts` + `index.ts`** — build routes/elements/anchors (durability order: testid → role-name → text → css), attach labels, `parseManifest`, write, print counts and anything the labeler abstained on. CLI: `scan --config <path> [--no-llm] [--headed]`.
7. **Live verification** against the running Refine demo (`localhost:5190`) with `--no-llm`: the generated manifest must resolve at runtime for the same six elements the hand-written one covered, and the summary must read sensibly. Then, when a Gemini key exists, the same scan with labels.
8. **Docs** — QA manual Checkpoint 5, README, CLAUDE.md, `examples/demo-app/guide.config.json` committed as the reference config.

## Definition of done

`pnpm --filter pointto-cli build && node packages/cli/dist/index.js scan --config examples/demo-app/guide.config.json --no-llm` writes a manifest that `parseManifest` accepts and that lights the right controls in the demo app. Labeled mode verified live once a key is available; until then, its unit tests against a fake fetch are the evidence, and the report says so.
