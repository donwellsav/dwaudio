# DoneWell Audio Operator Trust Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the analyzer's controls, status language, urgent alerts, and issue actions trustworthy during live operation, while deferring all physical hardware verification to the final release gate.

**Architecture:** Keep the current contexts and native controls. Fix the global keyboard listener at its single ownership boundary; expose the selected device through the existing native `<select>`; derive truthful empty-state copy from the existing `SpectrumStatus`; show a compact priority banner only where the detailed Issues view is hidden; reuse the canonical EQ formatter and existing advisory restore action for Copy and Undo. Each feature is independently tested and committed.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, Web Audio, Vitest, Testing Library, and the existing Swift/WKWebView DMG wrapper.

## Global Constraints

- Base all work on commit `375a149` (`fix: harden analyzer audio lifecycle`). Do not weaken or bypass that lifecycle fix.
- Do not touch or stage the pre-existing untracked `.codex/` directory.
- Add no dependency, global store, toast framework, portal, telemetry, backend, or DSP behavior.
- Reuse native controls, `AdvisoryContext`, `UIContext`, `useEarlyWarningPanelState`, `formatEQRecommendation`, and `restoreDismissedAdvisory`.
- Treat `lifecycle !== 'provisional'` as confirmed for compatibility with advisories that predate the lifecycle field.
- Keep the application local-only. `pnpm verify:local-only` remains a release check.
- Write the failing focused test first, make the smallest implementation change, rerun the focused test, then commit that task.
- Keep commits local. Do not push and do not open a pull request without a separate explicit request.
- Do not perform a microphone, interface, speaker, or acoustic test in Tasks 0-7. Hardware verification is Task 8 and must remain last.
- If a task reveals unrelated defects, record them separately; do not expand this plan unless they block an acceptance criterion below.

## Product Decisions Locked by This Plan

| Area | Decision |
|---|---|
| Global Space shortcut | Space/P shortcuts run only from non-interactive background targets. Native and ARIA controls retain their own keyboard behavior. |
| Active input | Keep the native select. It remains icon-only on narrow mobile layouts and exposes the selected label at the `tablet` breakpoint and above. |
| Empty analyzer state | Use `Listening`, `Detection Limited`, or `No Actionable Feedback`; never claim `All Clear`. |
| Priority visibility | In views that hide Issues, show confirmed RUNAWAY first, then confirmed GROWING, then an early warning that has persisted at least five seconds. |
| Copy | Confirmed corrective issues use the existing canonical EQ formatter. Provisional and warning-only whistle cards copy truthful no-cut guidance. |
| Undo | Keep one most-recent individual dismissal. No timer, queue, stack, or new persistence layer. |
| Hardware | One final gate after code, automated checks, production build, and DMG creation are complete. |

---

## Task 0: Establish a Clean Software Baseline

**Files:** None.

- [ ] Confirm the expected checkout and baseline:

  ```bash
  pwd
  git log -1 --oneline
  git status --short
  ```

  Expected:

  - `pwd` is `/Volumes/M5/donewellaudio`.
  - HEAD begins with `375a149 fix: harden analyzer audio lifecycle`.
  - The only known pre-existing worktree item is `?? .codex/`.

- [ ] Run the current focused regression baseline before adding tests:

  ```bash
  pnpm exec vitest run \
    components/analyzer/__tests__/IssuesList.test.tsx \
    components/analyzer/__tests__/IssueCard.test.tsx \
    components/analyzer/__tests__/MobileIssuesContent.test.tsx \
    hooks/__tests__/useIssueCardState.test.ts \
    hooks/__tests__/useAdvisoryClearState.test.ts \
    hooks/__tests__/useEarlyWarningPanelState.test.ts \
    hooks/__tests__/useRtaFullscreenState.test.ts
  ```

  Expected: all existing tests pass. Stop and diagnose any baseline failure before implementing a feature.

- [ ] Confirm there are no whitespace errors:

  ```bash
  git diff --check
  ```

  Expected: no output.

- [ ] If this plan is not already committed when execution begins, commit only the plan before changing source:

  ```bash
  git add docs/superpowers/plans/2026-07-09-operator-trust-improvements.md
  git commit -m "docs: plan operator trust improvements"
  ```

No feature-code commit is created for this task.

---

## Task 1: Return Spacebar Ownership to Interactive Controls

**Files:**

- Create: `components/analyzer/__tests__/AnalyzerKeyboardShortcuts.test.tsx`
- Modify: `components/analyzer/AnalyzerKeyboardShortcuts.tsx`

**Root cause:** `AnalyzerKeyboardShortcuts` owns one window-level `keydown` listener but skips only `<input>` and `<textarea>`. Space from buttons, links, the device select, tabs, sliders, the spectrum start overlay, and editable descendants bubbles into that listener, is canceled, and starts/stops the analyzer.

### Step 1.1: Add the regression test

