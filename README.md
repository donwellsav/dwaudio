# DoneWell Audio

DoneWell Audio is a local-only acoustic-feedback detector and EQ advisory app for live sound
work. It runs as a Next.js web app, listens to a browser microphone, analyzes the incoming
audio in the browser, and displays detected issues with EQ recommendations.

The app is intentionally local-only:

- There is no backend service, database, runtime telemetry, or API route.
- Microphone capture uses the Web Audio API in the browser.
- DSP post-processing runs in a Web Worker created from `lib/dsp/dspWorker.ts`.
- User-facing state is stored locally (`localStorage` keys under `dwa-v2-*`, plus the
  `dwa-theme` key used by `next-themes`).
- `pnpm verify:local-only` checks that removed backend/network/runtime integrations are not
  reintroduced.

## Current functionality

- Reads microphone input with `AudioContext` / `AnalyserNode`.
- Detects sustained spectral peaks on the main thread, then sends peak frames to a DSP worker.
- Tracks peaks over time and classifies them as feedback, possible ringing, whistle, or
  instrument-like material.
- Combines six deterministic algorithm signals in the worker:
  - magnitude-slope deviation (MSD)
  - phase coherence
  - spectral flatness
  - comb-pattern analysis
  - inter-harmonic ratio (IHR)
  - peak-to-median ratio (PTMR)
- Maintains content-type state (`speech`, `music`, `compressed`, or `unknown`) from periodic
  spectrum updates and uses that state in the fusion engine.
- Produces advisories with:
  - lifecycle (`provisional` or `confirmed`)
  - label and severity
  - frequency, amplitude, Q, and bandwidth metadata
  - graphic-EQ and parametric-EQ recommendations
  - optional shelf recommendations and pitch information
- Includes operation-mode baselines for:
  - `speech`
  - `worship`
  - `liveMusic`
  - `theater`
  - `monitors`
  - `broadcast`
  - `outdoor`
- Provides analyzer UI for spectrum/RTA display, GEQ bars, issue cards, faders, device
  selection, settings, and diagnostics.
- Registers `public/dwa-service-worker.js` only in production, only on a secure origin, and
  only when service workers are supported. The service worker caches same-origin core/static
  assets and provides a local offline fallback after a successful load.

## Runtime flow

```
microphone
  → FeedbackDetector / AudioAnalyzer (main thread)
  → detected peaks + spectrum frames
  → DSP worker
  → track manager + algorithm scores + fusion + classifier
  → advisory manager
  → React state and UI
```

Important entry points:

- `app/page.tsx` renders `AudioAnalyzerClient`.
- `components/analyzer/AudioAnalyzerClient.tsx` dynamically imports the analyzer UI with
  server rendering disabled.
- `lib/audio/createAudioAnalyzer.ts` owns the `AudioAnalyzer` wrapper and the display
  spectrum loop.
- `lib/dsp/feedbackDetector.ts` owns Web Audio setup and peak detection.
- `hooks/useAudioAnalyzer.ts` connects the analyzer to React state and the DSP worker.
- `hooks/useDSPWorker.ts` owns worker lifecycle, buffer transfer, backpressure counters, and
  worker recovery state.
- `lib/dsp/dspWorker.ts` coordinates worker-side tracking, algorithm scoring, fusion,
  classification, and advisory lifecycle.
- `hooks/useLayeredSettings.ts` and `lib/settings/deriveSettings.ts` convert layered UI
  settings into the flat `DetectorSettings` object consumed by the analyzer and worker.

## Tech stack

- [Next.js](https://nextjs.org/) 16 (App Router) + React 19 + TypeScript
- [Tailwind CSS](https://tailwindcss.com/) 4 for styling
- Web Audio API + a Web Worker for DSP
- [Vitest](https://vitest.dev/) for tests, ESLint for linting
- [pnpm](https://pnpm.io/) for package management

## Requirements and browser notes

- **Node 22** (see `.nvmrc`)
- **pnpm** `10.30.1` (pinned in `package.json` via `packageManager`)
- A modern browser with Web Audio + Web Worker support, and microphone access.
  Microphone capture requires a **secure context** — `https://` or `localhost`/`127.0.0.1`.

## Getting started

```bash
pnpm install
pnpm dev
```

Then open <http://127.0.0.1:3000>, allow microphone access, and click **ENGAGE** to start
analysis.

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
| `pnpm verify:local-only` | Run the local-only verifier |
| `pnpm build:dmg` | Build the macOS DMG package (macOS toolchain required) |

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

The DMG build script creates a static Next.js output and wraps it in a macOS `.app` bundle
before writing `dist/dwaudio.dmg`. It requires macOS tooling and is not runnable in this Linux
development environment.

`next.config.mjs` also supports:

- `DWA_STATIC_EXPORT=1` — sets Next.js `output: 'export'`
- `DWA_STANDALONE=1` — sets Next.js `output: 'standalone'`

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

- **"No microphone found"** — connect a mic and retry. In the cloud browser there is no real
  audio device by default; see [`AGENTS.md`](AGENTS.md) for the synthetic-mic flags used in
  that environment.
- **Microphone permission blocked** — allow access from the address-bar mic icon or your OS
  privacy settings.
- **Mic requires a secure connection** — serve over `https://` or use `localhost`/`127.0.0.1`.

More error guidance is in
[Development → Troubleshooting](docs/development.md#troubleshooting).
