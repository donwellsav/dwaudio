# Analyzer Reliability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the confirmed analyzer lifecycle, transport, offline, storage, and control-contract defects without adding product UI or dependencies.

**Architecture:** Keep the existing main-thread audio detector, DSP worker, and React state split. Reuse the existing reset operations at every true run boundary, make device switching latest-request-wins, and fix state transitions in the owning layer instead of adding guards to callers. Use native CacheStorage, Cloudflare Pages headers, and the existing typed storage wrapper.

**Tech Stack:** Next.js 16 static export, React 19, TypeScript, Web Audio API, Web Workers, Vitest, Cloudflare Pages.

## Global Constraints

- Add no runtime or development dependency.
- Add no new user-facing panel, prompt, control, or workflow.
- Keep the application local-only; no telemetry, backend, remote API, or third-party runtime request.
- Treat FFT-size changes, successful device changes, and explicit new starts as run boundaries; clear only run-scoped state.
- Device selection is latest-request-wins: after overlapping A then B requests settle, B is the captured and displayed device.
- A locked auto-gain calibration remains locked unless auto-gain transitions from disabled to enabled.
- A failed microphone start must stop every acquired track; a failed suspended-context resume must leave the app stopped with retry guidance.
- At most one `processPeak` message may be outstanding from the main-thread worker transport.
- Offline installation must cache the DSP worker request and must not activate a partial core cache.
- Manual input gain remains the declared and displayed `-40..40 dB` contract.
- Static and non-static deployments use the existing local-only CSP and intended security headers.
- Follow TDD for behavior changes: record a focused failing test before production edits, then the passing command after the minimal fix.
- Hardware/microphone validation remains deferred until the user explicitly requests the final hardware gate.

---

### Task 9: Worker reset, initialization, and one-job backpressure

**Files:**
- Modify: `lib/dsp/dspWorker.ts`
- Modify: `hooks/dspWorkerInternals.ts`
- Modify: `hooks/useDSPWorker.ts`
- Test: `hooks/__tests__/useDSPWorker.test.ts`
- Test: `tests/integration/workerPipeline.test.ts`

**Interfaces:**
- Consumes: existing `DSPWorkerHandle.reset()`, `DSPWorkerHandle.init(...)`, `WorkerRuntimeSettings`.
- Produces: reset clears run recurrence; init applies `maxTracks` and `trackTimeoutMs`; only `returnBuffers(source: 'peak')` releases `busyRef` and flushes one queued peak.

- [ ] **Step 1: Write failing transport and worker-state tests**

```ts
it('keeps one peak outstanding until its buffers return', () => {
  // Queue two peaks, emit tracksUpdate, and assert no second processPeak yet.
  // Emit returnBuffers(source: 'peak') and assert exactly one queued peak flushes.
})

it('clears current-run recurrence on reset and applies initial track options', async () => {
  // Initialize with a non-default timeout, sync recurrence, reset, and verify
  // the next recommendation has recurrenceCount 0 and the manager uses the init timeout.
})
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm test hooks/__tests__/useDSPWorker.test.ts tests/integration/workerPipeline.test.ts`

Expected: the tracks-update test observes an early second `processPeak`; reset/init state assertions fail.

- [ ] **Step 3: Implement the minimum worker fixes**

```ts
case 'init': {
  settings = { ...DEFAULT_SETTINGS, ...msg.settings }
  trackManager.updateOptions({
    maxTracks: settings.maxTracks,
    trackTimeoutMs: settings.trackTimeoutMs,
  })
  // existing init work
}

case 'reset': {
  feedbackHotspotSummaries = []
  // existing reset work
}

case 'tracksUpdate':
  // update callbacks/status only; returnBuffers is the completion ACK
  break
```

