# DoneWell Audio

DoneWell Audio is a local-only Next.js app for microphone-based acoustic feedback detection.
It runs in the browser, reads microphone input with the Web Audio API, and shows suspected
feedback/ringing issues with EQ recommendations.

This repository contains one application. There is no separate backend package.

## What is in this app

Verified from source:

- **Framework:** Next.js 16 App Router, React 19, TypeScript.
- **Runtime:** browser-only audio capture and analysis; no app API routes.
- **Audio capture:** `lib/dsp/feedbackDetector.ts` uses Web Audio primitives.
- **Analyzer wrapper:** `lib/audio/createAudioAnalyzer.ts` connects the detector to UI and
  worker callbacks.
- **Worker:** `hooks/useDSPWorker.ts` creates a Web Worker from `lib/dsp/dspWorker.ts`.
- **DSP pipeline:** the worker coordinates tracking, algorithm scoring, fusion,
  classification, and advisory lifecycle.
- **Settings:** `hooks/useLayeredSettings.ts` stores layered session/display state and
  `lib/settings/deriveSettings.ts` derives the flat `DetectorSettings` object.
- **Persistence:** local storage is used for `dwa-v2-session`, `dwa-v2-display`,
  `dwa-v2-presets`, `dwa-v2-startup`, and the `dwa-theme` key used by `next-themes`.
- **Service worker:** `components/LocalServiceWorkerRegister.tsx` registers
  `/dwa-service-worker.js` only in production, only in a secure context, and only when the
  browser supports service workers.

The local-only constraint is guarded by `scripts/verify-local-only.mjs`.

## User-visible behavior

- Click **ENGAGE** to request microphone access and start analysis.
- The UI displays spectrum/RTA data, GEQ bars, issue cards, faders, device controls, and
  settings panels.
- Advisories can be `provisional` or `confirmed`.
- Advisory labels are defined in `types/advisory.ts` as `ACOUSTIC_FEEDBACK`, `WHISTLE`,
  `INSTRUMENT`, and `POSSIBLE_RING`.
- Severity values are `RUNAWAY`, `GROWING`, `RESONANCE`, `POSSIBLE_RING`, `WHISTLE`, and
  `INSTRUMENT`.
- EQ recommendation types include GEQ, PEQ, optional shelves, and pitch information.
- Operation-mode baselines are defined in `lib/settings/modeBaselines.ts`:
  `speech`, `worship`, `liveMusic`, `theater`, `monitors`, `broadcast`, and `outdoor`.

## Source map

- `app/page.tsx` renders `AudioAnalyzerClient`.
- `components/analyzer/AudioAnalyzerClient.tsx` dynamically imports the analyzer UI with
  server-side rendering disabled.
- `components/analyzer/AudioAnalyzer.tsx` wires providers, layouts, alerts, header, keyboard
  shortcuts, and footer.
- `lib/audio/createAudioAnalyzer.ts` owns the `AudioAnalyzer` wrapper and the display
  spectrum loop.
- `lib/dsp/feedbackDetector.ts` owns Web Audio setup and peak detection.
- `hooks/useAudioAnalyzer.ts` connects the analyzer to React state and the DSP worker.
- `hooks/useDSPWorker.ts` owns worker lifecycle, buffer transfer, backpressure counters, and
  worker recovery state.
- `lib/dsp/dspWorker.ts` coordinates worker-side tracking, algorithm scoring, fusion,
  classification, and advisory lifecycle.
- `contexts/AudioAnalyzerContext.tsx` splits runtime state into engine, settings, metering,
  and detection contexts.
- `hooks/useLayeredSettings.ts` and `lib/settings/deriveSettings.ts` convert layered settings
  into the flat `DetectorSettings` object consumed by the analyzer and worker.

## Toolchain

- Node 22 (`.nvmrc`)
- pnpm 10.30.1 (`package.json` `packageManager`)
- Next.js 16.2.7
- React 19.2.5
- TypeScript 5.7.3
- Vitest 4.x
- ESLint 9.x

## Browser requirements

- Web Audio API support.
- Web Worker support.
- Microphone permission.
- Secure context for microphone capture (`https://`, `localhost`, or `127.0.0.1`).

## Getting started

```bash
pnpm install
pnpm dev
```

Open <http://127.0.0.1:3000>. The dev script runs `next dev --webpack`.

## Scripts

| Script | Description |
| --- | --- |
| `pnpm dev` | Start the dev server (webpack) at `http://127.0.0.1:3000` |
| `pnpm build` | Production build (webpack) |
| `pnpm start` | Serve a production build |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run Vitest once |
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

`verify:local-only` scans source paths and selected config/docs files for removed backend,
network, telemetry, ML, data-collection, and product-shell remnants. It also checks a set of
forbidden paths. See `scripts/verify-local-only.mjs` for the exact patterns.

## Build & packaging

```bash
pnpm build
pnpm build:dmg
```

`pnpm build:dmg` runs `scripts/build-dmg.mjs`. The script creates static output, places it in
a macOS `.app` bundle, and writes `dist/dwaudio.dmg`. It requires macOS tooling.

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

Additional docs live in [`docs/`](docs/README.md):

- [Architecture](docs/architecture.md) — system overview, threading model, data flow.
- [DSP pipeline](docs/dsp-pipeline.md) — detection algorithms, fusion, advisory lifecycle.
- [Settings model](docs/settings.md) — layered settings, modes, and derivation.
- [Development](docs/development.md) — setup, testing, troubleshooting, and the local-only gate.

See [`AGENTS.md`](AGENTS.md) for environment and cloud/CI specifics.

## Troubleshooting

- **No microphone found** — connect a microphone and retry. In the Cursor Cloud browser,
  use the synthetic-microphone flags documented in [`AGENTS.md`](AGENTS.md).
- **Microphone permission blocked** — allow access from the address-bar mic icon or your OS
  privacy settings.
- **Mic requires a secure connection** — serve over `https://` or use `localhost`/`127.0.0.1`.

More error guidance is in
[Development → Troubleshooting](docs/development.md#troubleshooting).