- [ ] Create `components/analyzer/__tests__/AnalyzerKeyboardShortcuts.test.tsx` with hoisted context mocks and one ownership test:

  ```tsx
  // @vitest-environment jsdom

  import { beforeEach, describe, expect, it, vi } from 'vitest'
  import { render, screen } from '@testing-library/react'

  const mocks = vi.hoisted(() => ({
    start: vi.fn(() => Promise.resolve()),
    stop: vi.fn(),
    toggleFreeze: vi.fn(),
  }))

  vi.mock('@/contexts/EngineContext', () => ({
    useEngine: () => ({
      isRunning: false,
      isStarting: false,
      start: mocks.start,
      stop: mocks.stop,
    }),
  }))

  vi.mock('@/contexts/UIContext', () => ({
    useUI: () => ({ toggleFreeze: mocks.toggleFreeze }),
  }))

  import { AnalyzerKeyboardShortcuts } from '../AnalyzerKeyboardShortcuts'

  describe('AnalyzerKeyboardShortcuts', () => {
    beforeEach(() => {
      mocks.start.mockClear()
      mocks.stop.mockClear()
      mocks.toggleFreeze.mockClear()
    })

    it('leaves Space to interactive controls and keeps the background shortcut', () => {
      render(
        <>
          <AnalyzerKeyboardShortcuts />
          <button type="button">Action</button>
          <a href="#main">Skip link</a>
          <select aria-label="Input device"><option>Default</option></select>
          <div role="button" aria-label="Start overlay" tabIndex={0} />
          <div role="slider" aria-label="Gain" tabIndex={0} />
          <div role="tab" aria-label="Settings" tabIndex={0} />
          <div contentEditable suppressContentEditableWarning>
            <span data-testid="editable-child">Editable</span>
          </div>
        </>,
      )

      const targets = [
        screen.getByRole('button', { name: 'Action' }),
        screen.getByRole('link', { name: 'Skip link' }),
        screen.getByRole('combobox', { name: 'Input device' }),
        screen.getByRole('button', { name: 'Start overlay' }),
        screen.getByRole('slider', { name: 'Gain' }),
        screen.getByRole('tab', { name: 'Settings' }),
        screen.getByTestId('editable-child'),
      ]

      for (const target of targets) {
        const event = new KeyboardEvent('keydown', {
          key: ' ',
          bubbles: true,
          cancelable: true,
        })
        target.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(false)
      }

      expect(mocks.start).not.toHaveBeenCalled()

      const backgroundEvent = new KeyboardEvent('keydown', {
        key: ' ',
        bubbles: true,
        cancelable: true,
      })
      document.body.dispatchEvent(backgroundEvent)

      expect(backgroundEvent.defaultPrevented).toBe(true)
      expect(mocks.start).toHaveBeenCalledTimes(1)
    })
  })
  ```

- [ ] Run the test before changing production code:

  ```bash
  pnpm exec vitest run components/analyzer/__tests__/AnalyzerKeyboardShortcuts.test.tsx
  ```

  Expected failure: Space dispatched from one or more interactive targets is prevented and `start()` is called.

### Step 1.2: Fix the single global boundary

- [ ] Replace the two-element guard in `AnalyzerKeyboardShortcuts.tsx` with one DOM-native ancestor check before the key switch:

  ```tsx
  if (
    event.target instanceof Element &&
    event.target.closest(
      'a[href], button, input, select, textarea, [contenteditable], [role="button"], [role="slider"], [role="tab"]',
    )
  ) return
  ```

  This shared guard protects both Space and P. Do not add per-control event propagation hacks and do not change `SpectrumCanvasOverlay`.

- [ ] Run the focused test again:

  ```bash
  pnpm exec vitest run components/analyzer/__tests__/AnalyzerKeyboardShortcuts.test.tsx
  ```

  Expected: pass. Space on controls is untouched; Space on `document.body` starts analysis once.

- [ ] Run the immediate static checks:

  ```bash
  pnpm exec tsc --noEmit
  pnpm lint
  git diff --check
  ```

  Expected: all pass with no output from `git diff --check`.

- [ ] Commit only this task:

  ```bash
  git add components/analyzer/AnalyzerKeyboardShortcuts.tsx \
    components/analyzer/__tests__/AnalyzerKeyboardShortcuts.test.tsx
  git commit -m "fix: preserve Spacebar behavior on interactive controls"
  ```

### Task 1 acceptance

- Space on native and ARIA controls is not canceled by the analyzer.
- Space on the spectrum start overlay invokes its local handler exactly once.
- Space on a non-interactive background starts/stops analysis.
- P still toggles Freeze only from a non-interactive background while analysis is running.

---

## Task 2: Make the Active Input Visible Without Replacing the Native Select

**Files:**

- Create: `components/analyzer/__tests__/HeaderBarDeviceControls.test.tsx`
- Modify: `components/analyzer/HeaderBarDeviceControls.tsx`

**Interface:** No prop changes. Continue using `devices`, `selectedDeviceId`, and `handleDeviceChange` already supplied by `HeaderBar` and `useAudioDevices`.

### Step 2.1: Lock the responsive and accessible contract

- [ ] Add a component test that renders two devices with `selectedDeviceId="stage-left"` and verifies:

  ```tsx
  const select = screen.getByRole('combobox', { name: 'Select audio input' })

  expect((select as HTMLSelectElement).value).toBe('stage-left')
  expect(select.getAttribute('title')).toBe('Audio input: Stage Left Mic')
  expect(select.className).toContain('text-transparent')
  expect(select.className).toContain('tablet:text-foreground')
  expect(select.className).toContain('tablet:w-auto')

  fireEvent.change(select, { target: { value: 'stage-right' } })
  expect(handleDeviceChange).toHaveBeenCalledWith('stage-right')
  ```

  Also rerender with `selectedDeviceId=""` and assert the title is `Audio input: Default (System)`.

- [ ] Run the new test before implementation:

  ```bash
  pnpm exec vitest run components/analyzer/__tests__/HeaderBarDeviceControls.test.tsx
  ```

  Expected failure: the selected-device title and responsive visible-text classes do not exist.

### Step 2.2: Widen the existing control at the tablet breakpoint

