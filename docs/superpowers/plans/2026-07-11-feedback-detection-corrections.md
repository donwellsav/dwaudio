# Feedback Detection Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the proven timing and scoring defects in the existing feedback detector so provisional alerts arrive faster and confirmed alerts use internally consistent evidence.

**Architecture:** Keep the current main-detector-to-worker pipeline. The main detector owns acquisition, elapsed-time persistence, peak confirmation, and the single normalized-MSD history; the worker owns tracking, reliable spectral fusion, classification, and the existing provisional/confirmed advisory lifecycle. Unreliable phase and compression evidence remains diagnostic but does not vote in automatic fusion.

**Tech Stack:** TypeScript, Web Audio API, Web Workers, Vitest, pnpm, Next.js 16.

## Global Constraints

- Add no UI, controls, dependencies, processing layers, or new detector algorithms.
- Keep worker reset and transferable-buffer return contracts unchanged.
- Treat missing MSD or phase evidence as unavailable, not negative evidence.
- Preserve existing advisory fields and provisional/confirmed lifecycle contracts.
- Defer microphone and venue-hardware validation until the final step.

---

### Task 1: Correct signed growth semantics

**Files:**
- Modify: `lib/dsp/trackManager.ts:607-650`
- Test: `lib/dsp/__tests__/trackManager.test.ts`
- Test: `lib/dsp/__tests__/classifier.test.ts`

**Interfaces:**
- Consumes: signed per-sample amplitude velocity in dB/s.
- Produces: `TrackFeatures.maxVelocityDbPerSec` as the maximum positive growth velocity, with decay contributing zero.

- [ ] **Step 1: Write the failing regressions**

Add a TrackManager test that feeds amplitudes `-20, -23, -26, -29` at 100 ms intervals and expects:

```ts
expect(track.velocityDbPerSec).toBeLessThan(0)
expect(track.features.meanVelocityDbPerSec).toBeLessThan(0)
expect(track.features.maxVelocityDbPerSec).toBe(0)
```

Add a classifier regression using that track and expect neither growth severity:

```ts
const result = classifyTrack(track)
expect(result.severity).not.toBe('GROWING')
expect(result.severity).not.toBe('RUNAWAY')
expect(result.reasons.some((reason) => reason.startsWith('Rapid growth:'))).toBe(false)
```

- [ ] **Step 2: Run the tests and verify the failure**

Run:

```bash
pnpm exec vitest run lib/dsp/__tests__/trackManager.test.ts lib/dsp/__tests__/classifier.test.ts
```

Expected: the decay regression reports a positive `maxVelocityDbPerSec` and growth severity.

- [ ] **Step 3: Store only positive velocity in the growth maximum**

Replace the absolute-value accumulator in `extractFeatures()` with:

```ts
let maxPositiveVelocity = 0
// ...
if (velocity > maxPositiveVelocity) maxPositiveVelocity = velocity
// ...
maxVelocityDbPerSec: maxPositiveVelocity,
```

Keep `meanVelocityDbPerSec` and `track.velocityDbPerSec` signed.

- [ ] **Step 4: Run the focused tests**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dsp/trackManager.ts lib/dsp/__tests__/trackManager.test.ts lib/dsp/__tests__/classifier.test.ts
git commit -m "fix: keep feedback growth velocity signed"
```

---

### Task 2: Support the full 16,384 FFT spectrum

**Files:**
- Modify: `lib/dsp/spectralAlgorithms.ts:21-25`
- Test: `lib/dsp/__tests__/algorithmFusion.test.ts`

**Interfaces:**
- Consumes: supported spectra up to 8,192 bins from a 16,384-point FFT.
- Produces: identical content classification for proportionally equivalent spectra at 8,192 and 16,384 FFT sizes.

- [ ] **Step 1: Write the failing FFT-invariance regression**

Create proportional 4,096-bin and 8,192-bin spectra using these normalized bands:

```ts
const bands = [
  { position: 0.08290420987643302, width: 0.02840963261947036, db: -14.611648921854794 },
  { position: 0.1369897209503688, width: 0.008204488426446915, db: -44.38533163862303 },
  { position: 0.3201795339630917, width: 0.019828488666564226, db: -20.010530846193433 },
  { position: 0.5800928548141383, width: 0.02645339109748602, db: -47.68626203527674 },
]
```

Fill both spectra with `-120`, paint each band at its proportional position, and assert:

```ts
expect(detectContentType(spectrum8192, 13.297825925052166))
  .toBe(detectContentType(spectrum4096, 13.297825925052166))
