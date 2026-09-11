# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

There is no code yet. The repo currently holds one file, [proyecto-guia-de-voz.md](proyecto-guia-de-voz.md), the project plan. It is also **not a git repository yet** — the hackathon requires a public GitHub repo under the MIT license, so `git init` + a `LICENSE` file are part of the work.

There are therefore no build, lint, or test commands to document. Add them to this file as the packages are scaffolded.

The planning doc is written in Spanish and the user works in Spanish; match that language in discussion of product decisions unless asked otherwise.

## What is being built

A conversational navigation layer that drops into someone else's React dashboard as a library. The user asks a question out loud ("¿cómo agrego a alguien de mi equipo?"), and the agent navigates to the right screen, spotlights the exact control, and narrates what to do — then *corrects the user by voice if they click the wrong thing*. That live correction is the differentiator; without it the project reads as "a guided tour with voice" (Intro.js / Shepherd.js / WalkMe / Pendo), which is the stated main risk.

Submitted to the AssemblyAI Voice Agent Hackathon (lablab.ai). Hard deadline 30 Sep 2026, 9:00 AM Mérida time — last full working day is 29 Sep.

## Planned architecture (three pieces)

**1. Scan CLI** — run once by the developer installing the library: `npx <name> scan --routes ./rutas.json`. Drives the target app with Playwright, captures the **accessibility tree** of each route (not raw HTML — the a11y tree is 10–100× smaller and carries each control's name and purpose; this choice is what makes the project feasible at all), has an LLM label every element (what it does, synonyms a user might say, when it applies), and emits a `manifest.json` the developer commits and can hand-edit. The manifest being reviewable and versioned is a feature, not a compromise.

**2. npm package (the widget)** — floating widget, spotlight overlay, on-screen element resolver, and the voice-agent connection. Rendered in **Shadow DOM** so host-app styles and ours cannot collide.

**3. Minimal backend** — exactly two endpoints: issue short-lived AssemblyAI tokens (the API key must never reach the browser), and receive usage events (what users asked, where they got stuck). No accounts, no DB, no dashboard.

### AssemblyAI integration

Uses the **Voice Agent API** (single connection: listen, understand, decide, speak, with turn detection, barge-in, and tool calls). Tools the agent invokes in our code:

- `navigate(ruta)` — move the user to the right screen
- `highlight(elemento)` — spotlight the control
- `confirmAction(elemento)` — wait for the user to actually click it

Six languages (en, es, fr, de, it, pt) with mid-sentence switching come free from the API — one manifest yields onboarding in all six. This is a headline selling point in the pitch.

## Design decisions that must not be silently reversed

- **Never block the screen.** The spotlight dims everything visually, but the rest of the UI stays clickable. Reasons: users legitimately detour mid-task; this is a library running inside someone else's product and trapping their users is unshippable; and a tour you cannot deviate from removes the demo that proves the agent understands. **Only exception:** destructive or irreversible actions — intercept those and ask for confirmation.
- **The mic is not always on.** It opens when the user opens the widget. An always-listening mic is an instant rejection from any corporate buyer.
- **Text fallback is not optional.** Same engine, same spotlight, typed input, for denied mic permission or noisy offices. Voice is what gets demoed; the fallback is what makes it a usable library.
- **The demo app must be a real open-source app**, not a toy dashboard we write. Scanning third-party code is the proof this is a framework rather than a bespoke demo.

## Scope for the three weeks

In: React only; a deployed example app judges can open; working scan CLI; package actually published to npm; voice + text fallback.

Out (mentioned as roadmap in the pitch, not built): route-discovery crawler (the dev supplies the route list), analytics dashboard, accounts/billing, Vue/Angular support.

## Known hard parts

1. **Selector durability** — if the host app changes a button's label, the manifest stops finding it. Plan: store several anchors per element and resolve in cascade until one hits. This is the real engineering problem of the project.
2. **Live correction** — detecting the user went off-path and reacting by voice without being irritating.
3. **Transient app state** — modals, popovers, things that appear conditionally are not all visible to a static scan.

## Deliverables checklist (hackathon submission)

Title + description, cover image, ≤5 min MP4 pitch video, PDF deck, public MIT-licensed GitHub repo, live demo URL judges can visit. Presentation is a quarter of the score.

**Pitch ordering matters:** open with the open-ended question and the spotlight answering it. Show the linear tour last, as a special case of the same engine. Leading with the linear tour gets the project filed as "another guided tour."