- [ ] Derive the label inside `HeaderBarDeviceControls` without adding a hook:

  ```tsx
  const selectedDeviceLabel = selectedDeviceId
    ? devices.find((device) => device.deviceId === selectedDeviceId)?.label ?? 'Default (System)'
    : 'Default (System)'
  ```

- [ ] Keep the base mobile control at `h-11 w-11 text-transparent`. At `tablet`, widen it and reveal the native selected option:

  ```tsx
  <div className="relative h-11 w-11 text-foreground/70 hover:text-foreground btn-glow tablet:w-auto tablet:max-w-56">
    <select
      aria-label="Select audio input"
      title={`Audio input: ${selectedDeviceLabel}`}
      className="h-11 w-11 cursor-pointer appearance-none rounded bg-transparent text-transparent outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-primary tablet:w-auto tablet:max-w-56 tablet:pl-9 tablet:pr-6 tablet:text-foreground tablet:text-dwa-sm tablet:font-mono"
    >
  ```

- [ ] Move the microphone icon out of the text path only at `tablet` and above:

  ```tsx
  <Mic className="pointer-events-none absolute left-1/2 top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 tablet:left-3 tablet:size-4 tablet:translate-x-0" />
  ```

  Keep the chevron and native options. Change the tooltip text from the generic `Audio input` to `Audio input: {selectedDeviceLabel}`.

- [ ] Run the test and checks:

  ```bash
  pnpm exec vitest run components/analyzer/__tests__/HeaderBarDeviceControls.test.tsx
  pnpm exec tsc --noEmit
  pnpm lint
  git diff --check
  ```

  Expected: all pass.

- [ ] Perform software-only responsive inspection with analysis stopped:

  - At 390px, the control remains a 44px icon control and the header does not overflow.
  - At the `tablet` breakpoint and at 1440px, the selected option text is visible and does not overlap the icon or chevron.
  - Keyboard focus remains visible and changing the select updates the displayed selection.

- [ ] Commit only this task:

  ```bash
  git add components/analyzer/HeaderBarDeviceControls.tsx \
    components/analyzer/__tests__/HeaderBarDeviceControls.test.tsx
  git commit -m "feat: show the active audio input in the header"
  ```

### Task 2 acceptance

- The visible desktop/tablet label comes from the native selected option, not duplicated state.
- Narrow mobile keeps the compact icon presentation.
- Default and named devices have truthful titles/tooltips.
- Existing device selection behavior is unchanged.

---

## Task 3: Replace “All Clear” With Truthful Detector State

**Files:**

- Modify: `components/analyzer/IssuesEmptyState.tsx`
- Modify: `components/analyzer/__tests__/IssuesList.test.tsx`

**Status vocabulary:**

- `Listening`: analysis is running, but detector status or floor calibration is not ready.
- `Detection Limited`: signal, threshold, classification, or report gates are suppressing conclusions.
- `No Actionable Feedback`: a usable analyzed signal exists and there is currently no reportable advisory.

### Step 3.1: Replace the current expectations

- [ ] In `IssuesList.test.tsx`, replace the `green all-clear` test and update the file comment so the suite no longer treats “All Clear” as correct.

- [ ] Add these four cases:

  ```tsx
  it('shows Listening before detector status and floor are ready', () => {
    render(<IssuesList advisories={[]} isRunning />)
    expect(screen.getByText(/^listening$/i)).toBeDefined()
    expect(screen.queryByText(/all clear/i)).toBeNull()
  })

  it('shows No Actionable Feedback for a usable analyzed signal', () => {
    render(
      <IssuesList
        advisories={[]}
        isRunning
        noiseFloorDb={-90}
        spectrumStatus={{
          peak: -18,
          effectiveThresholdDb: -45,
          contentType: 'unknown',
          isSignalPresent: true,
          lastReportDecision: 'reported',
          lastReportGate: 'reported',
        }}
      />,
    )
    expect(screen.getByText(/no actionable feedback/i)).toBeDefined()
  })

  it('shows Detection Limited while a detector gate blocks reporting', () => {
    render(
      <IssuesList
        advisories={[]}
        isRunning
        noiseFloorDb={-90}
        spectrumStatus={{
          peak: -18,
          effectiveThresholdDb: -45,
          contentType: 'music',
          isSignalPresent: true,
          lastReportDecision: 'blocked',
          lastReportGate: 'music-material',
        }}
      />,
    )
    expect(screen.getByText(/detection limited/i)).toBeDefined()
    expect(screen.getByText(/music material/i)).toBeDefined()
  })

  it('shows Detection Limited and gain guidance for low signal', () => {
    render(<IssuesList advisories={[]} isRunning isLowSignal />)
    expect(screen.getByText(/detection limited/i)).toBeDefined()
    expect(screen.getByText(/low signal/i)).toBeDefined()
    expect(screen.getByText(/increase gain/i)).toBeDefined()
  })
  ```

- [ ] Run the test before implementation:

  ```bash
  pnpm exec vitest run components/analyzer/__tests__/IssuesList.test.tsx
  ```

  Expected failure: the component still renders `All Clear`, and the low-signal branch has no `Detection Limited` headline.

### Step 3.2: Derive the headline from the existing detailed status