```

- [ ] **Step 2: Run the regression and verify it fails**

Run:

```bash
pnpm exec vitest run lib/dsp/__tests__/algorithmFusion.test.ts
```

Expected: 4,096 bins return `unknown` while 8,192 bins return `music`.

- [ ] **Step 3: Size the reusable power cache for the supported maximum**

Change:

```ts
const _powerCache = new Float64Array(8192)
```

Do not add dynamic allocation or a new cache abstraction.

- [ ] **Step 4: Run the focused test**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dsp/spectralAlgorithms.ts lib/dsp/__tests__/algorithmFusion.test.ts
git commit -m "fix: size content analysis for 16k FFT"
```

---

### Task 3: Apply classifier evidence once and finalize confidence last

**Files:**
- Modify: `lib/dsp/classifier.ts:254-450`
- Modify: `lib/dsp/acoustic/confidenceCalibration.ts`
- Test: `lib/dsp/__tests__/classifier.test.ts`

**Interfaces:**
- Consumes: already-normalized `pFeedback`, `pWhistle`, and `pInstrument` after all feature and severity adjustments.
- Produces: `calculateCalibratedConfidence(pFeedback, pWhistle, pInstrument)` whose confidence is the maximum final class score and whose label describes that same value.

- [ ] **Step 1: Write failing single-count and final-confidence tests**

Add a helper test proving the function no longer reapplies modal or growth boosts:

```ts
expect(calculateCalibratedConfidence(0.5, 0.3, 0.2)).toEqual({
  adjustedPFeedback: 0.5,
  confidence: 0.5,
  confidenceLabel: 'LOW',
})
```

Add classifier assertions:

```ts
expect(result.confidence).toBeCloseTo(
  Math.max(result.pFeedback, result.pWhistle, result.pInstrument),
  8,
)
```

Cover a normal resonance and a `RUNAWAY` result so severity overrides are included.

- [ ] **Step 2: Run the classifier tests and verify failure**

Run:

```bash
pnpm exec vitest run lib/dsp/__tests__/classifier.test.ts
```

Expected: confidence differs from the returned final class scores.

- [ ] **Step 3: Simplify the calibration helper**

Remove `modalOverlapBoost` and `cumulativeGrowthSeverity` from its signature. Implement:

```ts
export function calculateCalibratedConfidence(
  pFeedback: number,
  pWhistle: number,
  pInstrument: number,
) {
  const confidence = Math.max(pFeedback, pWhistle, pInstrument)
  const confidenceLabel = confidence >= 0.85 ? 'VERY_HIGH'
    : confidence >= 0.70 ? 'HIGH'
    : confidence >= 0.55 ? 'MEDIUM'
    : 'LOW'
  return { confidence, adjustedPFeedback: pFeedback, confidenceLabel }
}
```

- [ ] **Step 4: Move confidence calculation after severity normalization**

In `classifyTrack()`, delete the pre-severity calibration call and second feature adjustment. After the final score normalization, call:

```ts
const calibratedResult = calculateCalibratedConfidence(
  pFeedback,
  pWhistle,
  pInstrument,
)
const confidence = calibratedResult.confidence
```

Use `calibratedResult.confidenceLabel` in the return value. Do not add modal or cumulative evidence again; both were already applied in the feature pass.

