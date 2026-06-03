# Local-Only Feedback Analyzer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove companion, ML, data collection, sharing, telemetry, room measurement, ring-out, calibration export, and session export bloat so DoneWellAudio is a local-only analyzer with live spectrum, detected issues, recommended EQ actions, and expert deterministic settings.

**Architecture:** Keep the existing Web Audio and DSP worker path. First remove remote/control/collection contracts from app state and worker messages, then simplify the analyzer UI around spectrum, issues, EQ recommendations, and expert settings. Finish by deleting dead files, dependencies, docs/tests for removed systems, and proving the runtime makes no external calls.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, ESLint, Web Audio, Web Worker DSP, pnpm.

---

## File Structure

Core local analyzer files to keep and simplify:

- `components/analyzer/AudioAnalyzer.tsx`: root analyzer shell; remove data collection, consent, companion bridge, ring-out, calibration/session props.
- `components/analyzer/DesktopLayout.tsx`: desktop three-panel layout; remove wizard props and companion send path.
- `components/analyzer/MobileLayout.tsx`: mobile analyzer layout; remove wizard props and data/calibration props.
- `components/analyzer/IssuesList.tsx`, `components/analyzer/IssueCard.tsx`, `components/analyzer/IssueCardActions.tsx`: local issue and EQ action rendering; remove companion state, send-to-mixer, and training-label wording.
- `components/analyzer/settings/SettingsPanel.tsx`, `SetupTab.tsx`, `AdvancedTab.tsx`, `advancedSections/*`: keep live/setup/display/advanced deterministic controls; remove data collection, companion, calibration export, session export, room measurement, and ML toggle UI.
- `hooks/useAudioAnalyzer.ts`, `useAudioAnalyzerViewState.ts`, `useAnalyzerContextState.ts`, `useAnalyzerSessionEffects.ts`, `useDSPWorker.ts`, `dspWorkerTypes.ts`, `dspWorkerInternals.ts`: remove data collection, snapshot callbacks, user-feedback training, room measurement, and Sentry instrumentation from runtime contracts.
- `contexts/AudioAnalyzerContext.tsx`, `EngineContext.tsx`, `AdvisoryContext.tsx`, `audioAnalyzerContextValues.ts`: remove data collection, companion lifecycle, and room measurement from shared context.
- `lib/dsp/dspWorker.ts`, `workerFft.ts`, `fusionEngine.ts`, `classifier.ts`, `advisoryManager.ts`: remove ML and snapshot/room message handling while preserving deterministic scores, issue detection, and EQ advice.
- `types/advisory.ts`, `types/settings.ts`, `lib/settings/defaults.ts`, `deriveSettings.ts`, `seedLayeredSettings.ts`, `runtimeSettings.ts`: remove `mlEnabled` and `ml` algorithm support from current runtime types/settings.

Files and directories to delete when references are gone:

- `app/api/companion/`
- `app/api/v1/ingest/`
- `app/api/geo/`
- `app/api/sentry-example-api/`
- `app/sentry-example-page/`
- `components/analyzer/CompanionCommandBridge.tsx`
- `components/analyzer/DataConsentDialog.tsx`
- `components/analyzer/RingOutWizard.tsx`
- `components/analyzer/RingOutWizardSections.tsx`
- `components/analyzer/help/CompanionTab.tsx`
- `components/analyzer/settings/CalibrationTab.tsx`
- `components/analyzer/settings/SessionExportSection.tsx`
- `components/analyzer/settings/room/AutoDetectRoomSection.tsx`
- `hooks/useCompanion.ts`, `useCompanionInbound.ts`, `useCompanionModeSync.ts`
- `hooks/useDataCollection.ts`
- `hooks/useRingOutFlow.ts`, `useRingOutWizardState.ts`
- `hooks/useRoomMeasurement.ts`
- `hooks/useCalibrationSession.ts`, `useCalibrationTabState.ts`
- `lib/companion/`
- `lib/data/`
- `lib/dsp/mlInference.ts`
- `public/models/`
- `scripts/ml/`
- `scripts/generate-companion-doc.mjs`
- `scripts/test-ingest.mjs`
- `scripts/test-pipeline.mjs`
- `supabase/`
- `types/companion.ts`, `types/data.ts`, `types/onnxruntime-web.d.ts`
- `instrumentation.ts`, `instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`
- companion/data/ML/Sentry/ring-out/room/calibration/session-export tests

Package cleanup:

- Remove dependencies: `@sentry/nextjs`, `onnxruntime-web`.
- Remove devDependency: `@companion-module/base`.
- Remove scripts that only support deleted snapshot/research lanes: `audit:snapshots`, `audit:q`.

---

### Task 1: Baseline Safety And Failing Local-Only Audits

**Files:**
- Create: `scripts/verify-local-only.mjs`
- Modify: `package.json`

- [ ] **Step 1: Confirm branch and remote isolation**

Run:

```bash
git branch --show-current
git remote -v
git status -sb
```

Expected:

```text
local-only-experiment
origin  https://github.com/donwellsav/donewellaudio.git (fetch)
origin  DISABLED_DO_NOT_PUSH_LOCAL_EXPERIMENT (push)
## local-only-experiment
```

- [ ] **Step 2: Add a verifier that initially fails**

Create `scripts/verify-local-only.mjs`:

