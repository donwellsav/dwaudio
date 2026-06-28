# DoneWell Audio — Documentation

DoneWell Audio is a **local-only** acoustic feedback detector and EQ advisor for live sound
engineers. It listens to a microphone in the browser, flags likely feedback or ringing, and
suggests practical EQ moves. There is no backend — all analysis runs client-side via the Web
Audio API and the DSP code under `lib/`.

## Contents

| Doc | What it covers |
| --- | --- |
| [Architecture](./architecture.md) | System overview, threading model, end-to-end data flow, React context layout, directory map |
| [DSP pipeline](./dsp-pipeline.md) | Worker message protocol, zero-copy buffers, backpressure/crash recovery, the six detection algorithms + fusion, classification, and the advisory lifecycle |
| [Settings model](./settings.md) | Layered settings, operation modes, derivation to `DetectorSettings`, the audio-vs-worker runtime split, persistence, and reset semantics |
| [Development](./development.md) | Setup, scripts, testing strategy, the `verify:local-only` runbook, troubleshooting, and pitfalls |
| [`../AGENTS.md`](../AGENTS.md) | Environment / cloud-CI specifics (canonical) |

## Where to start

- **Run the app locally:** [Development → Prerequisites](./development.md#prerequisites).
- **Understand how detection works:** [Architecture](./architecture.md), then
  [DSP pipeline](./dsp-pipeline.md).
- **Change detection behavior / a setting:** [Settings model](./settings.md) (then the
  fusion/classifier sections of the [DSP pipeline](./dsp-pipeline.md)).
- **Debug the worker or transport:**
  [DSP pipeline → Backpressure and crash recovery](./dsp-pipeline.md#backpressure-and-crash-recovery).
- **Add or run tests:** [Development → Testing strategy](./development.md#testing-strategy).
- **Keep the app backend-free:**
  [Development → verify:local-only runbook](./development.md#verifylocal-only-runbook).
