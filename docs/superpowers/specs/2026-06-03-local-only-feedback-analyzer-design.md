# Local-Only Feedback Analyzer Design

## Goal

Slim DoneWell Audio down to a local-only feedback analysis app.

The app should do three things well:

- show a live microphone spectrum
- detect feedback or ringing issues
- recommend EQ actions for each issue

Everything unrelated to those jobs should be removed or reduced. The resulting app should not collect, upload, relay, or report user data.

## Local-Only Meaning

Local-only means the analyzer can be loaded from this cloned repo and can fetch its own static app assets, but analysis data stays on the machine running the browser.

Allowed:

- serving the app from `localhost` during development
- loading same-origin JavaScript, CSS, images, fonts, service-worker assets, and other static app files
- using browser local storage for user preferences
- running local tests, builds, and browser smoke checks

Not allowed:

- uploading audio, spectrum snapshots, advisories, errors, telemetry, or session data
- third-party runtime services for telemetry, replay, analytics, ingest, storage, model loading, or control relays
- GitHub pushes, pull requests, release actions, or upstream changes as part of this experiment
- relying on the original repository as a target for experimental changes

## Repository Isolation

This work is an experimental local fork in `/Volumes/M5/donewellaudio`.

The implementation must stay isolated:

- work on a local experiment branch, not upstream `main`
- do not push to GitHub
- do not open pull requests
- do not publish packages or release artifacts
- keep the original GitHub repository as a read/fetch source only unless the user later gives explicit approval
- keep any local commits clearly scoped to this clone and this experiment

## Current Audit Summary

The cloned repo currently includes several systems beyond local feedback analysis:

- Bitfocus Companion and mixer-control integration in `companion-module/`, `companion-module-dbx-driverack-pa2/`, `app/api/companion/*`, `hooks/useCompanion*`, `lib/companion/*`, `types/companion.ts`, UI send-to-mixer controls, docs, tests, and packaged zip artifacts.
- Spectral data collection in `hooks/useDataCollection.ts`, `components/analyzer/DataConsentDialog.tsx`, `lib/data/*`, `app/api/v1/ingest`, `app/api/geo`, Supabase functions and migrations, IndexedDB upload retry code, tests, scripts, and docs.
- ML/ONNX scoring in `lib/dsp/mlInference.ts`, `onnxruntime-web`, `public/models/*`, `scripts/ml/*`, `mlEnabled` settings, fusion weights, tests, and docs.
- Sentry telemetry and sample routes in `instrumentation*.ts`, `sentry.*.config.ts`, `@sentry/nextjs`, `app/sentry-example-*`, ErrorBoundary/reporting hooks, tests, and docs.
- Product/business and integration docs that describe removed cloud, Companion, data sharing, monetization, and training paths.

## Product Scope

Keep:

- local microphone analysis
- deterministic DSP detection algorithms: MSD, phase coherence, spectral flatness, comb pattern, IHR, and PTMR
- live spectrum/RTA visualization
- detected issue list
- EQ recommendation generation
- expert algorithm settings for deterministic algorithms
- local error alerts for microphone, browser, and worker failures

Remove:

- Companion, mixer-control, relay, and proxy behavior
- cloud data sharing, consent prompting, geo lookup, ingest API, Supabase storage, and upload retry queues
- ML/ONNX inference, model downloads, model assets, and training/export scripts
- Sentry client/server/edge telemetry, replay, hardcoded DSNs, and sample Sentry pages/routes
- room/ring-out/calibration/session-history/export flows that are not required for the simplified analyzer
- docs and tests that only cover removed systems

## Non-Goals

- No hardware mixer control.
- No Stream Deck or Companion workflow.
- No cloud upload of spectral snapshots.
- No analytics, telemetry, replay, or external error reporting.
- No ML model loading or training workflow.
- No monetization, account, team, or sharing features.

## Architecture

The simplified runtime pipeline is:

```text
Microphone
  -> Web Audio analyser
  -> deterministic DSP worker
  -> advisory state
  -> live spectrum + issue list + EQ recommendation UI
```

The DSP worker remains because it keeps heavy analysis off the UI thread. Its message contract should be reduced to local analysis concerns:

- initialize worker settings
- update detector settings
- process spectrum and peak frames
- publish tracks and advisories
- clear/reset local state
- report local worker errors

