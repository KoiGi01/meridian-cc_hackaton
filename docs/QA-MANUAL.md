# pointto — QA manual

This document is written for a tester. You do not need to have read the build spec, and you do not need to understand the code. Each checkpoint is a list of things to do and what should happen when you do them.

A new section is added every time a development checkpoint is finished. Work through the newest section, and re-run the older ones if you have time — anything that used to pass and now fails is worth reporting immediately.

**How to report a problem:** say which numbered check failed, what you saw instead, your browser and OS, and your screen size. A screenshot or screen recording is worth a lot.

---

## Setting up, once

You need [Node.js](https://nodejs.org) version 20 or newer.

```bash
node -v                 # must print v20 or higher
npm install -g pnpm     # only if `pnpm -v` fails
pnpm install            # from the project root
```

To start the test page:

```bash
pnpm --filter playground dev
```

Then open **http://localhost:5173** in your browser. Leave that command running while you test; press `Ctrl+C` in the terminal to stop it.

To run the automated tests:

```bash
pnpm test
```

Everything should say passed. As of Checkpoint 1 there are 39 automated tests.

---

## Checkpoint 1 — The spotlight

**Finished:** 2026-09-11

**What was built.** The basic mechanism the whole product rests on: making one element on screen light up while everything else dims. There is no voice yet, no question box, and no understanding of what the app does. The two "Spotlight" buttons at the top of the test page stand in for what the voice agent will eventually decide on its own.

**What you are really testing.** Two promises. First, the light lands exactly on the right element and stays there no matter how the page moves. Second, and more important, **the dimming never stops you from using the rest of the page.** That second one is a deliberate product decision, not an oversight: this library runs inside other companies' apps, and it must never trap someone in their own tool. If you ever find something you cannot click while the screen is dimmed, that is a serious bug — report it.

![The billing button lit up while the rest of the page is dimmed](img/phase1-spotlight-billing.png)

### Checks

| # | What to do | What should happen | Pass / Fail |
|---|---|---|---|
| 1.1 | Open http://localhost:5173 | The page loads with a heading "pointto playground" and three buttons near the top. Nothing is dimmed yet. | |
| 1.2 | Click **Spotlight "Invite member"** | The page scrolls down on its own to the Team settings box, the whole screen dims, and the "Invite member" button stays bright with a soft rounded outline around it. | |
| 1.3 | While it is lit, scroll up and down slowly with your mouse wheel | The bright patch stays stuck to the button the entire time. It must not lag behind, drift off to one side, or leave a trail. | |
| 1.4 | Resize the browser window, making it clearly narrower and shorter | The bright patch follows the button to its new position. It must not stay behind where the button used to be. | |
| 1.5 | With the screen dimmed, scroll to "Proof the host UI stays clickable" and click **Click me while dimmed** several times | The counter goes up every single time. **This is the most important check in this list.** If clicks are being swallowed, stop and report it. | |
| 1.6 | While something is lit, click **Spotlight "Billing"** | The page scrolls to the Billing box and the light moves smoothly to the "Manage billing" button. Only ever one thing is lit at a time. | |
| 1.7 | Click **Clear** | The dimming disappears completely and the page looks totally normal again. | |
| 1.8 | Turn on "reduce motion" in your system settings (Windows: Settings → Accessibility → Visual effects → Animation effects off; Mac: System Settings → Accessibility → Display → Reduce motion). Reload the page and switch between the two spotlight buttons | The light jumps straight to the new button with no sliding animation. Everything else behaves the same. | |
| 1.9 | Make the browser window very small, then spotlight something near the edge of the screen | The bright patch stops at the edge of the window. It must never be drawn partly outside the visible page or cause a scrollbar to appear. | |
| 1.10 | Try it in a second browser (Chrome, Firefox, Edge, Safari) | Everything above behaves the same way. | |

### Known and expected at this checkpoint

These are **not** bugs. They are things not built yet. Please do not file them.

- **Scrolling the lit element off screen makes the dimming disappear entirely.** By design, the tool would rather show you nothing than light up the wrong thing. Noticing that you wandered off and talking you back is a later checkpoint.
- There is no microphone, no voice, and no box to type a question into. The two Spotlight buttons are a stand-in for the agent.
- The tool has no idea what the page means. It cannot yet be asked "how do I invite someone" — it only lights up what it is told to.
- The test page is a plain harness we wrote. The real demo runs against a real third-party app and comes later.
- The browser tab shows a missing-icon warning in the developer console. Harmless, and it goes away when the demo app gets a favicon.

### Found during this checkpoint

One real bug, found by driving a real browser rather than trusting the automated tests: spotlighting anything below the fold lit up **nothing at all**, because the light was being clipped to the visible window and collapsed to zero size. The automated tests had missed it by pretending every element was already on screen. Fixed by scrolling the target into view first, and a test was added so it cannot come back silently. Check 1.2 is what guards it.