Also clear any pending history-sync request in `DSPWorkerHandle.reset()` so an old run cannot be replayed after reset.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm test hooks/__tests__/useDSPWorker.test.ts tests/integration/workerPipeline.test.ts`

Expected: all focused tests pass with no warnings.

- [ ] **Step 5: Run the full suite and commit**

Run: `pnpm test`

Commit: `fix: harden worker reset and backpressure`

---

### Task 10: Detector cleanup, suspended-context failure, and auto-gain transition

**Files:**
- Modify: `lib/dsp/feedbackDetector.ts`
- Test: `lib/dsp/__tests__/feedbackDetector.lifecycle.test.ts`
- Test: `lib/dsp/__tests__/feedbackDetector.hotpath.test.ts`
- Test: `lib/audio/__tests__/createAudioAnalyzer.test.ts`

**Interfaces:**
- Consumes: existing `FeedbackDetector.stop({ releaseMic: true })`, `onStopped`, and `updateSettings`.
- Produces: failed starts release acquired streams; failed resume stops the detector; auto-gain calibration resets only on a false-to-true transition.

- [ ] **Step 1: Write three focused failing tests**

```ts
it('releases an acquired microphone when AudioContext resume rejects', async () => {
  await expect(detector.start()).rejects.toThrow('resume failed')
  expect(track.stop).toHaveBeenCalledOnce()
})

it('stops after a suspended context cannot resume', async () => {
  context.state = 'suspended'
  context.resume.mockRejectedValueOnce(new Error('gesture required'))
  context.dispatchStateChange()
  await Promise.resolve()
  expect(detector.getState().isRunning).toBe(false)
  expect(onStopped).toHaveBeenCalled()
})

it('keeps locked auto gain locked when enabled settings are reapplied', () => {
  detector.updateSettings({ autoGainEnabled: true })
  // drive calibration to locked, then update an unrelated setting
  detector.updateSettings({ feedbackThresholdDb: 30, autoGainEnabled: true })
  expect(detector.getState().autoGainLocked).toBe(true)
})
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm test lib/dsp/__tests__/feedbackDetector.lifecycle.test.ts lib/dsp/__tests__/feedbackDetector.hotpath.test.ts lib/audio/__tests__/createAudioAnalyzer.test.ts`

Expected: the acquired track is not stopped, resume failure leaves running true, and reapplying enabled auto-gain unlocks calibration.

- [ ] **Step 3: Implement the owning-layer fixes**

```ts
const wasAutoGainEnabled = this._autoGainEnabled
this._autoGainEnabled = settings.autoGainEnabled
if (settings.autoGainEnabled && !wasAutoGainEnabled) {
  this._autoGainLocked = false
  this._autoGainCalibrationStartMs = 0
  this._autoGainSignalFrames = 0
}
```

Wrap the active start generation so a thrown post-acquisition setup step invokes `stop({ releaseMic: true })` before rethrowing. On rejected mid-session `resume()`, invoke the existing stopped/error path and release the microphone.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all focused tests pass with no warnings.

- [ ] **Step 5: Run the full suite and commit**

Run: `pnpm test`

Commit: `fix: close detector lifecycle failure paths`

---

### Task 11: Complete run boundaries and latest-device switching

**Files:**
- Modify: `hooks/useAnalyzerFrameState.ts`
- Modify: `hooks/useAudioAnalyzer.ts`
- Modify: `hooks/useAnalyzerContextState.ts` only if the public handler contract must return the switch promise
- Test: `hooks/__tests__/useAnalyzerFrameState.test.ts`
- Test: `hooks/__tests__/useAudioAnalyzer.test.ts`
- Test: `hooks/__tests__/useAnalyzerContextState.test.ts`

**Interfaces:**
- Consumes: Task 9 reset/init semantics and existing `clearMap()`.
- Produces: `resetFrameState(): void`; shared main-thread run reset; structural FFT re-init; serialized latest-request-wins `switchDevice(deviceId)`.

- [ ] **Step 1: Write failing reset, FFT, and overlap tests**

```ts
it('clears frame status, tracks, spectrum, and early warning for a new run', () => {
  // Populate each ref/state, call resetFrameState, assert empty/null state.
})