- [ ] Add one pure helper next to `getAnalyzerStatusLabel`:

  ```tsx
  type AnalyzerHeadline = 'Listening' | 'Detection Limited' | 'No Actionable Feedback'

  export function getAnalyzerHeadline(
    spectrumStatus: SpectrumStatus | null | undefined,
    noiseFloorDb: number | null | undefined,
  ): AnalyzerHeadline {
    if (!spectrumStatus || noiseFloorDb == null) return 'Listening'
    return getAnalyzerStatusLabel(spectrumStatus, noiseFloorDb) === 'Listening'
      ? 'No Actionable Feedback'
      : 'Detection Limited'
  }
  ```

  This deliberately reuses the existing gate ordering for signal absence, report blocks, compression, music, and below-threshold states. Do not create a second detector-status model.

- [ ] In the low-signal layer, change the main headline from `Low Signal` to `Detection Limited`, then retain `Low Signal` and `Increase gain` as the reason/action copy.

- [ ] In the normal layer, replace hard-coded `All Clear` with `getAnalyzerHeadline(...)`. Use literal class mappings so the headline is not color-only:

  ```tsx
  const headlineClassName = analyzerHeadline === 'Detection Limited'
    ? 'text-amber-400/80'
    : analyzerHeadline === 'Listening'
      ? 'text-[var(--console-blue)]/75'
      : 'text-emerald-500/80'
  ```

  Keep the existing detailed status label and metrics beneath the headline. The radar animation remains an analyzer-activity indicator, not a claim that the room is safe.

- [ ] Run the focused suite and checks:

  ```bash
  pnpm exec vitest run components/analyzer/__tests__/IssuesList.test.tsx
  pnpm exec tsc --noEmit
  pnpm lint
  git diff --check
  ```

  Expected: all pass; `rg -n "All Clear|all-clear" components/analyzer components/analyzer/__tests__` returns no live analyzer-state copy.

- [ ] Commit only this task:

  ```bash
  git add components/analyzer/IssuesEmptyState.tsx \
    components/analyzer/__tests__/IssuesList.test.tsx
  git commit -m "fix: make analyzer empty states truthful"
  ```

### Task 3 acceptance

- Running without enough evidence never claims the system is clear.
- Every limited state includes a text reason such as Signal Gate, Music Material, Fusion Wait, Compression Guard, or Below Threshold.
- A healthy analyzed stream says only that no actionable feedback is currently detected.
- Low signal includes an explicit gain action.

---

## Task 4: Keep Priority Alerts Visible When Issues Are Hidden

**Files:**

- Create: `components/analyzer/PriorityAlertBanner.tsx`
- Create: `components/analyzer/__tests__/PriorityAlertBanner.test.tsx`
- Modify: `components/analyzer/settings/SettingsPanel.tsx`
- Modify: `components/analyzer/SpectrumCanvas.tsx`
- Modify: `components/analyzer/DesktopLayout.tsx`
- Modify: `components/analyzer/MobileLayout.tsx`

**Why this shape:** The detailed `IssueCard` and `EarlyWarningPanel` already work in the Issues view. Duplicating them globally would create competing state and unnecessary noise. A single compact banner is needed only in Settings and fullscreen, where Issues are hidden. Rendering the fullscreen banner as a descendant of `SpectrumCanvas` is required because the Fullscreen API hides nodes outside its target.

### Step 4.1: Test priority selection and semantics

- [ ] Create `PriorityAlertBanner.test.tsx` with advisory/context fixtures covering:

  1. RUNAWAY wins over GROWING regardless of array order.
  2. Resolved, provisional, and dismissed advisories are excluded.
  3. Legacy `lifecycle: undefined` remains eligible.
  4. Early warning is hidden before five seconds and shown at five seconds or later only when no urgent confirmed advisory exists.
  5. RUNAWAY uses `role="alert"`; GROWING and early warning use `role="status"`.
  6. `View issue` invokes the supplied callback.

  Core pure-selector assertions:

  ```tsx
  expect(getPriorityAdvisory([growing, runaway], new Set())?.id).toBe('runaway')
  expect(getPriorityAdvisory([
    { ...runaway, resolved: true },
    { ...growing, lifecycle: 'provisional' },
  ], new Set())).toBeNull()
  expect(getPriorityAdvisory([runaway], new Set(['runaway']))).toBeNull()
  ```

- [ ] Run the new test before implementation:

  ```bash
  pnpm exec vitest run components/analyzer/__tests__/PriorityAlertBanner.test.tsx
  ```

  Expected failure: the module does not exist.

### Step 4.2: Implement one context-backed banner

- [ ] Export this pure selector from `PriorityAlertBanner.tsx`:

  ```tsx
  export function getPriorityAdvisory(
    advisories: readonly Advisory[],
    dismissedIds: ReadonlySet<string>,
  ): Advisory | null {
    const urgent = advisories.filter((advisory) =>
      !advisory.resolved &&
      advisory.lifecycle !== 'provisional' &&
      !dismissedIds.has(advisory.id) &&
      (advisory.severity === 'RUNAWAY' || advisory.severity === 'GROWING'),
    )
    return urgent.find((advisory) => advisory.severity === 'RUNAWAY') ?? urgent[0] ?? null
  }
  ```

- [ ] Implement the component with this interface:

  ```tsx
  interface PriorityAlertBannerProps {
    onViewIssues: () => void
    className?: string
  }
  ```

  It must:

  - Read `advisories`, `dismissedIds`, and `earlyWarning` from `useAdvisoryData()`.
  - Reuse `useEarlyWarningPanelState(earlyWarning)`; show early warning only when `isVisible && tone !== 'notice'`.
  - Prefer the selected advisory over early warning.
  - Reuse `getSeverityText` and `formatFrequency`.
  - Render no close button and no internal timer. Visibility ends only when source state resolves, clears, or is dismissed from Issues.
  - Include icon plus explicit text, not color alone.
  - Give `View issue` `min-h-11 min-w-11` and a visible focus ring.
  - Use `role="alert"` only for RUNAWAY; use `role="status"` otherwise.

  The decision branch should stay this small:

  ```tsx
  const lead = getPriorityAdvisory(advisories, dismissedIds)
  const warningState = useEarlyWarningPanelState(earlyWarning)
  const showEarlyWarning = !lead && warningState.isVisible && warningState.tone !== 'notice'

  if (!lead && !showEarlyWarning) return null
  ```

