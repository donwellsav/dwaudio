# DoneWell Audio Technical Reference

This is the current behavior reference for the app. It avoids stale file counts, stale release numbers, and old architectural claims.

## Core Product Invariant

DoneWell Audio is analysis-only.

- it captures microphone input
- it analyzes feedback risk
- it recommends EQ action
- it does **not** modify or output live audio

## Runtime Summary

```text
Mic -> Web Audio graph -> main-thread peak detection
    -> worker scoring / fusion / classification
    -> advisory + recommendation
    -> React state + canvas + issue cards
```

## Detection Signals

The worker fuses six deterministic signals:

1. MSD
2. phase coherence
3. spectral flatness / shape
4. comb pattern
5. IHR
6. PTMR

The weights are keyed by **content type**, not by user-selected mode. The content classifier chooses among `DEFAULT`, `SPEECH`, `MUSIC`, and `COMPRESSED` profiles.

## Post-Fusion And Reporting Logic

The system does not report every high narrow peak as feedback.

It also considers:

- harmonics and inter-harmonic energy
- broad-vs-narrow spectral shape
- formant structure
- chromatic pitch structure
- mains-hum families
- room-risk low-frequency behavior
- mode-specific suppression rules

## Current Mode Policy

Operation modes live in:

- `lib/settings/modeBaselines.ts`
- `lib/dsp/constants/presetConstants.ts`

### Current baseline thresholds

| Mode | feedbackThresholdDb | ringThresholdDb |
|---|---:|---:|
| speech | 20 | 5 |
| worship | 35 | 5 |
| liveMusic | 42 | 8 |
| theater | 28 | 4 |
| monitors | 15 | 3 |
| broadcast | 22 | 3 |
| outdoor | 38 | 6 |

### Important startup distinction

- fresh-start `DEFAULT_SETTINGS.feedbackThresholdDb` = `25`
- explicit `speech` mode baseline = `20`

That is a compatibility choice, not an accident.

## Room And Environment Model

Room presets are **relative offsets**, not absolute preset replacement.

Effective thresholds are derived from:

```text
mode baseline + environment offset + live sensitivity offset
```

That means the same room preset does different things in different modes.

## Measurement And Display Model

DoneWell Audio now separates interpretation from raw display more clearly:

- `Raw` spectrum view: narrow ring hunting
- `Perceptual` spectrum view: room and speech reading

The app does **not** yet perform full impulse-response or ETC-style direct-vs-early-vs-late separation.

## Recommendation Types

Recommendations can now carry different intent:

- narrow cut
- broad region
- broad tonal note

Repeated clustered alerts should not automatically be treated as "apply more narrow notches."

## Local-Only Boundary

The app does not upload analyzer data, send telemetry, expose a Companion bridge, or control external mixer/DSP hardware. Recommendations are rendered locally as operator guidance.

## Validation Rule

Do not retune thresholds or gates based only on anecdote.

Use:

- nearby unit tests
- integration tests
- synthetic fusion scenarios

If a change alters operator behavior, update the help tabs and docs in the same branch.
