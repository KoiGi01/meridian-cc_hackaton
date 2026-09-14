# Handoff — continue from here

Written 2026-09-13; updated 2026-09-14 after Phase 6 landed. Read `CLAUDE.md` first (it is the durable reference); this file is only what CLAUDE.md does not say: where things stand right now, what was decided in conversation, and what to do next.

## State

- **Checkpoints 1–6 of 9 are done and merged to `main`**, pushed to https://github.com/KoiGi01/meridian-cc_hackaton. 254 tests, `pnpm build` clean.
- What exists and works end to end, verified in a real browser against the vendored Refine admin: spotlight → manifest + anchor cascade → typed questions (lexical, offline) → **voice** via AssemblyAI Voice Agent API (mic, tool calls, spoken replies, audio-reactive orb, collapsible chat, captions) → **scanner CLI** that generated the manifest the demo runs on (51 elements, Gemini-labeled) → **drift detection**: light off the instant the user leaves the goal's screen, one spoken/typed correction, silent relight when they come back, give-up after two ignored corrections, `await_interaction` tool, runtime confirmation gate for `destructive` elements.
- Human-verified by the user: the voice sounds good with `anna`; the orb/collapse/captions UI was approved ("Ok it works"). **Phase 6 has not yet been tried by a human with a real microphone** — the browser pass typed to the live agent. QA-MANUAL Checkpoint 6 is written for that.
- `.env` (gitignored, never committed) holds `ASSEMBLYAI_API_KEY` and `GEMINI_API_KEY`. **Both passed through chat and must be rotated before submission.**

## Decisions made in conversation (not derivable from code)

- Package name: single `pointto` for users (`npm install pointto`); `pointto-core` internal dep; `pointto-cli` separate. The `@pointto` npm org is taken; unscoped names were free on 2026-09-11 and are first-come — publish `0.0.1` early to reserve them (needs `npm login`; user's explicit OK before any publish).
- **Test in English only.** User instruction. Multilingual stays in the product, unexercised.
- Commits are authored `KoiGi01 <92281504+KoiGi01@users.noreply.github.com>` (repo-level git config, already set). Keep the `Co-Authored-By: Claude` trailer.
- Branch per phase, `--no-ff` merge to `main`, one commit per task, never squash. Judges read history.
- Every checkpoint appends a section to `docs/QA-MANUAL.md` written for a tester who has not read the spec, and the user gets a report of what was built.
- The user's teammate does QA from `docs/QA-MANUAL.md`; needs `.env` via a secure channel.

## Phase 6 — what was decided and what to watch

Design (approved 2026-09-14, plan in `docs/superpowers/plans/2026-09-14-phase6-drift.md`):
- **Drift is classified by outcome, not by guessing what the clicked element does.** The generated manifest has no link from a sidebar entry to its route, and a wrong correction is worse than none. So: click on the lit target = reached; route changed away from the goal's screen = drift; target gone past a 1.5 s grace = lost; same screen = the user is just using their app. This also catches the back button.
- **The quest outlives the light** (`DriftTracker` in core). After a correction the goal is pending; a global (`*`) element lit meanwhile is a *waypoint* (the agent lighting the way back) and keeps the correction count. Pending goals expire after 2 min.
- **Only the sentence goes through the model** (`reply.create { instructions }`, queued until `reply.done` like tool results, dropped on barge-in). Light changes are local. With no session the same correction is a `drift` event the widget renders as text.
- The model may `highlight` the way back after a correction; it never navigates the user. Runtime gate: `highlight` on a `destructive` element needs `confirmed: true`; text mode returns `needs-confirmation` and the widget asks.

Open items from the browser pass (not reproduced, not understood):
- In two of five live sessions in the Playwright MCP browser (fake microphone, no real audio) the server ended the session ~400 ms into a correction; once the panel collapsed ~3 s later with no keypress logged. The instrumented rerun (WS frame log in the QA manual's "Found" section) ran four corrections cleanly. The fake mic also produced phantom Spanish user transcripts. **Try it with a real mic before chasing this.**
- `lost` (target vanishes on the same screen) is unit-tested only; the demo app has no easy way to trigger it.

## Next: Phase 7 — deploy + npm publish

Token server exists (`server/`), undeployed; needs a hosting choice (Vercel/Netlify/Fly) and the user's npm login. Publish `pointto`, `pointto-core`, `pointto-cli` at `0.0.1` early to reserve the names — **user's explicit OK before any publish or deploy.** Mic permission in an iframe needs `allow` attributes (BUILD-SPEC §11). Then Phase 8 flows / linear tour (the `await_interaction` tool and the quest machinery are the building blocks: a flow is a list of goals), Phase 9 polish + video + deck. **The pitch video and deck have no owner yet** — worth 25% of the score.

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