it('reinitializes worker state when FFT size changes while running', () => {
  // Rerender from 4096 to 8192 and assert reset + init, not updateSettings only.
})

it('finishes on device B when B is selected while device A is pending', async () => {
  const switchA = result.current.switchDevice('A')
  const switchB = result.current.switchDevice('B')
  resolveA()
  resolveB()
  await Promise.all([switchA, switchB])
  expect(analyzer.start).toHaveBeenLastCalledWith({ deviceId: 'B' })
  expect(result.current.isRunning).toBe(true)
})

it('clears old advisories and frame state on a successful device boundary', async () => {
  await result.current.switchDevice('B')
  expect(clearMap).toHaveBeenCalled()
  expect(resetFrameState).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm test hooks/__tests__/useAnalyzerFrameState.test.ts hooks/__tests__/useAudioAnalyzer.test.ts hooks/__tests__/useAnalyzerContextState.test.ts`

Expected: reset API is absent, FFT only updates settings, A wins the overlap, and switch does not clear UI state.

- [ ] **Step 3: Implement a single reused run reset and switch loop**

```ts
const resetRunState = useCallback(() => {
  resetFeedbackHistoryForCurrentRun()
  clearMap()
  resetFrameState()
  dspWorkerRef.current.reset()
}, [clearMap, resetFrameState])
```

Use it in explicit start, each actual device transition, and a live FFT-size transition. Implement one in-flight switch promise with one pending latest device ID: if B arrives while A awaits acquisition, stop stale A after it resolves and immediately start B; only initialize the worker and publish running state for the latest request.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all focused tests pass with no warnings.

- [ ] **Step 5: Run the FFT finite-value regression**

Run: `pnpm test lib/dsp/__tests__/phaseCoherence.test.ts lib/dsp/__tests__/workerFft.test.ts hooks/__tests__/useAudioAnalyzer.test.ts`

Expected: both FFT directions keep worker outputs finite because structural changes reinitialize worker state.

- [ ] **Step 6: Run the full suite and commit**

Run: `pnpm test`

Commit: `fix: make analyzer run boundaries atomic`

---

### Task 12: Align gain and storage contracts

**Files:**
- Modify: `lib/storage/dwaStorage.ts`
- Modify: `hooks/useLayeredSettings.ts`
- Modify: `vitest.config.ts`
- Test: `lib/storage/__tests__/dwaStorage.test.ts`
- Test: `hooks/__tests__/useLayeredSettings.test.ts`

**Interfaces:**
- Produces: `TypedStorage.exists(): boolean`; manual and linked-center gain clamp `-40..40`; coverage includes `lib/audio` and `lib/settings`.

- [ ] **Step 1: Write failing storage and gain tests**

```ts
it('reports storage presence without throwing when access is denied', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied') })
  expect(typedStorage('key', {} as object).exists()).toBe(false)
})

it('mounts layered settings when localStorage access throws', () => {
  expect(() => renderHook(() => useLayeredSettings())).not.toThrow()
})

it('preserves the declared manual gain endpoints', () => {
  act(() => result.current.setInputGain(40))
  expect(result.current.derivedSettings.inputGainDb).toBe(40)
  act(() => result.current.setInputGain(-40))
  expect(result.current.derivedSettings.inputGainDb).toBe(-40)
})
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm test lib/storage/__tests__/dwaStorage.test.ts hooks/__tests__/useLayeredSettings.test.ts`

Expected: `exists` is absent, the hook throws on direct access, and gain endpoints clamp to +/-24.

- [ ] **Step 3: Reuse typed storage and align gain clamps**

```ts
exists(): boolean {
  if (typeof window === 'undefined') return false
  try { return localStorage.getItem(key) !== null } catch { return false }
}
```

Replace direct `localStorage.getItem` probes with `sessionStorageV2.exists()` / `displayStorageV2.exists()`. Change manual gain and linked-center sanitization/action bounds to `-40, 40`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all focused tests pass with no warnings.

- [ ] **Step 5: Expand core coverage and verify thresholds**

Add `lib/audio/**/*.ts` and `lib/settings/**/*.ts` to coverage includes.

Run: `pnpm test:coverage`

Expected: configured branch/function/line thresholds pass without lowering any threshold.

- [ ] **Step 6: Run the full suite and commit**

Run: `pnpm test`

Commit: `fix: align settings storage and gain contracts`

---

### Task 13: Make offline installation and static headers match the product contract

**Files:**
- Modify: `public/dwa-service-worker.js`
- Create: `public/_headers`
- Modify: `next.config.mjs`
- Test: `tests/serviceWorkerContract.test.ts`
- Test: `tests/staticHostingContract.test.ts`

**Interfaces:**
- Produces: CacheStorage handles `worker` requests; `cache.addAll` makes core installation fail atomically; static/non-static headers share the existing local-only policy.

- [ ] **Step 1: Write failing service-worker and header contract tests**

```ts
it('routes worker requests through cacheFirst', () => {
  dispatchFetch({ method: 'GET', destination: 'worker', origin: SELF_ORIGIN })
  expect(event.respondWith).toHaveBeenCalled()
})

it('rejects installation when a core asset cannot be cached', async () => {
  cache.addAll.mockRejectedValueOnce(new Error('network'))
  await expect(installPromise).rejects.toThrow('network')
})

it('ships the static local-only security policy', () => {
  expect(headers).toContain('X-Frame-Options: DENY')
  expect(headers).toContain('Permissions-Policy: microphone=(self), camera=(), geolocation=()')
  expect(headers).toContain("Content-Security-Policy: default-src 'self'")
})
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm test tests/serviceWorkerContract.test.ts tests/staticHostingContract.test.ts`

Expected: worker is ignored, failed per-asset caching is swallowed, and `_headers`/non-static CSP are absent.

- [ ] **Step 3: Implement native transactional caching**

```js
const STATIC_DESTINATIONS = new Set(['script', 'style', 'font', 'image', 'manifest', 'worker'])

async function cacheCoreAssets() {
  const cache = await caches.open(CORE_CACHE)
  await cache.addAll(CORE_ASSETS.map((asset) => new Request(asset, { cache: 'reload' })))
}
```

- [ ] **Step 4: Add the existing local-only policy to both hosting surfaces**

Use the CSP already present in `scripts/build-dmg.mjs`:

```text
default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

Add it to `securityHeaders` and `public/_headers`, together with the five existing intended headers.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all focused tests pass with no warnings.

- [ ] **Step 6: Verify static export copies the policy and worker chunk**

Run: `DWA_STATIC_EXPORT=1 pnpm build`

Run: `test -f out/_headers && rg -n "Content-Security-Policy|Permissions-Policy" out/_headers && rg -l "TrackManager" out/_next/static/chunks`

Expected: static build passes, `out/_headers` contains the policy, and one generated worker chunk is found.

- [ ] **Step 7: Run local-only, full tests, and commit**

Run: `pnpm verify:local-only && pnpm test`

Commit: `fix: harden offline cache and static headers`

---

## Final Software Verification

- [ ] Run `pnpm verify:local-only`.
- [ ] Run `pnpm lint`.
- [ ] Run `pnpm test` and record test/file counts.
- [ ] Run `pnpm test:coverage` and record all four percentages.
- [ ] Run `pnpm build`.
- [ ] Run `DWA_STATIC_EXPORT=1 pnpm build`.
- [ ] Run `pnpm audit --prod`.
- [ ] Confirm `git status --short` contains only intended tracked changes and no generated output.
- [ ] Perform a whole-branch review against baseline `37d3b37`.
- [ ] Do not run the microphone/hardware gate in this pass.