```js
#!/usr/bin/env node
import { execSync } from 'node:child_process'

const checks = [
  {
    name: 'runtime companion/control references',
    pattern: 'Companion|companion|@companion-module|send to mixer|sendToMixer|relay|pairingCode',
    paths: ['app', 'components', 'contexts', 'hooks', 'lib', 'types', 'tests'],
  },
  {
    name: 'runtime data sharing references',
    pattern: 'DataCollection|dataCollection|useDataCollection|SnapshotBatch|snapshotCollector|Supabase|supabase|ingest|/api/geo|geo/route|consent-to-upload',
    paths: ['app', 'components', 'contexts', 'hooks', 'lib', 'types', 'tests'],
  },
  {
    name: 'runtime telemetry references',
    pattern: 'Sentry|sentry|@sentry/nextjs|captureException|captureRequestError|NEXT_PUBLIC_SENTRY',
    paths: ['app', 'components', 'contexts', 'hooks', 'lib', 'types', 'tests', 'next.config.mjs'],
  },
  {
    name: 'runtime ML references',
    pattern: 'onnx|ONNX|onnxruntime|MLInference|mlInference|MLScoreResult|mlEnabled|dwa-fp-filter|public/models|scripts/ml',
    paths: ['app', 'components', 'contexts', 'hooks', 'lib', 'types', 'tests'],
  },
  {
    name: 'removed workflow references',
    pattern: 'RingOutWizard|ringOutFlow|useRingOut|RoomMeasurement|roomMeasurement|startRoomMeasurement|stopRoomMeasurement|CalibrationTab|SessionExport',
    paths: ['app', 'components', 'contexts', 'hooks', 'lib', 'types', 'tests'],
  },
]

let failed = false

for (const check of checks) {
  const command = ['rg', '-n', '--glob', '!docs/superpowers/**', check.pattern, ...check.paths].join(' ')
  let output = ''
  try {
    output = execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    if (error.status === 1) {
      console.log(`PASS ${check.name}`)
      continue
    }
    throw error
  }

  failed = true
  console.error(`FAIL ${check.name}`)
  console.error(output.trim())
}

if (failed) {
  process.exit(1)
}
```

- [ ] **Step 3: Wire the verifier**

Modify `package.json` scripts:

```json
{
  "audit:prod": "node scripts/audit-prod.mjs",
  "verify:local-only": "node scripts/verify-local-only.mjs",
  "dev": "next dev",
  "build": "next build --webpack",
  "start": "next start",
  "lint": "eslint .",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"
}
```

- [ ] **Step 4: Run verifier and confirm it fails before cleanup**

Run:

```bash
pnpm verify:local-only
```

Expected: FAIL entries for companion, data sharing, telemetry, ML, and removed workflow references.

- [ ] **Step 5: Commit baseline verifier**

Run:

```bash
git add package.json scripts/verify-local-only.mjs
git commit -m "test: add local-only verifier"
```

---

### Task 2: Remove Sentry Telemetry

**Files:**
- Delete: `instrumentation.ts`
- Delete: `instrumentation-client.ts`
- Delete: `sentry.server.config.ts`
- Delete: `sentry.edge.config.ts`
- Delete: `app/api/sentry-example-api/`
- Delete: `app/sentry-example-page/`
- Modify: `next.config.mjs`
- Modify: `app/global-error.tsx`
- Modify: `components/analyzer/ErrorBoundary.tsx`
- Modify: `hooks/useDSPWorker.ts`
- Modify: `hooks/dspWorkerInternals.ts`
- Modify: `package.json`

- [ ] **Step 1: Remove Sentry dependency and config wrapper**

In `next.config.mjs`, remove:

```js
import { withSentryConfig } from "@sentry/nextjs";
```

Replace the exported config block with:

```js
export default wrappedConfig
```

Delete Sentry-specific config options from that file.

- [ ] **Step 2: Convert global error handling to local console-only reporting**

In `app/global-error.tsx`, remove the Sentry import and replace the effect body with:

```tsx
useEffect(() => {
  console.error(error)
}, [error])
```

- [ ] **Step 3: Convert analyzer error boundary to local console-only reporting**

In `components/analyzer/ErrorBoundary.tsx`, remove the Sentry import and replace Sentry capture code with:

```tsx
console.error('[DWA] Analyzer render error', error, errorInfo)
```

- [ ] **Step 4: Remove Sentry breadcrumbs/tags from worker hook**

In `hooks/useDSPWorker.ts`, delete:

```ts
import * as Sentry from '@sentry/nextjs'
```

Delete the `Sentry.addBreadcrumb`, `Sentry.setTag`, and `Sentry.setContext` calls inside `init`.

In `hooks/dspWorkerInternals.ts`, delete the Sentry import and delete the `Sentry.addBreadcrumb` call in the `'ready'` message handler.

- [ ] **Step 5: Delete Sentry-only files and route**

Run:

```bash
rm -rf instrumentation.ts instrumentation-client.ts sentry.server.config.ts sentry.edge.config.ts app/api/sentry-example-api app/sentry-example-page
```

- [ ] **Step 6: Remove Sentry dependency**

Run:

```bash
pnpm remove @sentry/nextjs
```

- [ ] **Step 7: Verify telemetry references are gone from runtime**

Run:

```bash
rg -n --glob '!docs/superpowers/**' 'Sentry|sentry|@sentry/nextjs|captureException|captureRequestError|NEXT_PUBLIC_SENTRY' app components contexts hooks lib types tests next.config.mjs
```

Expected: no output.

- [ ] **Step 8: Commit telemetry removal**

Run:

```bash
git add -A
git commit -m "refactor: remove sentry telemetry"
```

---

### Task 3: Remove Data Collection, Ingest, Geo, And Supabase Contracts

