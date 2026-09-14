# Handoff — continue from here

Written 2026-09-13 at the end of a long session. Read `CLAUDE.md` first (it is the durable reference); this file is only what CLAUDE.md does not say: where things stand right now, what was decided in conversation, and what to do next.

## State

- **Checkpoints 1–5 of 9 are done and merged to `main`**, pushed to https://github.com/KoiGi01/meridian-cc_hackaton. 175 tests, `pnpm build` clean (8 targets).
- Working tree clean on `main` as of commit `cbd8e5b` ("Merge phase 5: scanner CLI").
- What exists and works end to end, verified in a real browser against the vendored Refine admin: spotlight → manifest + anchor cascade → typed questions (lexical, offline) → **voice** via AssemblyAI Voice Agent API (mic, tool calls, spoken replies, audio-reactive orb, collapsible chat, captions) → **scanner CLI** that generated the manifest the demo now runs on (51 elements, Gemini-labeled).
- Human-verified by the user: the voice sounds good with `anna`; the orb/collapse/captions UI was approved ("Ok it works").
- `.env` (gitignored, never committed) holds `ASSEMBLYAI_API_KEY` and `GEMINI_API_KEY`. **Both passed through chat and must be rotated before submission.**

## Decisions made in conversation (not derivable from code)

- Package name: single `pointto` for users (`npm install pointto`); `pointto-core` internal dep; `pointto-cli` separate. The `@pointto` npm org is taken; unscoped names were free on 2026-09-11 and are first-come — publish `0.0.1` early to reserve them (needs `npm login`; user's explicit OK before any publish).
- **Test in English only.** User instruction. Multilingual stays in the product, unexercised.
- Commits are authored `KoiGi01 <92281504+KoiGi01@users.noreply.github.com>` (repo-level git config, already set). Keep the `Co-Authored-By: Claude` trailer.
- Branch per phase, `--no-ff` merge to `main`, one commit per task, never squash. Judges read history.
- Every checkpoint appends a section to `docs/QA-MANUAL.md` written for a tester who has not read the spec, and the user gets a report of what was built.
- The user's teammate does QA from `docs/QA-MANUAL.md`; needs `.env` via a secure channel.

## Next: Phase 6 — drift detection (the differentiator)

BUILD-SPEC §5.7 and §9.6. User said "sigamos" (continue). Nothing designed yet beyond this sketch, which the user has not approved — present it first:

- While a target is lit, listen for clicks on `document` (capture, passive). On a click that is not the target: (1) if the clicked element is in the manifest and advances toward the goal, adapt silently; (2) if it leads away, have the agent say one short correction via `reply.create { instructions }` (already proven to make the agent speak on demand); (3) if unknown, call `get_current_context` and re-orient. Correct once, briefly; after two ignored corrections, offer to start over. Visual feedback local and immediate; only the spoken correction goes through the model (~1 s).
- `awaitInteraction` tool from §5.6: resolves when the user actually clicks the lit target. Feeds both drift detection and Phase 8 flows.
- Destructive elements: confirmation gate (§6). The scanner already flags `destructive` by name (delete/remove); the agent prompt already asks to confirm; the runtime gate is not built.

After 6: Phase 7 deploy + npm publish (token server exists, undeployed; needs a hosting choice — Vercel/Netlify/Fly — and the user's npm login), Phase 8 flows / linear tour, Phase 9 polish + video + deck. **The pitch video and deck have no owner yet** — worth 25% of the score.

## Running things

```bash
pnpm dev:server                            # token server :8787 (needs .env)
pnpm --filter finefoods-antd dev:pointto   # demo :5190 (predev builds packages)
pnpm --filter playground dev               # harness :5173
```
Kill stray Vite processes with PowerShell `Get-NetTCPConnection -State Listen | ? LocalPort -in 5173,5190,8787` → `Stop-Process`. Background tasks from the old session are gone; start fresh.

## Verification habit that paid off five times

jsdom passed and the browser failed in every phase. After any change to overlay, resolver, widget, or voice: start the demo, drive it with the Playwright MCP browser (`browser_navigate` + `browser_evaluate` into the shadow root at `[data-pointto-root]`), and check the light lands on the right element before calling it done. For voice, `sendText` through the live agent exercises the whole pipeline without a microphone; the human does the mic.

## Small open items

- Panel can overlap a lit element in the bottom-right corner (cosmetic, Phase 9).
- Status can stick on "Speaking" if the mic permission prompt is never answered (cosmetic).
- Free-tier Gemini scan takes ~10 min; the labeler retries 429/5xx and degrades per-route to skeleton.
- Refine's hosted API (`api.finefoods.refine.dev`) is a third-party dependency for the demo; snapshot responses if it looks flaky near judging.
- `docs/audio-check/` (gitignored) has greeting WAVs; `server/scripts/greeting-wav.ts` regenerates them.
