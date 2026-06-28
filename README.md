# DoneWell Audio

**Real-time acoustic feedback detection and EQ advisory for live sound engineers — running entirely in your browser.**

DoneWell Audio listens to a microphone, flags likely acoustic feedback or ringing as it
develops, and recommends practical EQ moves (graphic-EQ band, parametric notch, and shelves)
to tame it. It is built as a Next.js web app, works offline, and can also be packaged as a
standalone macOS app.

> **Local-only:** there is no backend, database, or external service. All audio capture and
> analysis run client-side via the Web Audio API and the DSP code under `lib/`. Nothing is
> uploaded; the only persisted data is your settings in browser `localStorage`. A CI gate
> (`pnpm verify:local-only`) keeps it that way.

## Features

- **Live feedback detection** — a six-algorithm DSP engine (magnitude-slope deviation, phase
  coherence, spectral flatness, comb pattern, inter-harmonic ratio, peak-to-median ratio)
  fused into a single feedback probability, confidence, and verdict.
- **Feedback vs. music discrimination** — content-aware tuning (speech / music / compressed)
  and a set of suppression gates reduce false alarms on sustained vocals and instruments.
- **Early warning** — comb-filter analysis predicts likely feedback frequencies, and
  provisional "watch" advisories surface growing tones before they ring out.
- **EQ advice** — each confirmed issue includes a 31-band graphic-EQ suggestion, a parametric
  notch (frequency / Q / gain), broadband shelves, and a musical-pitch translation.
- **Operation modes** — presets tuned for `speech`, `worship`, `liveMusic`, `theater`,
  `monitors`, `broadcast`, and `outdoor`, each with sensible detection baselines.
- **Live controls** — sensitivity and input-gain faders (linkable), auto-gain, focus-range
  presets, and an EQ-style toggle, all adjustable while running.
- **Real-time visualization** — a spectrum / RTA display, graphic-EQ bar view, input metering,
  and an issues list with severity and recommended action.
- **Expert diagnostics** — optional per-algorithm enable/disable and gate-override knobs for
  power users.
- **Runs off the main thread** — CPU-heavy analysis happens in a Web Worker with zero-copy
  buffer transfer, backpressure handling, and automatic crash recovery, keeping the UI smooth.
- **Installable PWA** — responsive desktop/mobile layouts, dark theme, offline support via a
  local service worker.

## How it works

```
microphone → AudioContext + AnalyserNode (main thread)
           → peak detection → DSP Web Worker
           → track → algorithm scores → fusion → classification → report gate
           → advisory + EQ recommendation → React UI
```

Capture and the `requestAnimationFrame` spectrum loop run on the main thread; the per-peak
analysis pipeline (tracking, the six algorithms, fusion, classification, and the advisory
lifecycle) runs in a Web Worker. Settings are composed from a layered model (mode baseline +
live overrides + diagnostics + display) into the flat configuration the engine consumes.

See the [documentation](#documentation) for the full architecture, the DSP pipeline, and the
settings model.

## Tech stack

- [Next.js](https://nextjs.org/) 16 (App Router) + React 19 + TypeScript
- [Tailwind CSS](https://tailwindcss.com/) 4 for styling
- Web Audio API + a Web Worker for DSP
- [Vitest](https://vitest.dev/) for tests, ESLint for linting
- [pnpm](https://pnpm.io/) for package management

## Requirements

- **Node 22** (see `.nvmrc`)
- **pnpm** `10.30.1` (pinned in `package.json` via `packageManager`)
- A modern browser with Web Audio + Web Worker support, and microphone access.
  Microphone capture requires a **secure context** — `https://` or `localhost`/`127.0.0.1`.

## Getting started

```bash
pnpm install
pnpm dev
```

Then open <http://127.0.0.1:3000>, allow microphone access, pick your operation mode, and
click **ENGAGE** to start detection.

## Scripts

| Script | Description |
| --- | --- |
| `pnpm dev` | Start the dev server (webpack) at `http://127.0.0.1:3000` |
| `pnpm build` | Production build (webpack) |
| `pnpm start` | Serve a production build |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run the Vitest suite once |
| `pnpm test:watch` | Run Vitest in watch mode |
| `pnpm test:coverage` | Run Vitest with coverage |
| `pnpm verify:local-only` | CI gate that enforces the local-only constraint |
| `pnpm build:dmg` | Package a standalone macOS app/DMG (macOS only) |

## Checks

Run the same gates CI does before opening a PR:

```bash
pnpm lint
pnpm test
pnpm verify:local-only
```

## Build & packaging

```bash
pnpm build        # standard Next.js production build
pnpm build:dmg    # macOS-only: bundles a static export into a .app and DMG
```

The DMG build writes to `dist/dwaudio.dmg` and requires a macOS toolchain (it is not
runnable on Linux/Windows). The web build also supports a static export
(`DWA_STATIC_EXPORT=1`) and a standalone server build (`DWA_STANDALONE=1`).

## Project structure

```
app/         Next.js App Router entry (page, layout, global styles, offline route)
components/  Analyzer UI (header, layouts, spectrum canvas, issue cards, faders, settings)
contexts/    React context providers (engine, settings, metering, detection, advisory, UI)
hooks/       React hooks (useAudioAnalyzer, useDSPWorker, useLayeredSettings, panel state)
lib/         DSP engine, audio capture, canvas drawing, settings, storage, utils
types/       Shared type definitions
scripts/     verify-local-only.mjs (CI gate) and build-dmg.mjs (macOS packaging)
tests/       Cross-cutting and integration tests + Vitest setup
public/       Static assets, icons, manifest, local service worker
```

## Documentation

Engineering docs live in [`docs/`](docs/README.md):

- [Architecture](docs/architecture.md) — system overview, threading model, data flow.
- [DSP pipeline](docs/dsp-pipeline.md) — detection algorithms, fusion, advisory lifecycle.
- [Settings model](docs/settings.md) — layered settings, modes, and derivation.
- [Development](docs/development.md) — setup, testing, troubleshooting, and the local-only gate.

See [`AGENTS.md`](AGENTS.md) for environment and cloud/CI specifics.

## Troubleshooting

- **"No microphone found"** — connect a mic and retry; in headless/cloud browsers there is no
  audio device (see [`AGENTS.md`](AGENTS.md) for the synthetic-mic flags).
- **Microphone permission blocked** — allow access from the address-bar mic icon or your OS
  privacy settings.
- **Mic requires a secure connection** — serve over `https://` or use `localhost`/`127.0.0.1`.

More error guidance is in
[Development → Troubleshooting](docs/development.md#troubleshooting).