**Files:**
- Delete: `app/api/v1/ingest/`
- Delete: `app/api/geo/`
- Delete: `lib/data/`
- Delete: `types/data.ts`
- Delete: `hooks/useDataCollection.ts`
- Delete: `components/analyzer/DataConsentDialog.tsx`
- Delete: `supabase/`
- Delete: `scripts/test-ingest.mjs`
- Delete: `scripts/test-pipeline.mjs`
- Modify: `components/analyzer/AudioAnalyzer.tsx`
- Modify: `contexts/AudioAnalyzerContext.tsx`
- Modify: `hooks/useAnalyzerContextState.ts`
- Modify: `hooks/useAudioAnalyzer.ts`
- Modify: `hooks/useAudioAnalyzerViewState.ts`
- Modify: `hooks/useAnalyzerSessionEffects.ts`
- Modify: `hooks/useDSPWorker.ts`
- Modify: `hooks/dspWorkerTypes.ts`
- Modify: `hooks/dspWorkerInternals.ts`
- Modify: `lib/dsp/dspWorker.ts`

- [ ] **Step 1: Remove data collection from analyzer root**

In `components/analyzer/AudioAnalyzer.tsx`, remove these imports:

```ts
import type { DataCollectionHandle } from '@/hooks/useDataCollection'
import { DataConsentDialog } from './DataConsentDialog'
import { useDataCollection } from '@/hooks/useDataCollection'
```

Remove this line:

```ts
const dataCollection = useDataCollection()
```

Change provider usage to:

```tsx
<AudioAnalyzerProvider frozenRef={frozenRef}>
  <AudioAnalyzerInner
    rootRef={rootRef}
    rootEl={rootEl}
    frozenRef={frozenRef}
  />
</AudioAnalyzerProvider>
```

Remove the `<DataConsentDialog ... />` block.

- [ ] **Step 2: Remove data collection props from analyzer root types**

In `components/analyzer/AudioAnalyzer.tsx`, change `AudioAnalyzerInnerProps` to:

```ts
interface AudioAnalyzerInnerProps {
  rootRef: React.RefObject<HTMLDivElement | null>
  rootEl: HTMLDivElement | null
  frozenRef: React.RefObject<boolean>
}
```

Change the hook call to:

```ts
} = useAudioAnalyzerViewState()
```

Remove `dataCollection={dataCollectionTabProps}` from `MobileLayout` and `DesktopLayout`.

- [ ] **Step 3: Remove data collection from provider and analyzer state**

In `contexts/AudioAnalyzerContext.tsx`, delete the `DataCollectionHandle` import and change props to:

```ts
interface AudioAnalyzerProviderProps {
  frozenRef?: React.RefObject<boolean>
  children: ReactNode
}
```

Change state creation to:

```ts
const state = useAnalyzerContextState({ frozenRef })
```

In `hooks/useAnalyzerContextState.ts`, remove `dataCollection` from the hook input and remove the `onSnapshotBatch` callback passed to `useAudioAnalyzer`.

- [ ] **Step 4: Remove snapshot callbacks from `useAudioAnalyzer`**

In `hooks/useAudioAnalyzer.ts`, delete `SnapshotBatch` import and change signature to:

```ts
export function useAudioAnalyzer(
  initialSettings: Partial<DetectorSettings> = {},
  frozenRef?: React.RefObject<boolean>,
): UseAudioAnalyzerReturn {
```

Remove `externalCallbacksRef` and the `onSnapshotBatch` callback entry from `stableCallbacks`.

- [ ] **Step 5: Remove data collection from analyzer side effects**

In `hooks/useAudioAnalyzerViewState.ts`, delete `DataCollectionHandle` and `DataCollectionTabProps` imports. Change:

```ts
export function useAudioAnalyzerViewState() {
```

Remove `dataCollection` and `dataCollectionTabProps` from `useAnalyzerSessionEffects` and the return value.

In `hooks/useAnalyzerSessionEffects.ts`, remove `DataCollectionHandle` import, remove `dataCollection` from props, and delete the consent prompt effect. Keep local history syncing only if it does not call upload or worker collection APIs.

- [ ] **Step 6: Remove collection message API from DSP worker hook**

In `hooks/dspWorkerTypes.ts`, remove:

```ts
import type { SnapshotBatch } from '@/types/data'
onSnapshotBatch?: (batch: SnapshotBatch) => void
enableCollection: (sessionId: string, fftSize: number, sampleRate: number) => void
disableCollection: () => void
```

Delete `PendingCollectionRequest`.

In `hooks/useDSPWorker.ts`, remove `pendingCollectionRef`, `enableCollection`, and `disableCollection` from refs, callbacks, return object, and dependency list.

In `hooks/dspWorkerInternals.ts`, remove `PendingCollectionRequest`, `pendingCollectionRef`, `replayPendingCollection`, `snapshotBatch` handling, and calls to replay collection.

- [ ] **Step 7: Remove snapshot message handling from worker**

In `lib/dsp/dspWorker.ts`, remove these imports:

```ts
import type { SnapshotWorkerInbound, SnapshotWorkerOutbound, MarkerAlgorithmScores, UserFeedback } from '@/types/data'
import { SnapshotCollector } from '@/lib/data/snapshotCollector'
```

Remove `SnapshotWorkerInbound` and `SnapshotWorkerOutbound` from worker message unions. Delete `snapshotCollector` state and switch cases for `enableCollection`, `disableCollection`, and `getSnapshotBatch`.

Where marker score objects existed only to feed snapshots, delete that code instead of replacing it.

- [ ] **Step 8: Delete collection files**

Run:

```bash
rm -rf app/api/v1/ingest app/api/geo lib/data hooks/useDataCollection.ts components/analyzer/DataConsentDialog.tsx supabase scripts/test-ingest.mjs scripts/test-pipeline.mjs types/data.ts
```