- [ ] **Step 5: Run focused tests**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/dsp/classifier.ts lib/dsp/acoustic/confidenceCalibration.ts lib/dsp/__tests__/classifier.test.ts
git commit -m "fix: finalize detector confidence once"
```

---

### Task 4: Decouple analysis and persistence from display refresh

**Files:**
- Modify: `lib/dsp/feedbackDetector.ts`
- Modify: `lib/dsp/persistenceScoring.ts`
- Test: `lib/dsp/__tests__/feedbackDetector.lifecycle.test.ts`
- Test: `lib/dsp/__tests__/feedbackDetector.hotpath.test.ts`

**Interfaces:**
- Consumes: actual elapsed milliseconds between detector analyses.
- Produces: timer-driven detector analysis and `PersistenceTracker.update(binIndex, amplitudeDb, elapsedMs)`.

- [ ] **Step 1: Write failing scheduler and elapsed-time regressions**

Update lifecycle mocks to spy on `setInterval` and `clearInterval`. Assert one timer starts, stop clears it, and a pending/cancelled start creates none.

Add an irregular persistence test:

```ts
const tracker = new PersistenceTracker(1, 20, 'speech')
tracker.update(0, -30, 33)
tracker.update(0, -30, 34)
tracker.update(0, -30, 33)
expect(tracker.getScore(0).isPersistent).toBe(true)
```

- [ ] **Step 2: Run lifecycle and hot-path tests and verify failure**

Run:

```bash
pnpm exec vitest run lib/dsp/__tests__/feedbackDetector.lifecycle.test.ts lib/dsp/__tests__/feedbackDetector.hotpath.test.ts
```

Expected: detector uses RAF and persistence cannot consume elapsed milliseconds.

- [ ] **Step 3: Track persistence in measured milliseconds**

Add a per-bin `Float32Array` for elapsed time. Change the update signature to:

```ts
update(binIndex: number, amplitudeDb: number, elapsedMs: number = 20): void
```

On a stable frame, increment both frame count and elapsed time. On a new sequence, set count to one and elapsed time to the non-negative `elapsedMs`. Compare elapsed time directly with `MIN_PERSISTENCE_MS`, the mode-specific high threshold, twice that threshold, and `LOW_PERSISTENCE_MS`. Preserve `frames` for diagnostics.

- [ ] **Step 4: Replace the detector RAF with one interval timer**

Replace `rafId`/`rafLoop` with:

```ts
private analysisTimerId: ReturnType<typeof setInterval> | null = null

private analysisLoop(): void {
  if (!this.isRunning) return
  const now = performance.now()
  let dt = this.lastAnalysisTs === 0 ? this.config.analysisIntervalMs : now - this.lastAnalysisTs
  if (dt > this.maxAnalysisGapMs) {
    this.resetHistory()
    dt = this.config.analysisIntervalMs
  }
  try {
    this.analyze(now, dt)
  } catch (error) {
    this.callbacks.onError?.(`Analysis error: ${error instanceof Error ? error.message : String(error)}`)
  }
  this.lastAnalysisTs = now
}
```

Bind `analysisLoop` in the constructor. Start it with `setInterval(this.analysisLoop, analysisIntervalMs)`, clear it in `stop()`, and restart it when `analysisIntervalMs` changes during a run. Pass the actual `dt` into `PersistenceTracker.update()`.

- [ ] **Step 5: Run focused tests**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/dsp/feedbackDetector.ts lib/dsp/persistenceScoring.ts lib/dsp/__tests__/feedbackDetector.lifecycle.test.ts lib/dsp/__tests__/feedbackDetector.hotpath.test.ts
git commit -m "fix: clock feedback persistence by elapsed time"
```

---

### Task 5: Use one authoritative MSD history

**Files:**
- Modify: `lib/dsp/workerFft.ts:240-660`
- Test: `lib/dsp/__tests__/workerFft.test.ts`
- Test: `tests/integration/workerPipeline.test.ts`

**Interfaces:**
- Consumes: `DetectedPeak.msd`, `msdGrowthRate`, `msdIsHowl`, `msdFastConfirm`, and persistence metadata from the main detector.
- Produces: worker `AlgorithmScores.msd` through the existing `detectorMsdFallback()` mapping, without a second worker warm-up.

- [ ] **Step 1: Write the failing no-warm-up regression**

Initialize `AlgorithmEngine`, feed one peak containing a finite detector MSD, compute scores once, and assert:

```ts
expect(result.algorithmScores.msd?.msd).toBe(peak.msd)
expect(result.algorithmScores.msd?.isFeedbackLikely).toBe(true)
```

Then process repeated peaks with changing spectrum values and assert worker history never replaces the detector MSD.

- [ ] **Step 2: Run worker tests and verify failure**

Run:

```bash
pnpm exec vitest run lib/dsp/__tests__/workerFft.test.ts tests/integration/workerPipeline.test.ts
```

Expected: after worker warm-up, the worker-computed MSD replaces the detector value.

- [ ] **Step 3: Delete the duplicate worker MSD pool**

Remove the `MSDPool` import, property, allocation, reset, per-peak write, and worker `getMSD()` branch. In `computeScores()` use only:

```ts
const msdResult = detectorMsdFallback(peak, spectrum, binIndex)
```

Delete `getMsdMinFrames()` because the worker MSD branch is its only caller.

- [ ] **Step 4: Document normalized MSD honestly**