- [ ] Run the banner test:

  ```bash
  pnpm exec vitest run components/analyzer/__tests__/PriorityAlertBanner.test.tsx
  ```

  Expected: all priority, role, and action cases pass.

### Step 4.3: Render the banner in Settings only when Issues are hidden

- [ ] Add `onViewIssues?: () => void` to `SettingsPanelProps`.

- [ ] Immediately above the settings tablist, render:

  ```tsx
  {onViewIssues ? <PriorityAlertBanner onViewIssues={onViewIssues} /> : null}
  ```

  This optional prop prevents `SettingsPanel` consumers outside the analyzer from requiring `AdvisoryProvider`.

- [ ] In `DesktopLayout`, add one callback:

  ```tsx
  const showPriorityIssue = useCallback(() => {
    if (isRtaFullscreen) toggleRtaFullscreen()
    if (!issuesPanelOpen) setActiveSidebarTab('issues')
  }, [isRtaFullscreen, issuesPanelOpen, setActiveSidebarTab, toggleRtaFullscreen])
  ```

- [ ] Pass `onViewIssues={!issuesPanelOpen ? showPriorityIssue : undefined}` to the sidebar `SettingsPanel`. When the split Issues panel is already visible, do not render a redundant banner.

- [ ] In `MobileLayout`, add one callback for both portrait and landscape:

  ```tsx
  const showPriorityIssue = useCallback(() => {
    if (isRtaFullscreen) toggleRtaFullscreen()
    setMobileTab('issues')
    setLandscapePanel('issues')
  }, [isRtaFullscreen, setMobileTab, toggleRtaFullscreen])
  ```

- [ ] Pass that callback to both mobile `SettingsPanel` instances.

### Step 4.4: Put the fullscreen banner inside the fullscreen target

- [ ] Add `overlay?: React.ReactNode` to `SpectrumCanvasProps` and render `{overlay}` after `SpectrumCanvasOverlay` inside the existing `relative` root.

- [ ] In the desktop `spectrumCanvasProps`, supply only while fullscreen:

  ```tsx
  overlay={isRtaFullscreen ? (
    <PriorityAlertBanner
      onViewIssues={showPriorityIssue}
      className="absolute inset-x-2 top-2 z-30"
    />
  ) : null}
  ```

- [ ] Add the same conditional overlay to `MobileLayout`'s `sharedSpectrumProps`. Because portrait, landscape, and `MobileFullscreenOverlay` already consume those props, no separate mobile alert store or portal is needed.

- [ ] Run the focused regression set:

  ```bash
  pnpm exec vitest run \
    components/analyzer/__tests__/PriorityAlertBanner.test.tsx \
    components/analyzer/__tests__/MobileIssuesContent.test.tsx \
    hooks/__tests__/useEarlyWarningPanelState.test.ts \
    hooks/__tests__/useRtaFullscreenState.test.ts
  pnpm exec tsc --noEmit
  pnpm lint
  git diff --check
  ```

  Expected: all pass.

- [ ] Perform software-only fullscreen wiring inspection with analysis stopped:

  - Enter and exit desktop RTA fullscreen and mobile fullscreen; the overlay slot remains inside the visible fullscreen root.
  - Settings renders normally with no active priority state.
  - Tab and button focus order remains logical.

  Actual alert persistence is exercised with fixtures in the component test now and with live input only in Task 8.

- [ ] Commit only this task:

  ```bash
  git add components/analyzer/PriorityAlertBanner.tsx \
    components/analyzer/__tests__/PriorityAlertBanner.test.tsx \
    components/analyzer/settings/SettingsPanel.tsx \
    components/analyzer/SpectrumCanvas.tsx \
    components/analyzer/DesktopLayout.tsx \
    components/analyzer/MobileLayout.tsx
  git commit -m "feat: keep priority alerts visible across views"
  ```

### Task 4 acceptance

- Confirmed, active, non-dismissed RUNAWAY is always the highest priority.
- GROWING is shown only when there is no RUNAWAY.
- A persistent early warning appears only when no confirmed urgent advisory is present.
- Settings and fullscreen never hide an eligible priority alert.
- `View issue` exits fullscreen when necessary and reveals the Issues view.
- Detailed cards and the existing `EarlyWarningPanel` remain unchanged in Issues.

---

## Task 5: Copy the Complete, Truthful Issue Guidance

**Files:**

- Modify: `hooks/useIssueCardState.ts`
- Modify: `hooks/__tests__/useIssueCardState.test.ts`
- Modify: `components/analyzer/IssueCardActions.tsx`
- Modify: `components/analyzer/__tests__/IssueCard.test.tsx`

**Reuse decision:** `lib/dsp/eqAdvisor.ts` already exports `formatEQRecommendation`, which includes GEQ, PEQ frequency/Q/gain, PEQ strategy reason, pitch, and broad tonal guidance. Do not edit or duplicate that formatter.

### Step 5.1: Test the copy policy before wiring it to the clipboard

