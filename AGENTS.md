# AGENTS.md - DoneWell Audio Local-Only Fork

This repository is currently an isolated local-only experiment. Use the current
working tree as truth; do not rely on older docs or previous GitHub state.

## Hard Rules

- Do not push, fetch, open PRs, or contact GitHub unless the user explicitly asks.
- Keep the app local-only: no telemetry, no cloud ingest, no geo lookup, no data
  sharing, no Companion bridge, no mixer control, no ML/ONNX model loading.
- Do not modify audio output. The app listens, analyzes, and recommends EQ
  actions; it does not process or change the live audio signal.
- Use `pnpm`.
- Before claiming completion, run the local verification gates listed below.

## Current Product Scope

DoneWell Audio is a browser-based feedback analyzer for live sound work. It uses
local microphone input to render a live spectrum, detect likely acoustic feedback
issues, and recommend local EQ actions.

The intended surface is:

- Live spectrum / RTA
- Detected issues
- Recommended GEQ/PEQ actions
- Expert deterministic algorithm settings

Everything outside that surface should be treated as suspect bloat unless the
user asks to bring it back.

## Verification

Run these after meaningful changes:

```bash
pnpm verify:local-only
npx tsc --noEmit
pnpm lint
pnpm test
pnpm build
git diff --check
```

For UI changes, also load `http://127.0.0.1:3000` locally and verify that the
visible app is reduced to the local analyzer surface.

## Architecture Notes

- Framework: Next.js app router with React and TypeScript.
- Analyzer UI lives under `components/analyzer/`.
- DSP logic lives under `lib/dsp/`.
- Settings derivation lives under `lib/settings/` and `hooks/useLayeredSettings.ts`.
- Worker wiring lives in `hooks/useDSPWorker.ts` and `lib/dsp/dspWorker.ts`.
- Local storage helpers live under `lib/storage/`.

The six active algorithm families are deterministic DSP signals: MSD, phase,
spectral, comb, IHR, and PTMR. Do not add ML model inference or training paths
without explicit user direction.
