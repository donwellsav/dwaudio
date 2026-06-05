# DoneWell Audio

Real-time acoustic feedback detection for live sound engineers.

DoneWell Audio listens to a microphone feed, identifies likely feedback and ringing frequencies, and recommends EQ action with frequency, pitch, and filter guidance. It is analysis-only: the app never modifies or outputs audio.

Built by [Don Wells AV](https://donwellsav.com).

## What The App Does Now

- Browser-based PWA built with Next.js, React, and TypeScript
- Local microphone analysis only; no telemetry, upload, Companion bridge, or cloud data path
- Worker-side fusion, classification, and advisory generation
- Six deterministic detection signals: MSD, phase coherence, spectral flatness, comb pattern, IHR, and PTMR
- Live spectrum, detected issues, and recommended EQ actions
- Compact settings surface: live controls plus expert algorithm settings

## Quick Start

```bash
cd donewellaudio
pnpm install
pnpm dev
```

Open `http://localhost:3000`, grant microphone access, and start analysis.

## Core Commands

```bash
pnpm dev
pnpm build
pnpm lint
pnpm test
pnpm test:watch
pnpm test:coverage
npx tsc --noEmit
```

Repo gate:

```bash
npx tsc --noEmit && pnpm test
```

## Current Product Behavior

- DoneWell Audio is advisory only. It never inserts itself into the live audio output path.
- A brand-new session starts from the historical fresh-start speech snapshot at `25 dB`.
- The explicit `speech` mode baseline is `20 dB`.
- `Reset All` returns to the fresh-start snapshot, not the raw speech baseline.
- Room presets are relative offsets layered on top of the active mode baseline.
- The `Perceptual` spectrum view changes the graph only. It does not change detector behavior.

## Detection Pipeline

```text
Mic -> getUserMedia -> GainNode -> AnalyserNode
  -> FeedbackDetector.analyze() on the main thread
    -> peak candidate + spectrum + time-domain transfer to worker
      -> algorithm scoring
      -> fusion + gates
      -> track classification
      -> EQ recommendation
      -> advisory update back to the UI
```

The design goal is not "detect every narrow peak." The worker is tuned to surface real feedback early enough to act on while still suppressing common speech, music, hum, room-mode, and compressed-content false positives.

## Accuracy And Tuning Workflow

Use the local checks and deterministic fusion tests:

  ```bash
  pnpm verify:local-only
  pnpm test
  ```

## Documentation Map

- [CHANGELOG.md](CHANGELOG.md): branch-level release notes
- [tests/README.md](tests/README.md): test structure and replay workflows
- [docs/BEGINNER-GUIDE.md](docs/BEGINNER-GUIDE.md): first-stop codebase orientation
- [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md): implementation and workflow guide
- [docs/SYSTEM_ARCHITECTURE.md](docs/SYSTEM_ARCHITECTURE.md): runtime architecture and data flow
- [docs/TECHNICAL_REFERENCE.md](docs/TECHNICAL_REFERENCE.md): current technical behavior and operating model

## Important Constraints

- Use `pnpm`, not `npm` or `yarn`.
- The hot path lives in `lib/dsp/feedbackDetector.ts` and the worker DSP pipeline.
- Tune with evidence, not assumptions.
- Prefer current source files, tests, and in-app help over stale notes when they disagree.