- [ ] Import the planned `formatIssueCardCopyText` in `useIssueCardState.test.ts` and add exact-output cases:

  ```tsx
  expect(formatIssueCardCopyText(makeAdvisory())).toBe(
    'GEQ: Pull 1000Hz fader to -3dB | PEQ: Notch at 1000.0Hz, Q=4.0, -6dB | Pitch: B5 +3c',
  )

  expect(formatIssueCardCopyText(makeAdvisory({ lifecycle: 'provisional' }))).toBe(
    '1.00kHz (B5 +3c) | Possible feedback - watching only; no EQ cut until confirmed.',
  )

  expect(formatIssueCardCopyText(makeAdvisory({
    label: 'WHISTLE',
    severity: 'WHISTLE',
  }))).toBe(
    '1.00kHz (B5 +3c) | Whistle alert only - verify mic and speaker placement first. No EQ cut recommended.',
  )
  ```

  Add one confirmed case containing `peq.reason` and `tonalIssueSummary`, and assert both are present in the canonical output.

- [ ] Run the focused test before implementation:

  ```bash
  pnpm exec vitest run hooks/__tests__/useIssueCardState.test.ts
  ```

  Expected failure: `formatIssueCardCopyText` does not exist and current copy content is only frequency plus pitch.

### Step 5.2: Add a thin UI policy around the canonical formatter

- [ ] Add this exported helper to `useIssueCardState.ts`:

  ```tsx
  export function formatIssueCardCopyText(advisory: Advisory): string {
    const frequency = formatFrequency(advisory.trueFrequencyHz)
    const pitch = advisory.advisory?.pitch
      ? ` (${formatPitch(advisory.advisory.pitch)})`
      : ''

    if (advisory.lifecycle === 'provisional') {
      return `${frequency}${pitch} | Possible feedback - watching only; no EQ cut until confirmed.`
    }

    if (advisory.label === 'WHISTLE' && advisory.severity === 'WHISTLE') {
      return `${frequency}${pitch} | Whistle alert only - verify mic and speaker placement first. No EQ cut recommended.`
    }

    return formatEQRecommendation(advisory.advisory)
  }
  ```

- [ ] Change `handleCopy` to call `copyTextToClipboard(formatIssueCardCopyText(advisory))`. Keep the existing clipboard fallback, mounted guard, 1.5-second success state, and error behavior unchanged.

- [ ] In every `IssueCardActions` layout:

  - Change the accessible label to `Copy issue guidance for ${exactFreqStr}`.
  - Change the success live-region text from `Frequency info copied` to `Issue guidance copied`.
  - Keep existing icons and layouts; do not redesign the card in this task.

- [ ] Update `IssueCard.test.tsx` to assert the new button name and success status after a successful clipboard mock.

  Use a corrective fixture with a non-null GEQ recommendation so this test exercises the canonical confirmed-output path rather than the provisional/whistle fallbacks.

- [ ] Run the focused tests and checks:

  ```bash
  pnpm exec vitest run \
    hooks/__tests__/useIssueCardState.test.ts \
    components/analyzer/__tests__/IssueCard.test.tsx
  pnpm exec tsc --noEmit
  pnpm lint
  git diff --check
  ```

  Expected: all pass.

- [ ] Commit only this task:

  ```bash
  git add hooks/useIssueCardState.ts \
    hooks/__tests__/useIssueCardState.test.ts \
    components/analyzer/IssueCardActions.tsx \
    components/analyzer/__tests__/IssueCard.test.tsx
  git commit -m "feat: copy complete issue guidance"
  ```

### Task 5 acceptance

- Confirmed corrective cards copy the same canonical EQ values the product computes.
- Strategy and broad tonal notes are included when present.
- Provisional and warning-only whistle cards never copy a hidden or unconfirmed cut.
- Clipboard failure remains silent and non-destructive; success is announced to assistive technology.

---

## Task 6: Add One-Level Undo for Individual Issue Dismissal

**Files:**

- Modify: `components/analyzer/IssuesList.tsx`
- Modify: `components/analyzer/__tests__/IssuesList.test.tsx`
- Modify: `components/analyzer/MobileIssuesContent.tsx`
- Modify: `hooks/useAnalyzerLayoutState.ts`

**Reuse decision:** `useAdvisoryClearState` and `AdvisoryContext` already expose `restoreDismissedAdvisory(id)`. The missing piece is a small local UI affordance, not new dismissal state.

### Step 6.1: Add a controlled final-card regression test

- [ ] Add a test harness inside `IssuesList.test.tsx` that owns only `dismissedIds`:

  ```tsx
  function DismissUndoHarness() {
    const advisory = makeAdvisory('a1', 'GROWING')
    const [dismissedIds, setDismissedIds] = useState(new Set<string>())

    return (
      <IssuesList
        advisories={[advisory]}
        dismissedIds={dismissedIds}
        isRunning
        onDismiss={(id) => setDismissedIds((current) => new Set(current).add(id))}
        onRestoreDismissed={(id) => setDismissedIds((current) => {
          const next = new Set(current)
          next.delete(id)
          return next
        })}
      />
    )
  }
  ```

- [ ] Assert this sequence:

  1. The issue card is present.
  2. Clicking its Dismiss action removes the card.
  3. `Issue dismissed` and an `Undo` button remain visible even though the final card is gone.
  4. Clicking `Undo` restores the card and removes the notice.
  5. A second dismissal replaces the previous undo target; no stack appears.

- [ ] Run before implementation:

  ```bash
  pnpm exec vitest run components/analyzer/__tests__/IssuesList.test.tsx
  ```

  Expected failure: `onRestoreDismissed` is not a prop and no Undo notice exists.