- [ ] **Step 9: Verify data sharing references are gone from runtime**

Run:

```bash
rg -n --glob '!docs/superpowers/**' 'DataCollection|dataCollection|useDataCollection|SnapshotBatch|snapshotCollector|Supabase|supabase|ingest|/api/geo|geo/route|consent-to-upload' app components contexts hooks lib types tests
```

Expected: no runtime references. Test/docs references that fail this check must be deleted or rewritten in later tasks.

- [ ] **Step 10: Commit data collection removal**

Run:

```bash
git add -A
git commit -m "refactor: remove data collection and ingest"
```

---

### Task 4: Remove Companion, Mixer Control, Relay, And Command Bridge

**Files:**
- Delete: `app/api/companion/`
- Delete: `companion-module/`
- Delete: `companion-module-dbx-driverack-pa2/`
- Delete: `lib/companion/`
- Delete: `types/companion.ts`
- Delete: `hooks/useCompanion.ts`, `hooks/useCompanionInbound.ts`, `hooks/useCompanionModeSync.ts`
- Delete: `components/analyzer/CompanionCommandBridge.tsx`
- Delete: `components/analyzer/help/CompanionTab.tsx`
- Delete: `scripts/generate-companion-doc.mjs`
- Modify: `components/analyzer/AudioAnalyzer.tsx`
- Modify: `contexts/AdvisoryContext.tsx`
- Modify: `components/analyzer/IssueCard.tsx`
- Modify: `components/analyzer/IssueCardActions.tsx`
- Modify: `components/analyzer/IssuesList.tsx`
- Modify: `components/analyzer/DesktopLayout.tsx`
- Modify: `components/analyzer/MobileLayout.tsx`
- Modify: `package.json`

- [ ] **Step 1: Remove command bridge mount**

In `components/analyzer/AudioAnalyzer.tsx`, delete:

```ts
import { CompanionCommandBridge } from '@/components/analyzer/CompanionCommandBridge'
```

Delete:

```tsx
<CompanionCommandBridge
  onRingoutStart={ringOutFlow.startRingOut}
  onRingoutStop={ringOutFlow.finishWizard}
/>
```

- [ ] **Step 2: Reduce `AdvisoryContext` to local issue actions**

In `contexts/AdvisoryContext.tsx`, remove `useCompanion` import and all `CompanionAdvisoryState`, bridge state, retry lifecycle, sendResolve/sendDismiss, and companion patch APIs.

The context value should keep local actions only:

```ts
interface AdvisoryContextValue {
  onFalsePositive?: (advisoryId: string) => void
  falsePositiveIds: ReadonlySet<string>
  onConfirmFeedback?: (advisoryId: string) => void
  confirmedIds: ReadonlySet<string>
  onDismiss: (advisoryId: string) => void
  onClearAll: () => void
}
```

If local false-positive/confirm actions still call worker training feedback, remove them in Task 6. Until then they must not call companion.

- [ ] **Step 3: Remove send-to-mixer UI**

In `components/analyzer/IssueCardActions.tsx`, remove:

```ts
onSendToMixer?: () => void
const SEND_DESKTOP = ...
const SEND_MOBILE = ...
```

Delete both `SEND` button blocks. Keep copy and dismiss actions.

- [ ] **Step 4: Remove companion state from issue cards**

In `components/analyzer/IssueCard.tsx`, delete:

```ts
import type { CompanionAdvisoryState } from '@/contexts/AdvisoryContext'
onSendToMixer?: (advisory: Advisory) => void
companionState?: CompanionAdvisoryState
```

Remove all `companionState?.applied`, `partialApply`, `partialClear`, failed, retry, and lifecycle badge blocks. Remove `handleSendToMixer` from `useIssueCardState` destructuring and input.

- [ ] **Step 5: Remove companion props from issue lists and layouts**

In `components/analyzer/IssuesList.tsx`, remove props and calls related to `onSendToMixer`, companion state maps, retry, and clear lifecycle.

In `components/analyzer/DesktopLayout.tsx` and `components/analyzer/MobileLayout.tsx`, remove `onStartRingOut` from `issuesListBaseProps` because it exists to trigger wizard/control workflows.

- [ ] **Step 6: Delete companion files**

Run:

```bash
rm -rf app/api/companion companion-module companion-module-dbx-driverack-pa2 lib/companion types/companion.ts hooks/useCompanion.ts hooks/useCompanionInbound.ts hooks/useCompanionModeSync.ts components/analyzer/CompanionCommandBridge.tsx components/analyzer/help/CompanionTab.tsx scripts/generate-companion-doc.mjs tests/companion-module
```

- [ ] **Step 7: Remove companion dependency**

Run:

```bash
pnpm remove -D @companion-module/base
```

- [ ] **Step 8: Verify companion references are gone from runtime**

Run:

```bash
rg -n --glob '!docs/superpowers/**' 'Companion|companion|@companion-module|send to mixer|sendToMixer|relay|pairingCode' app components contexts hooks lib types tests
```

Expected: no output.

- [ ] **Step 9: Commit companion removal**

Run:

```bash
git add -A
git commit -m "refactor: remove companion integration"
```

---

### Task 5: Remove Ring-Out, Room Measurement, Calibration Export, And Session Export

