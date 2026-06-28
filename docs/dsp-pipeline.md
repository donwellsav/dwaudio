# DSP pipeline

This document describes the detection engine: how a microphone signal becomes a
feedback advisory. It assumes you have read the [architecture overview](./architecture.md).

The engine is split between the main thread (audio capture + peak detection) and a Web
Worker (per-peak analysis, fusion, classification, advisory lifecycle). The worker code
lives under `lib/dsp/`; the worker entry point is `lib/dsp/dspWorker.ts`.

## Worker message protocol

The main thread and worker communicate via `postMessage`. The message unions are defined
in `lib/dsp/dspWorker.ts` (`WorkerInboundMessage` / `WorkerOutboundMessage`). The worker's
`onmessage` switch ends in a `never` exhaustiveness check, so adding a message variant
without handling it is a compile-time error.

### Inbound (main thread → worker)

| Message | Purpose |
| --- | --- |
| `init` | Initialize with `settings`, `sampleRate`, `fftSize`; resets all state and replies `ready` |
| `updateSettings` | Merge partial settings; invalidates the cached fusion config |
| `syncFeedbackHistory` | Push current feedback "hotspot" summaries (recurrence context) |
| `processPeak` | A detected peak plus its `spectrum` (and optional `timeDomain`) buffers — the hot path |
| `clearPeak` | A peak/track has dropped below threshold; clears the matching advisory |
| `reset` | Clear tracks, advisories, and trackers (e.g. on (re)start) without re-init |
| `spectrumUpdate` | Periodic spectrum snapshot for content-type / compression detection |

### Outbound (worker → main thread)

| Message | Purpose |
| --- | --- |
| `ready` | Sent after `init` completes |
| `advisory` | A created/updated advisory (provisional or confirmed) |
| `advisoryCleared` | An advisory was cleared (by ID) |
| `tracksUpdate` | Active track summaries + content type + report-gate diagnostics |
| `combPatternUpdate` | Comb-filter pattern (early-warning predicted frequencies) or `null` |
| `contentTypeUpdate` | Content type / compression changed |
| `returnBuffers` | Hands transferred `ArrayBuffer`s back to the main thread for reuse |
| `error` | A non-fatal worker error (surfaces as an amber `workerError` warning) |

## Zero-copy buffer transfer

Per-frame spectrum and time-domain data are large `Float32Array`s. Rather than copy them
on every message, the main thread **transfers** their backing `ArrayBuffer`s to the worker
(see `preparePeakTransfer` / `prepareSpectrumUpdateTransfer` in
`hooks/dspWorkerInternals.ts`). The worker processes them and posts a `returnBuffers`
message to transfer ownership back. `useDSPWorker` keeps small pools
(`specPoolRef`, `tdPoolRef`, `specUpdatePoolRef`) so buffers are recycled instead of
re-allocated each frame.

## Backpressure and crash recovery

The worker can only process one peak frame at a time. `useDSPWorker` tracks this with a
`busy` flag and applies backpressure:

- **Busy / not-ready:** incoming peaks are pushed onto a bounded pending queue
  (`enqueuePendingPeak`). When the queue is full, the oldest frame is dropped and counted.
- **Stats:** `getBackpressureStats()` returns `{ dropped, total, ratio }`;
  `getTransportStats()` reports message and `tracksUpdate` payload counts. These power the
  FPS/health footer.
- **Crash recovery:** if the worker throws at the top level, `worker.onerror`
  (`createDSPWorkerErrorHandler`) respawns a fresh worker and replays the last `init`
  snapshot. Repeated crashes within a short window mark the worker
  `isPermanentlyDead`. While recovering, `isCrashed` is set and the UI shows a non-fatal
  `workerError` (amber) rather than failing hard.

## Per-peak pipeline

For each `processPeak`, `dspWorker.ts` runs the following (see the `processPeak` case):

1. **Track association** — `TrackManager.processPeak(peak)` associates the peak with an
   existing track or creates a new one (`lib/dsp/trackManager.ts`).
