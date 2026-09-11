# Provenance of this directory

**This is not our code.** It is a third-party open source application, vendored so that pointto can be demonstrated against an app we did not write. That is the entire point of it: a guided-tour library that only works on its author's own demo proves nothing.

| | |
|---|---|
| Upstream | [refinedev/refine](https://github.com/refinedev/refine) |
| Path | `examples/finefoods-antd` |
| Commit | `4d60acfd919461f319c71b52195aff0c23ce904f` (tag `@refinedev/core@5.0.12`) |
| Vendored on | 2026-09-11 |
| Upstream licence | MIT |

Refine's MIT licence permits this use. Copyright in this directory remains with the Refine authors and contributors.

## Why a release tag rather than `main`

Refine's `main` branch pins its examples to internal workspace versions that are not published to npm yet — vendoring the tip gave `ERR_PNPM_NO_MATCHING_VERSION` for `@refinedev/core@^5.2.0` when the latest release was `5.0.12`. The release tag references published versions, so the example installs standalone. This is why we took the tag instead of editing their dependency ranges: pinning versions ourselves would have meant running their code against packages it was never tested against.

## Why vendored rather than a submodule

The hackathon repository must stand alone for judges: `git clone` then `pnpm install` has to produce a working demo with no extra steps. A submodule adds a failure mode for no benefit at this scale.

## What we changed

The only permitted modification is mounting our `GuideProvider`, plus the manifest file we author ourselves. Specifically:

- `src/App.tsx` — wrapped the application in `<GuideProvider>`. Two import lines and one wrapper element; nothing else in the file was touched. The widget itself is rendered by the provider, so nothing else is mounted.
- `src/pointto.manifest.json` — **added by us.** Not upstream code.
- `package.json` — added the `pointto` workspace dependency, and `dev:pointto` / `predev:pointto` scripts.

(Checkpoint 2 briefly included a `pointto-qa-panel.tsx` as test scaffolding. It was removed in Checkpoint 3 once the real widget existed.)

### Why the extra dev script

Upstream's `dev` script runs `refine dev`, which on Windows printed a banner and then hung without ever binding a port. Plain `vite` starts the same app in about a second. `dev:pointto` runs vite directly on a fixed port so QA always knows where the demo is. Upstream's own scripts are left exactly as they were.

### Anchors in this app

This application contains **no `data-testid` attributes at all** — a fact worth recording, because our manifest schema treats `testid` as the most durable anchor. Real applications that were not built with an end-to-end test suite simply do not have them. Every element in our manifest therefore resolves through `role-name`, and the scanner in a later checkpoint must not assume test ids exist.

Everything else is upstream code as published.

**Do not** reformat this directory, fix its lint, upgrade its dependencies, or refactor it. If our widget requires a change to third-party source in order to work, that is a bug in our widget, not in their app — a real customer would never accept "first restructure your application".

## What it talks to

`@refinedev/simple-rest` against `https://api.finefoods.refine.dev`, a public API hosted by Refine. There is no database and no local backend. Its auth provider only writes to `localStorage` and accepts any credentials, so no real secrets exist anywhere in this setup.

**Risk:** that API is a third party we do not control. If it is unavailable while judges are looking, the demo degrades. Worth revisiting closer to submission if it proves flaky.