**Files:**
- Delete: `components/analyzer/RingOutWizard.tsx`
- Delete: `components/analyzer/RingOutWizardSections.tsx`
- Delete: `hooks/useRingOutFlow.ts`
- Delete: `hooks/useRingOutWizardState.ts`
- Delete: `hooks/useRoomMeasurement.ts`
- Delete: `components/analyzer/settings/CalibrationTab.tsx`
- Delete: `components/analyzer/settings/calibration/`
- Delete: `components/analyzer/settings/room/AutoDetectRoomSection.tsx`
- Delete: `components/analyzer/settings/SessionExportSection.tsx`
- Delete: `hooks/useCalibrationSession.ts`
- Delete: `hooks/useCalibrationTabState.ts`
- Modify: `components/analyzer/AudioAnalyzer.tsx`
- Modify: `components/analyzer/DesktopIssuesContent.tsx`
- Modify: `components/analyzer/MobileIssuesContent.tsx`
- Modify: `components/analyzer/DesktopLayout.tsx`
- Modify: `components/analyzer/MobileLayout.tsx`
- Modify: `components/analyzer/settings/SetupTab.tsx`
- Modify: `contexts/EngineContext.tsx`
- Modify: `contexts/AudioAnalyzerContext.tsx`
- Modify: `contexts/audioAnalyzerContextValues.ts`
- Modify: `hooks/useAudioAnalyzer.ts`
- Modify: `hooks/useAudioAnalyzerViewState.ts`
- Modify: `hooks/useDSPWorker.ts`
- Modify: `hooks/dspWorkerTypes.ts`
- Modify: `hooks/dspWorkerInternals.ts`
- Modify: `lib/dsp/dspWorker.ts`

- [ ] **Step 1: Remove ring-out state from analyzer view state**

In `hooks/useAudioAnalyzerViewState.ts`, delete imports and calls for `useCalibrationSession` and `useRingOutFlow`. Remove returned `ringOutFlow` and `calibrationTabProps`.

The return shape should include:

```ts
return {
  isRunning,
  error,
  workerError,
  isWorkerPermanentlyDead: dspWorker.isPermanentlyDead,
  actualFps,
  droppedPercent,
  shellState,
  advisoryFeedback,
}
```

- [ ] **Step 2: Remove wizard/calibration props from analyzer root**

In `components/analyzer/AudioAnalyzer.tsx`, remove all `ringOutFlow`, `calibrationTabProps`, `isWizardActive`, `onStartWizard`, `onFinishWizard`, and `onStartRingOut` props passed to layouts.

- [ ] **Step 3: Remove wizard props from layouts and issue content**

In `components/analyzer/DesktopLayout.tsx` and `components/analyzer/MobileLayout.tsx`, remove props:

```ts
isWizardActive?: boolean
onStartWizard?: () => void
onFinishWizard?: () => void
onStartRingOut?: () => void
calibration?: Omit<CalibrationTabProps, 'settings'>
```

Remove `showStartWizardButton`, wizard props to `DesktopIssuesContent`, and wizard props to `MobileIssuesContent`.

In `DesktopIssuesContent.tsx` and `MobileIssuesContent.tsx`, remove wizard button/rendering branches.

- [ ] **Step 4: Remove room measurement from engine context**

In `contexts/EngineContext.tsx`, delete:

```ts
roomEstimate
roomMeasuring
roomProgress
startRoomMeasurement
stopRoomMeasurement
clearRoomEstimate
```

Remove the same fields from `contexts/audioAnalyzerContextValues.ts` and `contexts/AudioAnalyzerContext.tsx`.

- [ ] **Step 5: Remove room measurement from `useAudioAnalyzer` and worker**

In `hooks/useAudioAnalyzer.ts`, delete `RoomDimensionEstimate` and `useRoomMeasurement` imports, room measurement state, callbacks, and return fields.

In `hooks/dspWorkerTypes.ts`, remove:

```ts
onRoomEstimate?: ...
onRoomMeasurementProgress?: ...
startRoomMeasurement: () => void
stopRoomMeasurement: () => void
```

In `hooks/useDSPWorker.ts`, delete `startRoomMeasurement` and `stopRoomMeasurement` callbacks and return fields.

In `hooks/dspWorkerInternals.ts`, delete `roomEstimate` and `roomMeasurementProgress` message handling.

In `lib/dsp/dspWorker.ts`, delete room measurement message types, state, imports, and switch cases.

- [ ] **Step 6: Remove calibration/session export from setup**

In `components/analyzer/settings/SetupTab.tsx`, remove imports and rendering for:

```ts
CalibrationTab
SessionExportSection
useSetupTabExport
```

Keep `RoomTab` only if it remains a local deterministic room-physics setting panel. Remove `AutoDetectRoomSection` from `RoomTab` if it references measurement worker actions.

- [ ] **Step 7: Delete removed workflow files**

Run:

```bash
rm -rf components/analyzer/RingOutWizard.tsx components/analyzer/RingOutWizardSections.tsx hooks/useRingOutFlow.ts hooks/useRingOutWizardState.ts hooks/useRoomMeasurement.ts components/analyzer/settings/CalibrationTab.tsx components/analyzer/settings/calibration components/analyzer/settings/room/AutoDetectRoomSection.tsx components/analyzer/settings/SessionExportSection.tsx hooks/useCalibrationSession.ts hooks/useCalibrationTabState.ts
```

- [ ] **Step 8: Verify removed workflow references are gone from runtime**

Run:

```bash
rg -n --glob '!docs/superpowers/**' 'RingOutWizard|ringOutFlow|useRingOut|RoomMeasurement|roomMeasurement|startRoomMeasurement|stopRoomMeasurement|CalibrationTab|SessionExport' app components contexts hooks lib types tests
```

Expected: no output.

- [ ] **Step 9: Commit workflow simplification**

Run:

```bash
git add -A
git commit -m "refactor: remove nonlocal analyzer workflows"
```

---

### Task 6: Remove ML/ONNX From DSP, Settings, And Tests