### Step 6.2: Keep only the last individual dismissal in `IssuesList`

- [ ] Add this optional prop:

  ```tsx
  onRestoreDismissed?: (id: string) => void
  ```

- [ ] Add local `lastDismissedId: string | null` state and wrap the existing individual dismiss callback:

  ```tsx
  const handleDismiss = useCallback((id: string) => {
    onDismiss?.(id)
    if (onRestoreDismissed) setLastDismissedId(id)
  }, [onDismiss, onRestoreDismissed])
  ```

- [ ] Derive whether Undo is still valid; do not synchronize it with another effect:

  ```tsx
  const canUndoDismissal = lastDismissedId !== null &&
    dismissedIds?.has(lastDismissedId) === true &&
    advisories.some((advisory) => advisory.id === lastDismissedId)
  ```

- [ ] Render the compact notice before the empty/list branch so it survives final-card dismissal:

  ```tsx
  {canUndoDismissal ? (
    <div role="status" className="flex min-h-11 items-center gap-2 rounded border border-border/50 bg-card/60 px-3 text-dwa-sm font-mono text-muted-foreground">
      <span>Issue dismissed.</span>
      <button type="button" className="ml-auto min-h-11 px-3 text-foreground underline underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" onClick={handleUndo}>
        Undo
      </button>
    </div>
  ) : null}
  ```

  `handleUndo` calls `onRestoreDismissed(lastDismissedId)` and then clears the local ID. No timeout and no array of prior dismissals.

- [ ] Pass `handleDismiss` to `IssueCard` only when `onDismiss` exists. Leave `Clear All` and `Clear Done` behavior unchanged.

### Step 6.3: Wire the restore action already in context

- [ ] In `useAnalyzerLayoutState`, add:

  ```tsx
  onRestoreDismissed: advisoriesState.restoreDismissedAdvisory,
  ```

  Add the callback to the memo dependency list.

- [ ] Add `onRestoreDismissed` to `MobileIssuesContent`'s `IssuesListBaseProps` `Pick`. Desktop already forwards the full `issuesListBaseProps` object.

- [ ] Run focused tests and checks:

  ```bash
  pnpm exec vitest run \
    components/analyzer/__tests__/IssuesList.test.tsx \
    components/analyzer/__tests__/MobileIssuesContent.test.tsx \
    hooks/__tests__/useAdvisoryClearState.test.ts
  pnpm exec tsc --noEmit
  pnpm lint
  git diff --check
  ```

  Expected: all pass. Existing clear-state pruning and provider isolation tests remain green.

- [ ] Commit only this task:

  ```bash
  git add components/analyzer/IssuesList.tsx \
    components/analyzer/__tests__/IssuesList.test.tsx \
    components/analyzer/MobileIssuesContent.tsx \
    hooks/useAnalyzerLayoutState.ts
  git commit -m "feat: add undo for dismissed issues"
  ```

### Task 6 acceptance

- The last individual dismissal can be restored from desktop and mobile.
- Undo remains available after dismissing the final visible issue.
- A newer individual dismissal replaces the prior Undo target.
- Clear All and Clear Done do not create an undo stack.
- When the source advisory disappears, the derived notice disappears without retaining a stale visible action.

---

## Task 7: Integrated Software Verification and Release Candidate Build

**Files:** No planned source edits. Fix any failure in the task/commit that introduced it rather than creating a catch-all cleanup commit.

### Step 7.1: Run the complete focused feature set

- [ ] Run:

  ```bash
  pnpm exec vitest run \
    components/analyzer/__tests__/AnalyzerKeyboardShortcuts.test.tsx \
    components/analyzer/__tests__/HeaderBarDeviceControls.test.tsx \
    components/analyzer/__tests__/PriorityAlertBanner.test.tsx \
    components/analyzer/__tests__/IssuesList.test.tsx \
    components/analyzer/__tests__/IssueCard.test.tsx \
    components/analyzer/__tests__/MobileIssuesContent.test.tsx \
    hooks/__tests__/useIssueCardState.test.ts \
    hooks/__tests__/useAdvisoryClearState.test.ts \
    hooks/__tests__/useEarlyWarningPanelState.test.ts \
    hooks/__tests__/useRtaFullscreenState.test.ts
  ```

  Expected: all pass with no skipped newly-added cases.

### Step 7.2: Run repository-wide gates

- [ ] Run each command separately so the failing gate is unambiguous:

  ```bash
  pnpm test
  pnpm lint
  pnpm exec tsc --noEmit
  pnpm verify:local-only
  pnpm build
  git diff --check
  ```

  Expected:

  - Full Vitest suite passes.
  - ESLint and TypeScript report no errors.
  - Local-only verification passes.
  - Next.js production build completes.
  - `git diff --check` has no output.

### Step 7.3: Perform no-microphone UI smoke checks

- [ ] Start the production app or development server without granting microphone access and inspect 390px portrait, mobile landscape, tablet, and 1440px desktop:

  - Header does not overflow.
  - Active-input control remains native and keyboard focusable.
  - Space on buttons, tabs, select, sliders, and the spectrum start overlay stays local.
  - Space on a non-interactive background still reaches the analyzer shortcut.
  - Settings and fullscreen render with no console errors when no priority alert exists.
  - The standby/start state remains usable.

  This is layout and keyboard verification only; do not select or activate physical audio input yet.

### Step 7.4: Build the artifact before the hardware gate

