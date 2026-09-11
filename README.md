# pointto

**Your app answers questions by pointing, not by writing.**

A user opens the widget, asks out loud "how do I add someone to my team?", and the application navigates to the right screen, dims everything except the exact control they need, and explains it in speech. If they click the wrong thing, it notices and says so.

Built for the [AssemblyAI Voice Agent Hackathon](https://lablab.ai). MIT licensed.

## Status

**Checkpoint 1 of 9 complete** — the spotlight mechanism. No voice yet.

See [docs/QA-MANUAL.md](docs/QA-MANUAL.md) to test what exists today, and [BUILD-SPEC.md](BUILD-SPEC.md) for the full design.

![The billing button lit up while the rest of the page is dimmed](docs/img/phase1-spotlight-billing.png)

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

## Packages

| Package | What it is |
|---|---|
| `@pointto/core` | Manifest types, element resolver, spotlight geometry. No framework dependency. |
| `@pointto/react` | `GuideProvider`, widget, spotlight overlay. |
| `@pointto/cli` | Scans a target app with Playwright and generates the manifest. Not built yet. |

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
pnpm --filter playground dev    # test page on http://localhost:5173
pnpm test                       # run the suite
pnpm build                      # build all packages
```

## License

MIT — see [LICENSE](LICENSE).
