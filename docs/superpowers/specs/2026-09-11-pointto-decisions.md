# Resolved decisions — pointto

Closes the open questions in [BUILD-SPEC.md](../../../BUILD-SPEC.md) §12. The build spec remains the design document; this records only what §12 left open.

Date: 2026-09-11 (package naming revised the same day, see below)

## 1. Package name

The product is **pointto**. The user-facing install is a single command, `npm install pointto`. Published packages:

| Package | Contents | Who installs it |
|---|---|---|
| `pointto` | `GuideProvider`, widget, spotlight overlay. Re-exports the public types and `parseManifest`. | Every user. |
| `pointto-core` | Manifest types, anchor cascade resolver, intent matching. No React. | Nobody directly — a dependency of `pointto`. Exists so the resolver stays framework-free for a future Vue adapter. |
| `pointto-cli` | Playwright scanner + LLM labeling. `npx pointto-cli scan`. | Developers, once, at setup. Separate because it drags in Playwright and its browser binaries, which must not land in a frontend widget's install. |

**Revision history.** The first decision was the `@pointto/*` scope. Package-name checks showed `@pointto/core` etc. unpublished, but that only proves no *packages* exist — an npm **user or org** named `pointto` already does, and the scope could not be created. Unscoped `pointto`, `pointto-core`, `pointto-cli` were verified free on 2026-09-11 and chosen instead. Unscoped names are first-come, so a `0.0.1` should be published early to reserve them. Every other unscoped candidate considered (`usher`, `docent`, `sherpa`, `wayfinder`, `signpost`, `guidepost`, `handrail`) was already published.

## 2. Labeling LLM

**Google Gemini, free tier.**

The CLI does not depend on Gemini in code. It defines a `Labeler` interface with one built-in implementation speaking the **OpenAI-compatible chat-completions shape**, configured by base URL, model, and API key. Gemini exposes such an endpoint, so the provider is a config value rather than a code path. The same implementation covers Groq, OpenRouter, and local Ollama if the free tier's limits become a problem mid-hackathon.

A `--no-llm` mode emits a manifest skeleton from accessibility names alone, with `purpose: null` and empty `aliases`, for hand-editing. This is both the offline path and the generator of Phase 2's hand-written fixture.

Rationale for keeping it swappable: free tiers have rate limits, and discovering one mid-scan two days before the deadline must be a config edit, not a refactor.

## 3. Demo target

**Refine's admin example**, forked. Chosen over Twenty and Formbricks because those need Postgres, and a database raises both local-setup and public-deploy cost against a hard 2026-09-29 cutoff.

Open risk: this must be confirmed to run and deploy without a database before the fork is committed. If it does not, escalate rather than absorb the ops cost.

## 4. Manifest hosting

**Ships in the host repository**, committed by the developer, as §5.2 assumes.

Not fetched from our server: the manifest is a build-time artifact, so serving it at runtime would add a dependency on our uptime for no gain, break offline development, and contradict the "reviewable, versioned, not opaque magic" argument that the spec makes a selling point.

## 5. QA reporting cadence

Each completed phase appends a numbered section to `docs/QA-MANUAL.md` — setup steps, what to click, expected versus broken behavior, and a pass/fail line. Written for a tester who has not read the build spec.