- [ ] Build the DMG:

  ```bash
  pnpm build:dmg
  ```

  Expected: `dist/dwaudio.dmg` exists and the build exits successfully.

- [ ] Confirm the artifact and committed source state:

  ```bash
  test -f dist/dwaudio.dmg
  git status --short
  git log --oneline -8
  ```

  Expected:

  - The DMG exists.
  - No tracked changes remain.
  - `.codex/` remains untracked and unstaged.
  - The plan commit and six feature commits are visible above baseline commit `375a149`.

No “fixed” or “release-ready” claim is allowed yet. At this point the result is a software-verified release candidate only.

---

## Task 8: Final Hardware Verification Gate — Intentionally Last

**Entry condition:** Tasks 0-7 are complete, all commits exist, the complete software suite is green, and `dist/dwaudio.dmg` has been built. Do not move any item in this task earlier.

**Safety:** Use low monitoring levels and a controlled tone/loopback where possible. Do not create uncontrolled high-SPL acoustic feedback. Protect hearing and loudspeakers first.

### Step 8.1: Record the test matrix

- [ ] Before testing, record:

  - macOS version and machine.
  - Browser name/version for the web run.
  - Installed DMG/app build identity.
  - Physical inputs used: built-in input and, when available, one external interface.
  - Output/monitoring path and the safe signal source.

### Step 8.2: Verify lifecycle and device truth in both runtime surfaces

- [ ] In the browser build and then in the installed WKWebView app, verify:

  1. Deny microphone permission; confirm the error guidance is actionable and Retry does not create an unhandled state.
  2. Grant permission and start analysis.
  3. Stop/start analysis repeatedly; confirm no duplicate stream, worker, or shortcut behavior.
  4. Switch inputs while stopped, then while running.
  5. Unplug and reconnect the selected external interface if one is available.
  6. Background/foreground the app and perform one sleep/wake cycle.
  7. Confirm the header label always matches the input actually feeding the meter.

  Expected: input label, meter, engine state, and error/status copy agree after every transition.

### Step 8.3: Verify truthful detector states

- [ ] With real input, capture each reachable state:

  - `Listening` during startup/calibration.
  - `Detection Limited` for low signal and at least one real gate/guard condition.
  - `No Actionable Feedback` only after a usable signal and floor are established.
  - A confirmed actionable advisory.

  Expected: the UI never displays `All Clear`; the detailed reason beneath `Detection Limited` matches the live detector state.

### Step 8.4: Verify priority persistence across views

- [ ] Using a safe controlled signal, produce or replay a real GROWING/RUNAWAY condition and a persistent early warning without excessive acoustic level.

- [ ] For each eligible priority state:

  1. Open desktop Controls/Settings.
  2. Open mobile Settings in portrait and landscape.
  3. Enter RTA fullscreen.
  4. Confirm the compact priority banner remains visible.
  5. Activate `View issue` with pointer and keyboard.

  Expected: RUNAWAY supersedes GROWING, confirmed urgent advisory supersedes early warning, and `View issue` exits fullscreen and reveals the matching issue. The banner clears only when its source resolves, clears, or is dismissed in Issues.

### Step 8.5: Verify issue actions against live advisory data

- [ ] On a confirmed corrective issue:

  1. Copy issue guidance.
  2. Paste it into a plain-text editor.
  3. Compare GEQ band/cut, PEQ type/frequency/Q/gain, strategy, pitch, and tonal note to the card/source values.

- [ ] On a provisional or warning-only whistle issue, confirm copied text explicitly says no EQ cut is confirmed/recommended and contains no hidden cut values.

- [ ] Dismiss the final visible issue, confirm Undo remains, activate Undo, and confirm the exact card returns.

### Step 8.6: Verify keyboard ownership on the real app

- [ ] With analysis stopped and running, focus each of these and press Space:

  - Start/stop button.
  - Audio-input select.
  - Settings tabs.
  - Bottom navigation tabs.
  - Gain/sensitivity sliders.
  - Spectrum start overlay.
  - Skip link.

  Expected: each control keeps its native/local Space behavior and the analyzer does not also toggle. Then focus a non-interactive background and confirm the global Space shortcut toggles the analyzer exactly once.

### Step 8.7: Capture evidence and decide release status

- [ ] Save a concise result table with runtime, input, scenario, expected result, actual result, and pass/fail. Capture screenshots for active input, each status headline, Settings priority banner, fullscreen priority banner, and final-card Undo.

- [ ] If any hardware scenario fails:

  - Do not call the work fixed or release-ready.
  - Map the failure back to the owning task.
  - Add the smallest automated regression that can reproduce it.
  - Fix and recommit there.
  - Rerun Tasks 7 and 8 in full.

- [ ] Only after every row passes, mark the release candidate verified on the actual installed app and browser runtime.

---

## Final Definition of Done

- [ ] Tasks 1-6 each have a focused regression test and isolated local commit.
- [ ] No new dependency, global store, toast framework, backend, or DSP behavior was added.
- [ ] Full test, lint, typecheck, local-only, production build, and DMG build gates pass.
- [ ] The active input is visible at tablet/desktop widths and truthfully titled everywhere.
- [ ] The analyzer never says `All Clear`.
- [ ] Priority alerts survive Settings and fullscreen with correct precedence and navigation.
- [ ] Copy emits complete canonical guidance without leaking unconfirmed cuts.
- [ ] The last individual dismissal can be undone after the final card disappears.
- [ ] Physical hardware and the installed app were tested only after all software work, and all evidence passed.
- [ ] `.codex/` was never staged, no push occurred, and no pull request was opened.