**Files:**
- Delete: `lib/dsp/mlInference.ts`
- Delete: `lib/dsp/__tests__/mlInference.test.ts`
- Delete: `public/models/`
- Delete: `scripts/ml/`
- Delete: `types/onnxruntime-web.d.ts`
- Modify: `lib/dsp/workerFft.ts`
- Modify: `lib/dsp/fusionEngine.ts`
- Modify: `lib/dsp/dspWorker.ts`
- Modify: `lib/dsp/classifier.ts`
- Modify: `types/advisory.ts`
- Modify: `types/settings.ts`
- Modify: `lib/settings/defaults.ts`
- Modify: `lib/settings/deriveSettings.ts`
- Modify: `lib/settings/seedLayeredSettings.ts`
- Modify: `lib/settings/runtimeSettings.ts`
- Modify: `components/analyzer/settings/advancedSections/AdvancedDetectionSections.tsx`
- Modify: `hooks/useAdvancedTabState.ts`
- Modify: `tests/helpers/mockAlgorithmScores.ts`
- Modify: `lib/dsp/__tests__/algorithmFusion.test.ts`
- Modify: `tests/dsp/algorithmFusion.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Remove ML type exports and algorithm key**

In `types/advisory.ts`, change:

```ts
export type { AlgorithmScores, FusedDetectionResult, InterHarmonicResult, PTMRResult } from '@/lib/dsp/advancedDetection'
export type Algorithm = 'msd' | 'phase' | 'spectral' | 'comb' | 'ihr' | 'ptmr'
```

Remove `mlEnabled` from `DetectorSettings`.

Remove `ml` from `Advisory.algorithmScores`.

- [ ] **Step 2: Remove ML from fusion engine**

In `lib/dsp/fusionEngine.ts`, delete `MLScoreResult`, remove `ml` from `AlgorithmScores`, `FusionConfig`, `FusionRuntimeSettings`, `_weights`, `_ALL_ALGORITHMS`, and every `FUSION_WEIGHTS` preset.

Use six-algorithm weights that sum to `1`:

```ts
export const FUSION_WEIGHTS = {
  DEFAULT: { msd: 0.30, phase: 0.26, spectral: 0.12, comb: 0.08, ihr: 0.13, ptmr: 0.11 },
  SPEECH: { msd: 0.33, phase: 0.24, spectral: 0.10, comb: 0.04, ihr: 0.10, ptmr: 0.19 },
  MUSIC: { msd: 0.08, phase: 0.36, spectral: 0.10, comb: 0.08, ihr: 0.25, ptmr: 0.15 },
  COMPRESSED: { msd: 0.12, phase: 0.30, spectral: 0.18, comb: 0.08, ihr: 0.18, ptmr: 0.14 },
} as const
```

Delete the ML scoring branch in `fuseAlgorithmResults`.

- [ ] **Step 3: Remove ML inference from worker FFT engine**

In `lib/dsp/workerFft.ts`, delete:

```ts
import { MLInferenceEngine } from './mlInference'
private _mlEngine = new MLInferenceEngine()
```

Delete model warmup, feature vector, cached ML result, and reset/recreate code. Build `algorithmScores` without `ml`:

```ts
const algorithmScores: AlgorithmScores = {
  msd: msdResult,
  phase: phaseResult,
  spectral: spectralResult,
  comb: combResult,
  compression: compressionResult,
  ihr: ihrResult,
  ptmr: ptmrResult,
}
```

- [ ] **Step 4: Remove ML from settings**

In `lib/settings/defaults.ts`, `types/settings.ts`, `lib/settings/deriveSettings.ts`, `lib/settings/seedLayeredSettings.ts`, and `lib/settings/runtimeSettings.ts`, remove `mlEnabled`.

In `components/analyzer/settings/advancedSections/AdvancedDetectionSections.tsx`, delete the ML toggle UI.

In `hooks/useAdvancedTabState.ts`, ensure algorithm toggles only accept:

```ts
const LOCAL_ALGORITHMS: Algorithm[] = ['msd', 'phase', 'spectral', 'comb', 'ihr', 'ptmr']
```

- [ ] **Step 5: Remove ML from advisory score displays and tests**

In `components/analyzer/IssueCard.tsx`, remove display of `algorithmScores.ml`.

In `tests/helpers/mockAlgorithmScores.ts`, remove `ml` from builders.

Update fusion tests by removing ML expectations and keeping six-weight sum assertions.

- [ ] **Step 6: Delete ML assets and dependency**

Run:

```bash
rm -rf lib/dsp/mlInference.ts lib/dsp/__tests__/mlInference.test.ts public/models scripts/ml types/onnxruntime-web.d.ts
pnpm remove onnxruntime-web
```

- [ ] **Step 7: Verify ML references are gone from runtime**

Run:

```bash
rg -n --glob '!docs/superpowers/**' 'onnx|ONNX|onnxruntime|MLInference|mlInference|MLScoreResult|mlEnabled|dwa-fp-filter|public/models|scripts/ml' app components contexts hooks lib types tests
```

Expected: no output.

- [ ] **Step 8: Commit ML removal**

Run:

```bash
git add -A
git commit -m "refactor: remove ml inference"
```

---

### Task 7: Simplify Analyzer UI To Spectrum, Issues, EQ Actions, And Expert Settings

**Files:**
- Modify: `components/analyzer/DesktopLayout.tsx`
- Modify: `components/analyzer/MobileLayout.tsx`
- Modify: `components/analyzer/DesktopIssuesContent.tsx`
- Modify: `components/analyzer/MobileIssuesContent.tsx`
- Modify: `components/analyzer/IssuesEmptyState.tsx`
- Modify: `components/analyzer/IssuesList.tsx`
- Modify: `components/analyzer/IssueCard.tsx`
- Modify: `components/analyzer/IssueCardActions.tsx`
- Modify: `components/analyzer/help/GuideTab.tsx`
- Modify: `components/analyzer/help/AlgorithmsTab.tsx`
- Modify: `components/analyzer/help/ModesTab.tsx`
- Modify: `components/analyzer/settings/SettingsPanel.tsx`
- Modify: `components/analyzer/settings/AdvancedTab.tsx`
- Modify: `components/analyzer/settings/SetupTab.tsx`

- [ ] **Step 1: Rename UI sections around the reduced product**

Use visible labels:

```text
Live Spectrum
Detected Issues
Recommended EQ
Expert
```

Do not add explanatory marketing copy. The first screen remains the analyzer.

- [ ] **Step 2: Keep issue cards local**

In `IssueCardActions.tsx`, the available actions should be:

```tsx
copy
dismiss
confirm local issue
mark local miss/false alert only if it does not call worker training APIs
```

Any label that says "training label" must be replaced with local wording:

```text
Mark as false alert
Confirm feedback
```

- [ ] **Step 3: Make recommended EQ action the main issue-card payload**

In `IssueCard.tsx`, keep display of:

```text
frequency
pitch
severity
confidence
PEQ type
gain dB
Q
reason
```

Remove companion lifecycle badges and any upload/training language.

- [ ] **Step 4: Keep compact expert settings**

In `AdvancedTab.tsx`, render only deterministic local controls:

```tsx
<AdvancedFaderLinkSection settings={settings} actions={actions} />
<AdvancedDetectionPolicySection settings={settings} actions={actions} />
<AdvancedTimingSection settings={settings} actions={actions} />
<AdvancedAlgorithmsSection settings={settings} actions={actions} />
<AdvancedNoiseFloorSection settings={settings} actions={actions} />
<AdvancedPeakDetectionSection settings={settings} actions={actions} />
<AdvancedTrackManagementSection settings={settings} actions={actions} />
<AdvancedDspSection settings={settings} actions={actions} />
```

Do not render integration or data collection sections.

- [ ] **Step 5: Verify visible removed language is gone**

Run:

```bash
rg -n --glob '!docs/superpowers/**' 'training label|send to mixer|Companion|data collection|upload|Sentry|ML|model|ring out|room measurement|calibration export|session export' components app
```

Expected: no output except local algorithm words that are not ML/model references.

- [ ] **Step 6: Commit UI simplification**

Run:

```bash
git add -A
git commit -m "refactor: simplify analyzer interface"
```

---

### Task 8: Delete Or Rewrite Tests For Removed Systems

**Files:**
- Delete: `app/api/companion/**/__tests__/`
- Delete: `app/api/v1/ingest/**/__tests__/`
- Delete: `app/api/geo/**/__tests__/`
- Delete: `app/api/sentry-example-api/**/__tests__/`
- Delete: `components/analyzer/__tests__/CompanionCommandBridge.test.tsx`
- Delete: `components/analyzer/__tests__/AutoDetectRoomSection.test.tsx`
- Delete: `components/analyzer/__tests__/RingOutWizardSections.test.tsx`
- Delete: `hooks/__tests__/useCompanion.test.ts`
- Delete: `hooks/__tests__/useCompanionModeSync.test.ts`
- Delete: `hooks/__tests__/useRingOutWizardState.test.ts`
- Delete: `hooks/__tests__/useRoomMeasurement.test.ts`
- Delete: `hooks/__tests__/useCalibrationSession.test.ts`
- Modify: `hooks/__tests__/useDSPWorker.test.ts`
- Modify: `hooks/__tests__/useAdvancedTabState.test.ts`
- Modify: `hooks/__tests__/useLayeredSettings.test.ts`
- Modify: `contexts/__tests__/AdvisoryContext.test.ts`
- Modify: analyzer issue/settings tests that still assert removed UI.

- [ ] **Step 1: Delete tests for removed files**

Run:

```bash
rm -rf app/api/companion app/api/v1/ingest app/api/geo app/api/sentry-example-api components/analyzer/__tests__/CompanionCommandBridge.test.tsx components/analyzer/__tests__/AutoDetectRoomSection.test.tsx components/analyzer/__tests__/RingOutWizardSections.test.tsx hooks/__tests__/useCompanion.test.ts hooks/__tests__/useCompanionModeSync.test.ts hooks/__tests__/useRingOutWizardState.test.ts hooks/__tests__/useRoomMeasurement.test.ts hooks/__tests__/useCalibrationSession.test.ts
```

- [ ] **Step 2: Update worker hook tests**

In `hooks/__tests__/useDSPWorker.test.ts`, remove cases for:

```text
enableCollection
disableCollection
syncFeedbackHistory
sendUserFeedback
startRoomMeasurement
stopRoomMeasurement
```

Keep tests for:

```text
init
processPeak
spectrumUpdate
clearPeak
reset
worker restart/error handling
```

- [ ] **Step 3: Update settings tests**

Remove `mlEnabled` assertions from:

```text
hooks/__tests__/useAdvancedTabState.test.ts
hooks/__tests__/useLayeredSettings.test.ts
lib/settings/__tests__/deriveSettings.test.ts
components/analyzer/__tests__/SettingsDefaultsAlignment.test.tsx
```

- [ ] **Step 4: Update advisory context tests**

In `contexts/__tests__/AdvisoryContext.test.ts`, remove companion mocks and companion lifecycle tests. Keep local dismiss and clear-all behavior tests.

- [ ] **Step 5: Run targeted tests and fix failures**

Run:

```bash
pnpm test hooks/__tests__/useDSPWorker.test.ts hooks/__tests__/useAdvancedTabState.test.ts hooks/__tests__/useLayeredSettings.test.ts contexts/__tests__/AdvisoryContext.test.ts components/analyzer/__tests__/IssueCard.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit test cleanup**