The worker should no longer support snapshot collection, ML warmup, model inference, Supabase upload preparation, or remote feedback labeling.

## UI Design

The first screen is the analyzer, not a landing page.

Required surfaces:

- header with app name, microphone/start control, compact analyzer status, and settings access
- main live spectrum/RTA with threshold line and active issue markers
- issue panel with frequency, pitch, severity, confidence, and EQ recommendation
- expert settings drawer for deterministic algorithm controls and tuning

Removed surfaces:

- Companion help tab
- send-to-mixer buttons
- data consent dialog
- data collection settings
- Sentry sample page
- ring-out wizard
- calibration recording flow
- session export/history panels
- room setup and measurement UI
- monetization and integration copy

## Settings Design

Keep a smaller settings model:

- sensitivity and input gain
- display preferences needed by the spectrum and issue list
- max displayed issues
- deterministic algorithm mode: auto or custom
- deterministic algorithm toggles: MSD, phase, spectral, comb, IHR, PTMR
- expert threshold, timing, noise-floor, and track-management controls

Remove these settings:

- `mlEnabled`
- `ml` as an algorithm key
- Companion pairing, auto-send, confidence, and relay settings
- data collection consent status
- calibration session recording settings
- room measurement and room template UI settings unless a specific internal detector dependency requires a narrow retained field

## Data Flow And Privacy Requirements

Audio and spectrum data stay in the browser runtime.

The analyzer must not:

- call `/api/v1/ingest`
- call `/api/geo`
- call `/api/companion/*`
- call Sentry endpoints
- load ONNX model files
- store pending upload batches in IndexedDB
- send advisory data to a cloud relay

Local storage may remain for local user preferences if it does not queue data for upload.

## Documentation Cleanup

Update current docs to describe only the local-only product:

- `README.md`
- `docs/SYSTEM_ARCHITECTURE.md`
- `docs/DEVELOPER_GUIDE.md`
- `docs/TECHNICAL_REFERENCE.md`
- `docs/API_DOCUMENTATION.md` if any local API remains
- `tests/README.md`

Remove current docs whose main subject is removed functionality. Archived historical docs may remain only if they are clearly outside the current product documentation set:

- Companion integration
- Supabase ingest
- data sharing
- ML training/export
- monetization
- external control
- historical archived audit plans that point future maintainers back into removed systems

## Testing And Verification

Implementation is complete only when these checks pass:

- `pnpm lint`
- `npx tsc --noEmit`
- `pnpm test`
- `pnpm build`

The repo also needs explicit removal audits:

```bash
rg -n "Companion|companion|Bitfocus|@companion-module|relay|send to mixer"
rg -n "Supabase|supabase|ingest|data collection|DataConsent|useDataCollection|/api/geo|x-vercel-ip-country"
rg -n "Sentry|sentry|NEXT_PUBLIC_SENTRY|captureException|replayIntegration"
rg -n "onnx|ONNX|mlInference|mlEnabled|dwa-fp-filter|public/models|scripts/ml"
```

Expected result: no live runtime references remain. Historical mentions may remain only if clearly isolated in deleted/archived material that is not part of the app, test, package, or current docs.

Browser smoke verification should confirm:

- the analyzer loads as the first screen
- microphone start works
- the live spectrum renders
- issue cards can show EQ recommendations from the local detector path
- startup network activity does not include removed endpoints or third-party telemetry

## Implementation Order

1. Remove external telemetry and cloud APIs: Sentry, ingest, geo, Supabase, and data collection.
2. Remove Companion modules, relay/proxy APIs, hooks, UI controls, docs, tests, and artifacts.
3. Remove ML/ONNX model loading, model assets, training scripts, settings, fusion weights, and tests.
4. Simplify settings and analyzer UI around live spectrum, issues, EQ recommendations, and expert deterministic controls.
5. Clean docs and package dependencies.
6. Run full verification and browser smoke tests.

## Success Criteria

The repo is successful when a maintainer can describe it as:

"A local browser-based feedback analyzer that uses microphone input to show a live spectrum, detect feedback, and recommend EQ cuts. It has no data sharing, no telemetry, no cloud relay, no hardware-control integration, and no ML model dependency."
