# pointto

**Your app answers questions by pointing, not by writing.**

A user opens the widget, asks out loud "how do I add someone to my team?", and the application navigates to the right screen, dims everything except the exact control they need, and explains it in speech. If they click the wrong thing, it notices and says so.

Built for the [AssemblyAI Voice Agent Hackathon](https://lablab.ai). MIT licensed.

## Status

**Checkpoint 3 of 9 complete** — the product works end to end in text mode. Open the widget, type *how do I add a store?*, and the app changes page and lights the right button. No voice yet; that is the next checkpoint, and it drives exactly this same path.

It runs against [Refine's open-source admin app](https://github.com/refinedev/refine), which we did not write — see [examples/demo-app/PROVENANCE.md](examples/demo-app/PROVENANCE.md). Rename a button without regenerating the manifest and it still finds it. Ask something it cannot map and it lights nothing and says so, because a wrong highlight is worse than an admitted failure.

See [docs/QA-MANUAL.md](docs/QA-MANUAL.md) to test what exists today, and [BUILD-SPEC.md](BUILD-SPEC.md) for the full design.

![The widget answering "how do I add a product?" inside the Refine admin app](docs/img/phase3-text-widget.png)

## Why this is not a guided tour library

Intro.js, Shepherd.js, WalkMe and Pendo are scripts: someone writes each step by hand, in order, ahead of time, and the tour breaks the moment the user goes off script.

| | Traditional tours | pointto |
|---|---|---|
| Setup | A developer writes every step by hand | The app is scanned and the manifest is generated |
| When it runs | Once, on day one | Whenever the user asks |
| What it handles | One fixed flow, in order | Any question, in any order |
| If you go off-script | It breaks | It corrects you, or adapts |

**The screen is never locked.** The overlay dims the rest of the page but everything stays clickable. This library runs inside other people's products and must never trap a user in their own tool — and a guided flow you cannot deviate from never has to prove it understood anything.

**The agent guides, it does not click for you.** You keep control, and you learn where the feature lives.

## Install

```bash
npm install pointto
```

```tsx
import { GuideProvider } from 'pointto';
import manifest from './pointto.manifest.json';

<GuideProvider manifest={manifest}>
  <App />
</GuideProvider>
```

Not published yet — that lands in a later checkpoint. Until then, this is a workspace.

## Packages

| Package | What it is |
|---|---|
| `pointto` | What you install. `GuideProvider`, widget, spotlight overlay, and the public types. |
| `pointto-core` | Resolver, manifest schema, geometry. Framework-free; pulled in by `pointto` automatically. |
| `pointto-cli` | `npx pointto-cli scan` — drives your app with Playwright and generates the manifest. Separate so its Playwright dependency stays out of your frontend install. Not built yet. |

```
packages/     the published libraries
examples/     playground (dev harness) and the deployed demo
server/       ephemeral token minting and event collection
docs/         QA manual, specs, and implementation plans
```

## Developing

Requires Node 20+ and pnpm.

```bash
pnpm install
pnpm --filter playground dev              # dev harness on http://localhost:5173
pnpm --filter finefoods-antd dev:pointto  # third-party demo on http://localhost:5190
pnpm test                                 # run the suite
pnpm build                                # build all packages
```

## License

MIT — see [LICENSE](LICENSE).