Update `msdPool.ts` and `detectionConstants.ts` comments to state that the implementation uses the mean squared second difference, a normalized variant of the cited summing method. Do not change the `0.1` threshold without recorded calibration data.

- [ ] **Step 5: Run focused tests**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/dsp/workerFft.ts lib/dsp/msdPool.ts lib/dsp/constants/detectionConstants.ts lib/dsp/__tests__/workerFft.test.ts tests/integration/workerPipeline.test.ts
git commit -m "fix: use one feedback MSD history"
```

---

### Task 6: Quarantine unreliable phase and compression votes

**Files:**
- Modify: `lib/dsp/fusionEngine.ts`
- Modify: `lib/dsp/workerFft.ts`
- Modify: `lib/dsp/compressionDetection.ts`
- Test: `lib/dsp/__tests__/algorithmFusion.test.ts`
- Test: `lib/dsp/__tests__/workerFft.test.ts`

**Interfaces:**
- Consumes: current phase and spectral-crest diagnostics.
- Produces: automatic fusion using MSD, spectral flatness, comb, IHR, and PTMR only; custom mode may still explicitly include phase.

- [ ] **Step 1: Write failing automatic-fusion tests**

Assert that changing only phase from zero to one does not change automatic fusion output:

```ts
expect(autoWithPhase.feedbackProbability).toBeCloseTo(autoWithoutPhase.feedbackProbability, 10)
expect(autoWithPhase.contributingAlgorithms).not.toContain('Phase')
```

Assert custom mode with `enabledAlgorithms: ['phase']` still reports `Phase`. Assert `AlgorithmEngine.computeScores()` returns `compression: null` while diagnostic compression getters may still update.

- [ ] **Step 2: Run fusion and worker tests and verify failure**

Run:

```bash
pnpm exec vitest run lib/dsp/__tests__/algorithmFusion.test.ts lib/dsp/__tests__/workerFft.test.ts
```

Expected: automatic phase changes the score and worker scores expose compression as voting evidence.

- [ ] **Step 3: Remove phase from automatic algorithm activation**

Change automatic activation to:

```ts
_active.add('spectral').add('comb').add('ihr').add('ptmr')
```

MSD remains conditional on available detector history. Leave custom mode unchanged.

- [ ] **Step 4: Keep compression diagnostic-only**

Continue updating `AmplitudeHistoryBuffer` and diagnostic getters, but set:

```ts
compression: null,
```

in `AlgorithmScores`. Update comments in `compressionDetection.ts` and `workerFft.ts` to call the measurement spectral crest rather than waveform crest or dynamic range. Do not introduce a replacement compressor detector.

- [ ] **Step 5: Mark fusion output as heuristic**

Update `FusedDetectionResult.feedbackProbability` documentation and fusion comments to say “heuristic feedback score.” Preserve the field name for compatibility and leave the identity calibration hook unused until recorded calibration exists.

- [ ] **Step 6: Run focused tests**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/dsp/fusionEngine.ts lib/dsp/workerFft.ts lib/dsp/compressionDetection.ts lib/dsp/__tests__/algorithmFusion.test.ts lib/dsp/__tests__/workerFft.test.ts
git commit -m "fix: exclude unreliable detector votes"
```

---

### Task 7: Full verification

**Files:**
- Verify only; no planned file changes.

**Interfaces:**
- Consumes: all corrected detector behavior.
- Produces: a clean worktree with local verification evidence; hardware remains deferred.

- [ ] **Step 1: Run focused DSP and integration tests**

```bash
pnpm exec vitest run lib/dsp/__tests__/feedbackDetector.lifecycle.test.ts lib/dsp/__tests__/feedbackDetector.hotpath.test.ts lib/dsp/__tests__/trackManager.test.ts lib/dsp/__tests__/classifier.test.ts lib/dsp/__tests__/workerFft.test.ts lib/dsp/__tests__/algorithmFusion.test.ts tests/integration/workerPipeline.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the complete automated suite**

```bash
pnpm test -- --run
pnpm lint
pnpm verify:local-only
pnpm build
```

Expected: all commands exit zero.

- [ ] **Step 3: Confirm repository state**

```bash
git status --short --branch
git log -8 --oneline
```

Expected: clean worktree on `codex/operator-trust-improvements`; no hardware claim.

- [ ] **Step 4: Leave verification state clean**

Do not create an empty verification commit. If a command fails, return to the task that owns the failing behavior, add the smallest regression there, and repeat that task's test and commit cycle before rerunning this verification task.
