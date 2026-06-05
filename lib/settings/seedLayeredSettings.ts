import { MODE_BASELINES } from '@/lib/settings/modeBaselines'
import { DEFAULT_SMOOTHING_TIME_CONSTANT, type Algorithm, type DetectorSettings } from '@/types/advisory'
import type {
  DiagnosticsProfile,
  DisplayPrefs,
  DwaSessionState,
} from '@/types/settings'

function normalizeAlgorithmMode(
  mode: unknown,
): DiagnosticsProfile['algorithmMode'] | undefined {
  if (mode === 'auto' || mode === 'custom') return mode
  return undefined
}

export function applyInitialDetectorSettings(
  baseSession: DwaSessionState,
  baseDisplay: DisplayPrefs,
  initialSettings: Partial<DetectorSettings>,
): { session: DwaSessionState; display: DisplayPrefs } {
  if (Object.keys(initialSettings).length === 0) {
    return { session: baseSession, display: baseDisplay }
  }

  const session: DwaSessionState = {
    ...baseSession,
    environment: { ...baseSession.environment },
    liveOverrides: { ...baseSession.liveOverrides },
    diagnostics: { ...baseSession.diagnostics },
  }
  const display: DisplayPrefs = { ...baseDisplay }

  if (initialSettings.mode !== undefined) {
    session.modeId = initialSettings.mode
  }

  const baseline = MODE_BASELINES[session.modeId]
  const hasMainsHumOverride = (
    initialSettings.mainsHumEnabled !== undefined ||
    initialSettings.mainsHumFundamental !== undefined
  )

  if (hasMainsHumOverride) {
    session.environment = {
      ...session.environment,
      ...(initialSettings.mainsHumEnabled !== undefined ? { mainsHumEnabled: initialSettings.mainsHumEnabled } : {}),
      ...(initialSettings.mainsHumFundamental !== undefined ? { mainsHumFundamental: initialSettings.mainsHumFundamental } : {}),
    }
  }

  if (initialSettings.feedbackThresholdDb !== undefined) {
    session.liveOverrides.sensitivityOffsetDb = initialSettings.feedbackThresholdDb - baseline.feedbackThresholdDb
  }
  if (initialSettings.inputGainDb !== undefined) {
    session.liveOverrides.inputGainDb = initialSettings.inputGainDb
  }
  if (initialSettings.autoGainEnabled !== undefined) {
    session.liveOverrides.autoGainEnabled = initialSettings.autoGainEnabled
  }
  if (initialSettings.autoGainTargetDb !== undefined) {
    session.liveOverrides.autoGainTargetDb = initialSettings.autoGainTargetDb
  }
  if (initialSettings.minFrequency !== undefined || initialSettings.maxFrequency !== undefined) {
    const minFrequency = initialSettings.minFrequency ?? baseline.minFrequency
    const maxFrequency = initialSettings.maxFrequency ?? baseline.maxFrequency
    session.liveOverrides.focusRange = (
      minFrequency === baseline.minFrequency && maxFrequency === baseline.maxFrequency
    )
      ? { kind: 'mode-default' }
      : { kind: 'custom', minHz: minFrequency, maxHz: maxFrequency }
  }
  if (initialSettings.eqPreset !== undefined) {
    session.liveOverrides.eqStyle = initialSettings.eqPreset === baseline.eqPreset
      ? 'mode-default'
      : initialSettings.eqPreset
  }
  const algorithmMode = normalizeAlgorithmMode(initialSettings.algorithmMode)
  if (algorithmMode !== undefined) {
    session.diagnostics.algorithmMode = algorithmMode
  }
  if (initialSettings.enabledAlgorithms !== undefined) {
    const deterministicAlgorithms = new Set<Algorithm>(['msd', 'phase', 'spectral', 'comb', 'ihr', 'ptmr'])
    session.diagnostics.enabledAlgorithms = (initialSettings.enabledAlgorithms as readonly string[])
      .filter((algorithm): algorithm is Algorithm => deterministicAlgorithms.has(algorithm as Algorithm))
  }
  if (initialSettings.adaptivePhaseSkip !== undefined) {
    session.diagnostics.adaptivePhaseSkip = initialSettings.adaptivePhaseSkip
  }
  if (initialSettings.thresholdMode !== undefined) {
    session.diagnostics.thresholdMode = initialSettings.thresholdMode
  }
  if (initialSettings.noiseFloorAttackMs !== undefined) {
    session.diagnostics.noiseFloorAttackMs = initialSettings.noiseFloorAttackMs
  }
  if (initialSettings.noiseFloorReleaseMs !== undefined) {
    session.diagnostics.noiseFloorReleaseMs = initialSettings.noiseFloorReleaseMs
  }
  if (initialSettings.maxTracks !== undefined) {
    session.diagnostics.maxTracks = initialSettings.maxTracks
  }
  if (initialSettings.trackTimeoutMs !== undefined) {
    session.diagnostics.trackTimeoutMs = initialSettings.trackTimeoutMs === baseline.defaultTrackTimeoutMs
      ? 'mode-default'
      : initialSettings.trackTimeoutMs
  }
  if (initialSettings.harmonicToleranceCents !== undefined) {
    session.diagnostics.harmonicToleranceCents = initialSettings.harmonicToleranceCents
  }
  if (initialSettings.peakMergeCents !== undefined) {
    session.diagnostics.peakMergeCents = initialSettings.peakMergeCents
  }

  session.diagnostics.confidenceThresholdOverride = initialSettings.confidenceThreshold === undefined
    ? session.diagnostics.confidenceThresholdOverride
    : initialSettings.confidenceThreshold === baseline.confidenceThreshold
      ? undefined
      : initialSettings.confidenceThreshold
  session.diagnostics.growthRateThresholdOverride = initialSettings.growthRateThreshold === undefined
    ? session.diagnostics.growthRateThresholdOverride
    : initialSettings.growthRateThreshold === baseline.growthRateThreshold
      ? undefined
      : initialSettings.growthRateThreshold
  session.diagnostics.smoothingTimeConstantOverride = initialSettings.smoothingTimeConstant === undefined
    ? session.diagnostics.smoothingTimeConstantOverride
    : initialSettings.smoothingTimeConstant === DEFAULT_SMOOTHING_TIME_CONSTANT || initialSettings.smoothingTimeConstant === 0.5
      ? undefined
      : initialSettings.smoothingTimeConstant
  session.diagnostics.sustainMsOverride = initialSettings.sustainMs === undefined
    ? session.diagnostics.sustainMsOverride
    : initialSettings.sustainMs === baseline.sustainMs
      ? undefined
      : initialSettings.sustainMs
  session.diagnostics.clearMsOverride = initialSettings.clearMs === undefined
    ? session.diagnostics.clearMsOverride
    : initialSettings.clearMs === baseline.clearMs
      ? undefined
      : initialSettings.clearMs
  session.diagnostics.prominenceDbOverride = initialSettings.prominenceDb === undefined
    ? session.diagnostics.prominenceDbOverride
    : initialSettings.prominenceDb === baseline.prominenceDb
      ? undefined
      : initialSettings.prominenceDb
  session.diagnostics.aWeightingOverride = initialSettings.aWeightingEnabled === undefined
    ? session.diagnostics.aWeightingOverride
    : initialSettings.aWeightingEnabled === baseline.aWeightingEnabled
      ? undefined
      : initialSettings.aWeightingEnabled
  session.diagnostics.ignoreWhistleOverride = initialSettings.ignoreWhistle === undefined
    ? session.diagnostics.ignoreWhistleOverride
    : initialSettings.ignoreWhistle === baseline.ignoreWhistle
      ? undefined
      : initialSettings.ignoreWhistle
  session.diagnostics.fftSizeOverride = initialSettings.fftSize === undefined
    ? session.diagnostics.fftSizeOverride
    : initialSettings.fftSize === baseline.fftSize
      ? undefined
      : initialSettings.fftSize
  session.diagnostics.ringThresholdDbOverride = initialSettings.ringThresholdDb === undefined
    ? session.diagnostics.ringThresholdDbOverride
    : initialSettings.ringThresholdDb === baseline.ringThresholdDb
      ? undefined
      : initialSettings.ringThresholdDb

  if (initialSettings.formantGateOverride !== undefined) session.diagnostics.formantGateOverride = initialSettings.formantGateOverride
  if (initialSettings.chromaticGateOverride !== undefined) session.diagnostics.chromaticGateOverride = initialSettings.chromaticGateOverride
  if (initialSettings.combSweepOverride !== undefined) session.diagnostics.combSweepOverride = initialSettings.combSweepOverride
  if (initialSettings.ihrGateOverride !== undefined) session.diagnostics.ihrGateOverride = initialSettings.ihrGateOverride
  if (initialSettings.ptmrGateOverride !== undefined) session.diagnostics.ptmrGateOverride = initialSettings.ptmrGateOverride
  if (initialSettings.mainsHumGateOverride !== undefined) session.diagnostics.mainsHumGateOverride = initialSettings.mainsHumGateOverride

  if (initialSettings.maxDisplayedIssues !== undefined) display.maxDisplayedIssues = initialSettings.maxDisplayedIssues
  if (initialSettings.graphFontSize !== undefined) display.graphFontSize = initialSettings.graphFontSize
  if (initialSettings.showTooltips !== undefined) display.showTooltips = initialSettings.showTooltips
  if (initialSettings.showAlgorithmScores !== undefined) display.showAlgorithmScores = initialSettings.showAlgorithmScores
  if (initialSettings.showPeqDetails !== undefined) display.showPeqDetails = initialSettings.showPeqDetails
  if (initialSettings.showFreqZones !== undefined) display.showFreqZones = initialSettings.showFreqZones
  if (initialSettings.spectrumWarmMode !== undefined) display.spectrumWarmMode = initialSettings.spectrumWarmMode
  if (initialSettings.spectrumSmoothingMode !== undefined) display.spectrumSmoothingMode = initialSettings.spectrumSmoothingMode
  if (initialSettings.rtaDbMin !== undefined) display.rtaDbMin = initialSettings.rtaDbMin
  if (initialSettings.rtaDbMax !== undefined) display.rtaDbMax = initialSettings.rtaDbMax
  if (initialSettings.spectrumLineWidth !== undefined) display.spectrumLineWidth = initialSettings.spectrumLineWidth
  if (initialSettings.showThresholdLine !== undefined) display.showThresholdLine = initialSettings.showThresholdLine
  if (initialSettings.canvasTargetFps !== undefined) display.canvasTargetFps = initialSettings.canvasTargetFps
  if (initialSettings.faderMode !== undefined) display.faderMode = initialSettings.faderMode
  if (initialSettings.faderLinkMode !== undefined) display.faderLinkMode = initialSettings.faderLinkMode
  if (initialSettings.faderLinkRatio !== undefined) display.faderLinkRatio = initialSettings.faderLinkRatio
  if (initialSettings.faderLinkCenterGainDb !== undefined) display.faderLinkCenterGainDb = initialSettings.faderLinkCenterGainDb
  if (initialSettings.faderLinkCenterSensDb !== undefined) display.faderLinkCenterSensDb = initialSettings.faderLinkCenterSensDb

  return { session, display }
}