2. **Frame analysis** — `AlgorithmEngine.feedFrame(...)` (`lib/dsp/workerFft.ts`) updates
   per-frame MSD, amplitude, and (unless skipped) phase buffers. Phase analysis can be
   skipped adaptively (`shouldSkipPhase`, gated by the `adaptivePhaseSkip` setting and
   recent fusion probability) to save CPU.
3. **Algorithm scores** — `AlgorithmEngine.computeScores(...)` produces `AlgorithmScores`
   for the peak (see [algorithms](#detection-algorithms)).
4. **Fusion** — `fuseAlgorithmResults(...)` combines the scores into a feedback probability,
   confidence, and verdict (see [fusion engine](#fusion-engine)).
5. **Classification** — `classifyTrackWithAlgorithms(...)` (`lib/dsp/classifier.ts`) assigns
   a label (`ACOUSTIC_FEEDBACK` / `WHISTLE` / `INSTRUMENT` / `POSSIBLE_RING`) and a severity.
6. **Label smoothing** — a 3-frame ring-buffer majority vote prevents advisory flicker.
   `RUNAWAY` and `GROWING` severities **bypass** smoothing because they are safety-critical.
7. **Harmonic suppression** — if the frequency is a harmonic of an existing advisory,
   confidence is capped and urgent severities are demoted to `RESONANCE`.
8. **Report gate** — `getReportGateDecision(...)` decides whether to surface the advisory.
9. **Advisory create/update** — `AdvisoryManager.createOrUpdate(...)` emits `advisory` /
   `advisoryCleared` actions (confirmed or provisional; see [lifecycle](#advisory-lifecycle)).

The worker also prunes dead per-track state (label history, comb/agreement trackers) every
50 frames and caps those maps to avoid unbounded growth during broadband transients.

## Detection algorithms

Six deterministic algorithms each measure a different "is this feedback or music?" property.
Each yields a `feedbackScore` in `[0, 1]`.

| Algorithm | Module | Intuition |
| --- | --- | --- |
| **MSD** (Magnitude Slope Deviation) | `workerFft.ts` (DAFx-16) | Consistent magnitude growth across frames ⇒ a building howl |
| **Phase coherence** | `phaseCoherence.ts` | A pure feedback tone has very high phase coherence; below ~200 Hz the score is de-weighted (coarse FFT phase resolution) |
| **Spectral flatness** | `compressionDetection.ts` | Low flatness ⇒ a narrow pure tone rather than broadband content |
| **Comb pattern** | `combPattern.ts` | Evenly-spaced peaks reveal a room reflection comb; spacing implies a path length and predicts future feedback frequencies (early warning) |
| **IHR** (Inter-Harmonic Ratio) | `spectralAlgorithms.ts` | Clean, isolated tone ⇒ feedback; rich/decaying harmonics ⇒ music |
| **PTMR** (Peak-to-Median Ratio) | `spectralAlgorithms.ts` | A sharp peak far above the spectral median ⇒ feedback; broad energy ⇒ not |

Compression is detected separately (`compressionDetection.ts`); compressed program material
gets its own fusion weights and gating because heavy compression distorts several of the
cues above.

## Fusion engine

`fuseAlgorithmResults` (`lib/dsp/fusionEngine.ts`) computes a weighted average of the
active algorithm scores. Weights depend on the detected content type
(`FUSION_WEIGHTS` in `fusionEngine.ts`):

| Algorithm | DEFAULT | SPEECH | MUSIC | COMPRESSED |
| --- | --- | --- | --- | --- |
| MSD | 0.30 | 0.33 | 0.08 | 0.12 |
| Phase | 0.26 | 0.24 | 0.36 | 0.30 |
| Spectral | 0.12 | 0.10 | 0.10 | 0.18 |
| Comb | 0.08 | 0.05 | 0.08 | 0.08 |
| IHR | 0.13 | 0.10 | 0.24 | 0.18 |
| PTMR | 0.11 | 0.18 | 0.14 | 0.14 |

> These constants and their rationale live in `fusionEngine.ts`. Treat that file as the
> source of truth; the table above is a snapshot to orient new readers.

Key behaviors:

- **Comb doubling.** When an acoustic comb pattern is detected, the comb term's weight is
  doubled in the numerator only — a bonus that does not dilute the other algorithms.
- **Music-suppression gates.** A series of gates *reduce* the probability for patterns that
  look tonal/harmonic but are likely musical or pitch-corrected sources (e.g.
  phase-dominant music, rich-harmonic series, compressed voiced sources). These only ever
  lower the probability.
- **Confidence.** `confidence = probability · (0.5 + 0.5 · agreement) + persistenceBonus`,
  where `agreement` is the inverse of the normalized spread between algorithm scores and
  `persistenceBonus` rewards stable cross-frame agreement.
- **Verdict.** One of `FEEDBACK`, `POSSIBLE_FEEDBACK`, `NOT_FEEDBACK`, `UNCERTAIN`, derived
  from the probability/confidence thresholds plus strong-corroboration shortcuts.

`calculateMINDS` (also in `fusionEngine.ts`) implements the DAFx-16 "MSD-Inspired Notch
Depth Setting" heuristic: start shallow (−3 dB) and deepen as growth continues, used to
recommend notch depth for growing feedback.

## Content-type detection

Content type (`speech` / `music` / `compressed` / `unknown`) is tracked in the worker from
the periodic `spectrumUpdate` feed (crest factor + temporal metrics with majority-vote
smoothing), independent of the peak backpressure path. The authoritative content type then
selects the fusion weight preset above.

## Advisory lifecycle

`AdvisoryManager` (`lib/dsp/advisoryManager.ts`) owns the advisories `Map` and emits action
descriptors (`advisory` / `advisoryCleared`) that the orchestrator forwards to the main
thread. Each advisory carries a `lifecycle` of:

- **`provisional`** — an early "watch" candidate. Shown when the report gate has not yet
  fully confirmed (e.g. `growing-waiting-persistence` or `low-confidence`) but the
  classification is feedback-like above a relaxed confidence floor. Provisional advisories
  auto-expire after `PROVISIONAL_MAX_ACTIVE_MS` (1800 ms) if not confirmed. The relaxed
  thresholds are the `PROVISIONAL_*` constants in `dspWorker.ts`.
- **`confirmed`** — the report gate passed; full EQ advice is attached.

### Report gates

`getReportGateDecision` (`lib/dsp/classifier.ts`) returns `{ shouldReport, gate, reason }`.
`RUNAWAY` always reports (bypasses gates); `GROWING` reports as an early warning unless it
is still waiting for persistence or looks like a speech formant. Other gate IDs include
`not-eligible`, `steady-chromatic-tone`, `low-confidence`, and `speech-formant`
(see the `ReportGateId` union in `types/advisory.ts`). The latest gate decision is included
in `tracksUpdate` for diagnostics.

### Dedup, suppression, cooldowns

- **Dedup** by frequency proximity *and* by GEQ band (`advisoriesByBand`), so two peaks in
  the same band don't produce duplicate advice.
- **Harmonic suppression** lowers confidence for overtones of an existing advisory.
- **Band cooldown** (`BAND_COOLDOWN_MS`) and a 200 ms advisory rate limit prevent rapid
  re-firing after a user clears an issue.
- **Clear-on-miss grace** — when the report gate stops passing, the advisory is held for a
  grace window (longer for confirmed, shorter for rejected provisional) before clearing.

### Severity levels

`SeverityLevel` (`types/advisory.ts`): `RUNAWAY`, `GROWING`, `RESONANCE`, `POSSIBLE_RING`,
`WHISTLE`, `INSTRUMENT`. The first two are urgent and bypass label smoothing.

## EQ advisory output

For confirmed (and provisional) advisories, `generateEQAdvisory` (`lib/dsp/eqAdvisor.ts`)
produces an `EQAdvisory` with:

- a **GEQ** band suggestion (`GEQRecommendation`: 31-band ISO graphic-EQ band + cut),
- a **PEQ** parametric suggestion (`PEQRecommendation`: type/frequency/Q/gain, with the Q
  source annotated as `baseline`/`measured`/`cluster`/`guarded`),
- broadband **shelves** (`ShelfRecommendation[]`),
- musical **pitch** translation (`PitchInfo`), and
- optional recurrence context (cuts widen slightly for repeat offenders).

See `types/advisory.ts` for the full shapes.
