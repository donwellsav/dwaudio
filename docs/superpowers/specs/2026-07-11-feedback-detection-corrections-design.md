# Feedback Detection Corrections

## Goal

Improve real detection speed and accuracy without adding UI, controls, dependencies, or a new detector. Correct the existing pipeline before tuning its thresholds.

## Scope

1. Treat only positive amplitude velocity as growth. A rapidly decaying peak must never become `GROWING` or `RUNAWAY` because of its decay rate.
2. Size content-type scratch storage for every supported FFT size, including 16,384.
3. Count modal and cumulative-growth evidence once. Calculate confidence from the final normalized class scores rather than an intermediate state.
4. Make detector scheduling independent of display refresh and base persistence decisions on measured elapsed time.
5. Use the detector's MSD result as the single authoritative MSD source. Remove the worker's differently clocked duplicate history. Keep the existing normalized-MSD formula and document that it is a deliberate variant of the cited summing method until recorded calibration data justifies changing its threshold.
6. Exclude phase coherence from automatic fusion while its snapshots are not sample-clocked. Keep the implementation available for diagnostics and future fixed-hop input.
7. Exclude the current spectral-crest heuristic from compression-specific fusion weights and gates. It may remain diagnostic data, but it must not claim to measure dynamic compression.
8. Stop presenting heuristic fusion output as a calibrated probability internally. Preserve the existing advisory confidence display contract, but derive it consistently from final scores. Empirical probability calibration waits for recorded test material.

## Data Flow

The main detector remains responsible for spectrum acquisition, thresholding, peak confirmation, normalized MSD, and elapsed-time persistence. Confirmed and refreshed peaks go to the worker. The worker tracks peaks, computes spectral evidence, fuses only reliable inputs, classifies the result, and emits provisional or confirmed advisories through the existing lifecycle.

No new processing layer or user-facing setting is introduced.

## Failure Handling

Timer delays larger than the existing analysis-gap limit reset temporal history before analysis resumes. Missing MSD or phase evidence is treated as unavailable, not as negative evidence. Existing worker reset and buffer-return contracts remain unchanged.

## Verification

- Add a regression proving a rapidly decaying track is not classified as growth.
- Add a 16,384-FFT content-type regression.
- Add classifier regressions proving evidence is applied once and confidence matches final scores.
- Add scheduler and elapsed-persistence tests using irregular timestamps.
- Add a worker regression proving detector MSD is used without a second history warm-up.
- Update fusion tests to prove automatic mode ignores unreliable phase and compression weighting.
- Run the focused DSP/integration suite, full test suite, lint, local-only verification, and production build.

Microphone and venue-hardware validation remains the final step, as previously agreed.
