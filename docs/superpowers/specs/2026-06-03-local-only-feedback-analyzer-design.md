# Local-Only Feedback Analyzer Design

Date: 2026-06-03
Repo: `/Volumes/M5/donewellaudio`
Branch: `local-only-experiment`

## Intent

Reduce DoneWellAudio to a local-only feedback analysis app. The app should do three things clearly:

1. Show the live spectrum from the user's microphone.
2. Detect likely feedback and related live-sound issues with deterministic DSP.
3. Recommend practical EQ actions, with expert algorithm settings available for tuning.

This experiment must stay isolated. It must not push to GitHub, open pull requests, publish releases, or depend on the upstream repository for any runtime behavior.

## Definition Of Local-Only

Local-only means the runtime app does not send analyzer data, issue data, settings, room data, snapshots, location data, telemetry, logs, or control commands to external services or companion systems.

Allowed behavior:

- Browser microphone capture through Web Audio.
- Local DSP analysis in the app and worker.
- Local display of live spectrum, detected issues, and EQ recommendations.
- Local browser storage for preferences and expert settings.

Disallowed behavior:

- Companion, mixer, relay, proxy, or remote-control integration.
- Data collection, consent-to-upload, ingest APIs, geo lookup, snapshot uploading, or Supabase persistence.
- Sentry telemetry, Sentry sample routes, or external error reporting.
- ONNX/ML inference, shipped models, training/export scripts, or ML-assisted fusion.
- Any runtime network call not required to load the local app itself.

## Current Audit

The bloat crosses runtime code, APIs, docs, scripts, tests, and dependencies.

Companion/control surfaces:

- `companion-module/`
- `companion-module-dbx-driverack-pa2/`
- `app/api/companion/`
- `lib/companion/`
- `types/companion.ts`
- `hooks/useCompanion*.ts`
- `components/analyzer/CompanionCommandBridge.tsx`
- `components/analyzer/help/CompanionTab.tsx`
- companion tests, docs, and generated artifacts
- `@companion-module/base`

Data collection and sharing surfaces:

- `app/api/v1/ingest/`
- `app/api/geo/`
- `lib/data/`
- `types/data.ts`
- `hooks/useDataCollection.ts`
- `components/analyzer/DataConsentDialog.tsx`
- `supabase/functions/ingest/`
- `supabase/migrations/`
- `scripts/test-ingest.mjs`
- `scripts/test-pipeline.mjs`

ML surfaces:

- `lib/dsp/mlInference.ts`
- `lib/dsp/__tests__/mlInference.test.ts`
- `public/models/`
- `scripts/ml/`
- ML settings and fusion fields such as `mlEnabled`, `AlgorithmScores.ml`, and ML weight branches
- `onnxruntime-web`

Telemetry surfaces:

- `instrumentation.ts`
- `instrumentation-client.ts`
- `sentry.server.config.ts`
- `sentry.edge.config.ts`
- `app/api/sentry-example-api/`
- `app/sentry-example-page/`
- Sentry imports in runtime error handling and DSP worker hooks
- `@sentry/nextjs`

Adjacent complexity that conflicts with the simpler app:

- Ring-out wizard UI and state.
- Room measurement UI and worker messages.
- Calibration and session export UI.
- Snapshot fixture and pipeline code that exists to support remote collection or research workflows.
- Docs that describe removed cloud, companion, telemetry, data collection, or ML systems.

## Target Product Shape

The first screen should be the actual analyzer, not a landing page.

Primary layout:

- Live Spectrum: the current spectrum visualization and input status.
- Detected Issues: current feedback markers and other deterministic issue cards.
- Recommended EQ Actions: frequency, gain, Q, confidence, and short rationale for each action.

Expert settings:

- Keep deterministic algorithm controls that directly affect detection and EQ advice.
- Remove ML toggles and any settings that imply cloud sharing, model scoring, companion output, or remote workflows.
- Prefer compact controls that can be scanned quickly during live sound work.

## Architecture

Keep the local DSP path:

