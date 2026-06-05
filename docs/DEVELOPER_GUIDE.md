# DoneWell Audio Developer Guide

This guide is for contributors who need the current architecture and workflow, not historical audit snapshots.

## Local Development

### Prerequisites

- Node.js 22
- `pnpm`
- modern browser with microphone access

### Main commands

```bash
pnpm dev
pnpm build
pnpm lint
pnpm test
npx tsc --noEmit
```

Repo gate:

```bash
npx tsc --noEmit && pnpm test
```

## Execution Model

### Main thread responsibilities

- `createAudioAnalyzer.ts` creates and wires the audio graph
- `feedbackDetector.ts` performs hot-path peak detection
- React contexts and layouts render the product UI
- canvas drawing stays on the main thread

### Worker responsibilities

- `dspWorker.ts` orchestrates worker-side processing
- `fusionEngine.ts` combines algorithm evidence
- `classifier.ts` applies mode-aware reporting logic
- `eqAdvisor.ts` produces PEQ, GEQ, and broader region guidance
- advisory lifecycle stays worker-owned until updates are sent back to the UI

## Current Settings Architecture

The settings model is layered. Do not treat `DEFAULT_SETTINGS` as the whole truth.

### Canonical pieces

- `MODE_BASELINES` in `lib/settings/modeBaselines.ts`
- `ENVIRONMENT_TEMPLATES` in `lib/settings/environmentTemplates.ts`
- zero-state and fresh-start session defaults in `lib/settings/defaults.ts`
- derivation in `lib/settings/deriveSettings.ts`
- session ownership in `hooks/useLayeredSettings.ts`

### Critical distinction

- fresh-start compatibility snapshot: `25 dB`
- explicit `speech` mode baseline: `20 dB`

If you collapse those again, you recreate the shipped silent-drift bug.

## Current UI And Operator Model

### Help and guidance

The in-app help is not decorative. It now reflects actual operator guidance:

- broad clusters are not always narrow-notch problems
- `Perceptual` spectrum view is display-only

If you change operator behavior, update the help tabs under `components/analyzer/help/`.

### Recommendation framing

The UI now distinguishes:

- narrow feedback cuts
- broad regions
- broad tonal notes

Do not push everything back into one generic "cut this peak" story.

## Documentation Maintenance Rules

- Keep `README.md` short and current.
- Keep `CHANGELOG.md` branch-oriented.
- Keep `lib/changelog.ts` product-facing.
- Use the `docs/` folder for long-form current reference.

## Validation Priorities

### Highest priority

- `lib/dsp/__tests__/`
- `lib/settings/__tests__/`
- `hooks/__tests__/`
- `tests/integration/`

### Especially important cases

- speech-formant false positives
- room-risk low-frequency buildup
- compressed-source suppression
- raw vs perceptual display invariants

## When You Should Push Back

Push back when someone:

- treats the app like it processes live output audio
- assumes room presets are absolute thresholds
- assumes `DEFAULT_SETTINGS` equals the speech preset
- tries to retune constants without validation coverage
- confuses a display-only change with a detector change
