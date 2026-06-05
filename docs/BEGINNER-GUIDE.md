# DoneWell Audio Beginner Guide

This is the shortest accurate way to get oriented in the codebase.

## What The App Does

DoneWell Audio listens to a microphone, detects likely feedback or ringing frequencies, classifies what it is seeing, and recommends EQ action.

It does **not** modify the browser audio path. The app is analysis-only.

## First Local Run

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`, allow microphone access, and start analysis.

Before treating a change as "done":

```bash
npx tsc --noEmit
pnpm test
```

## Where To Look First

| Area | Why it matters |
|---|---|
| `components/analyzer/` | Product UI, layouts, issue cards, help, settings |
| `hooks/` | React-side orchestration and UI behavior |
| `contexts/` | Provider boundaries for engine, settings, metering, detection, and UI |
| `lib/dsp/` | Detection pipeline, fusion, classifier, EQ advisor, worker |
| `lib/settings/` | Layered settings model, defaults, mode baselines, derivation |
| `types/` | Shared TypeScript contracts |

## Runtime Shape

```text
Mic -> Web Audio API -> FeedbackDetector (main thread)
    -> peak + spectrum -> dspWorker (worker thread)
    -> fusion + classification + advisory
    -> React state -> spectrum + issue cards + help/UI
```

### Main Thread

- owns the `AudioContext`
- reads the analyser data
- runs hot-path peak detection in `lib/dsp/feedbackDetector.ts`
- renders the UI and canvas views

### Worker

- scores the algorithms
- applies fusion and gates
- classifies tracks
- generates EQ recommendations
- manages advisory lifecycle

## Settings Model

The app no longer treats "defaults" as one flat bag.

There are three ideas you need to keep straight:

1. **Mode baseline**
   - the actual operating preset for a mode like `speech` or `liveMusic`
   - source: `lib/settings/modeBaselines.ts`

2. **Environment offsets**
   - room-relative offsets layered on top of the active mode
   - source: `lib/settings/environmentTemplates.ts`

3. **Live overrides**
   - sensitivity, gain, auto-gain, focus range, and similar session-time changes
   - source: `hooks/useLayeredSettings.ts`

### Important default distinction

- Fresh-start session threshold: `25 dB`
- Explicit `speech` mode baseline: `20 dB`

That is intentional. A brand-new session starts from the historical fresh-start snapshot, but choosing or deriving `speech` mode defaults uses the actual speech baseline.

## UI Surfaces That Matter

### Issues

- issue cards are the operator-facing output
- they now distinguish narrow cuts from broader regions
- repeated clustered cards are not automatically "more notches"

### Display

- `Perceptual` spectrum view is for reading room and speech balance
- `Raw` view is for narrow ring hunting

## Safe Change Workflow

If you are touching detection or defaults:

1. Identify whether you are changing a mode baseline, fresh-start behavior, or a live override.
2. Check the matching tests under `hooks/__tests__/`, `lib/settings/__tests__/`, and `lib/dsp/__tests__/`.
3. Update the in-app help if operator behavior changed.
4. Run the repo gate.

## Best Current Sources Of Truth

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `lib/changelog.ts`
- `tests/README.md`
- current tests near the code you are changing

Prefer those over stale notes when they disagree.