1. `AudioAnalyzer` owns app state and coordinates microphone, settings, issues, and layout.
2. Web Audio captures microphone input locally.
3. The DSP worker computes FFT/spectrum and deterministic issue candidates.
4. Fusion and EQ advisor logic produce issue confidence and recommended EQ actions.
5. React components render the three-panel analyzer and expert settings.

Remove external/control paths from the architecture:

- No companion bridge, relay, proxy, mixer profile, or outbound command generation.
- No snapshot collector, upload queue, consent dialog, ingest route, or Supabase function.
- No geo lookup.
- No Sentry instrumentation.
- No ML inference engine or ONNX model loading.

## Component Plan

`components/analyzer/AudioAnalyzer.tsx` should stop mounting or passing:

- data collection state
- companion command bridge
- calibration/session export flows
- ring-out flow
- room measurement state

Analyzer layouts should be simplified so mobile and desktop both expose:

- spectrum
- issues
- EQ recommendations
- expert settings

Issue cards should stop offering companion/mixer send actions. They should focus on local explanation and recommendation.

Help/settings tabs should be rebuilt around the reduced product. Companion, data sharing, telemetry, ML, room measurement, and upload documentation should be removed from visible UI.

## DSP And Settings Plan

The worker and DSP modules should keep deterministic algorithms and remove ML/data-collection branches.

Remove:

- `MLInferenceEngine`
- model warmup and feature-vector plumbing
- `mlEnabled`
- ML weights and score fields
- snapshot collector messages
- user feedback messages intended for training or upload
- room-measurement worker messages

Keep:

- feedback detection
- spectral algorithms
- compression or stability detection where it directly improves local issue detection
- EQ advisor
- deterministic fusion
- local settings defaults and derived settings

The settings model should no longer include options that reference ML, data sharing, companion routing, upload consent, or external integrations.

## Dependency And File Removal

Remove dependencies that only support removed systems:

- `@companion-module/base`
- `@sentry/nextjs`
- `onnxruntime-web`

Remove generated, training, cloud, and integration assets when they have no local-only role:

- companion module build artifacts
- ONNX model files
- ML training/export scripts
- Supabase functions and migrations
- ingest and pipeline test scripts

Docs should be reduced to current local-only behavior. Historical archive docs can stay only if they do not confuse active development; active docs should not instruct users to configure cloud ingest, companion, Sentry, Supabase, ML models, or sharing.

## Tests And Verification

Required verification after implementation:

- `rg` proves runtime code has no companion, Supabase, ingest, geo, Sentry, ONNX, or ML inference paths.
- Package dependencies no longer include removed systems.
- Typecheck passes.
- Lint passes.
- Unit tests pass, after deleting or rewriting tests for removed systems.
- Production build passes.
- Browser smoke test shows the app loads to the simplified analyzer.
- Runtime network audit confirms the analyzer makes no external calls while using local microphone analysis.

Expected retained tests:

- deterministic DSP detection
- EQ advisor behavior
- settings default and derivation behavior
- issue rendering
- spectrum rendering
- local analyzer state flow

Expected removed or rewritten tests:

- companion tests
- ingest/geo/Supabase tests
- Sentry sample tests
- ML inference tests
- snapshot upload/research pipeline tests
- ring-out, room measurement, calibration export, and session export tests

## Git And Isolation Rules

Work stays on `local-only-experiment`.

Do not:

- push
- open a pull request
- fetch or sync unless the user explicitly asks
- change GitHub repository settings
- rewrite `main`
- merge into `main`

Local commits are allowed only as local checkpoints for this isolated experiment. The remote push URL is intentionally disabled.

## Success Criteria

The cleanup is complete when:

- The app presents only the simplified local analyzer experience.
- Removed systems are gone from runtime code, dependencies, tests, active docs, and app UI.
- The production build succeeds.
- Browser proof shows the simplified analyzer loads.
- A network audit shows no runtime external sharing or telemetry.
- The branch remains isolated and unpushed.