Run:

```bash
git add -A
git commit -m "test: remove external workflow coverage"
```

---

### Task 9: Clean Active Docs And Package Scripts

**Files:**
- Modify: `README.md`
- Modify: `docs/SYSTEM_ARCHITECTURE.md`
- Modify: `docs/DEVELOPER_GUIDE.md`
- Modify: `docs/TECHNICAL_REFERENCE.md`
- Modify: `docs/API_DOCUMENTATION.md`
- Modify: `docs/INTEGRATIONS.md`
- Modify: `docs/KNOWN_ISSUES.md`
- Modify: `tests/README.md`
- Modify: `package.json`
- Optional delete: active docs whose main subject is removed behavior.

- [ ] **Step 1: Rewrite README summary**

The README top summary should say:

```md
DoneWellAudio is a local browser-based feedback analyzer. It uses microphone input to render a live spectrum, detect likely feedback issues with deterministic DSP, and recommend EQ actions. It does not upload analyzer data, use telemetry, control external mixers, or load ML models.
```

- [ ] **Step 2: Remove active docs for removed behavior**

Delete active docs whose main subject is removed behavior:

```bash
rm -f docs/INTEGRATIONS.md docs/MONETIZATION.md docs/PA2-AUTO-NOTCH-FLOW.md
```

Rewrite remaining active docs to describe only local analyzer runtime, local DSP, local storage settings, tests, and build workflow.

- [ ] **Step 3: Remove snapshot audit scripts**

In `package.json`, ensure scripts are:

```json
{
  "audit:prod": "node scripts/audit-prod.mjs",
  "verify:local-only": "node scripts/verify-local-only.mjs",
  "dev": "next dev",
  "build": "next build --webpack",
  "start": "next start",
  "lint": "eslint .",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"
}
```

- [ ] **Step 4: Verify active docs do not point users to removed systems**

Run:

```bash
rg -n 'Companion|companion|Supabase|supabase|Sentry|sentry|ONNX|onnx|ML model|data collection|ingest|geo lookup|mixer control|session export|calibration export' README.md docs tests/README.md package.json
```

Expected: references may remain only in `docs/superpowers/specs/*` and historical `docs/archive/*`. Active docs should not contain instructions for removed systems.

- [ ] **Step 5: Commit docs cleanup**

Run:

```bash
git add -A
git commit -m "docs: describe local-only analyzer"
```

---

### Task 10: Full Verification, Browser Proof, And Final Local Checkpoint

**Files:**
- Modify as needed based on verification failures.

- [ ] **Step 1: Run local-only verifier**

Run:

```bash
pnpm verify:local-only
```

Expected:

```text
PASS runtime companion/control references
PASS runtime data sharing references
PASS runtime telemetry references
PASS runtime ML references
PASS removed workflow references
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
npx tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 3: Run lint**

Run:

```bash
pnpm lint
```

Expected: no ESLint errors.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm test
```

Expected: all retained tests pass.

- [ ] **Step 5: Run production build**

Run:

```bash
pnpm build
```

Expected: Next.js production build succeeds without Sentry, ONNX, companion, ingest, or Supabase output.

- [ ] **Step 6: Start local app**

Run:

```bash
pnpm dev
```

Expected: local dev server starts and prints a localhost URL.

- [ ] **Step 7: Browser smoke**

Open the local URL in the in-app browser and verify:

```text
Analyzer is the first screen.
Live spectrum area is visible.
Detected issues panel is visible.
Recommended EQ/action content is visible when issues exist.
Expert settings are visible.
No companion, upload, telemetry, ML, ring-out, room measurement, calibration export, or session export UI is visible.
```

- [ ] **Step 8: Runtime network audit**

Use browser devtools or Playwright request capture while loading and starting the analyzer. Expected external network calls:

```text
none
```

Same-origin static app files are allowed. Calls to Sentry, Supabase, ingest, geo, companion relay/proxy, ONNX model files, or third-party telemetry are failures.

- [ ] **Step 9: Final git isolation check**

Run:

```bash
git branch --show-current
git remote -v
git status -sb
git log --oneline --decorate -8
```

Expected:

```text
local-only-experiment
origin  https://github.com/donwellsav/donewellaudio.git (fetch)
origin  DISABLED_DO_NOT_PUSH_LOCAL_EXPERIMENT (push)
```

No push, PR, fetch/sync, merge, or `main` rewrite occurred.

- [ ] **Step 10: Commit final verification fixes**

Run only if verification fixes changed files:

```bash
git add -A
git commit -m "chore: verify local-only analyzer"
```

---

## Self-Review Checklist

- Spec coverage: companion, data collection, sharing, Supabase, Sentry, ML, room measurement, ring-out, calibration export, session export, docs, tests, dependencies, browser proof, and isolation are all covered.
- Placeholder scan: the plan uses concrete steps, files, commands, and expected results instead of deferred-work language.
- Type consistency: `mlEnabled`, `ml`, `DataCollectionHandle`, `SnapshotBatch`, `CompanionAdvisoryState`, room measurement fields, and Sentry APIs are removed from the contracts before their files are deleted.
- Execution order: external contracts are removed before broad file deletion, then UI/docs/tests/dependencies are cleaned, then full verification runs.
