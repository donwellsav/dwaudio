import type { DetectorSettings } from '@/types/advisory'

function pickSettings<T extends object, K extends keyof T>(
  source: T,
  keys: readonly K[],
): Pick<T, K> {
  const result = {} as Pick<T, K>
  for (const key of keys) {
    result[key] = source[key]
  }
  return result
}

const AUDIO_RUNTIME_KEYS = [
  'mode',
  'fftSize',
  'smoothingTimeConstant',
  'minFrequency',
  'maxFrequency',
  'feedbackThresholdDb',
  'ringThresholdDb',
  'growthRateThreshold',
  'eqPreset',
  'inputGainDb',
  'autoGainEnabled',
  'autoGainTargetDb',
  'harmonicToleranceCents',
  'aWeightingEnabled',
  'confidenceThreshold',
  'sustainMs',
  'clearMs',
  'thresholdMode',
  'prominenceDb',
  'noiseFloorAttackMs',
  'noiseFloorReleaseMs',
  'ignoreWhistle',
] as const satisfies readonly (keyof DetectorSettings)[]

const WORKER_RUNTIME_KEYS = [
  'mode',
  'fftSize',
  'smoothingTimeConstant',
  'minFrequency',
  'maxFrequency',
  'feedbackThresholdDb',
  'ringThresholdDb',
  'growthRateThreshold',
  'peakMergeCents',
  'eqPreset',
  'inputGainDb',
  'autoGainEnabled',
  'autoGainTargetDb',
  'harmonicToleranceCents',
  'aWeightingEnabled',
  'confidenceThreshold',
  'mainsHumEnabled',
  'mainsHumFundamental',
  'algorithmMode',
  'enabledAlgorithms',
  'adaptivePhaseSkip',
  'sustainMs',
  'clearMs',
  'thresholdMode',
  'prominenceDb',
  'noiseFloorAttackMs',
  'noiseFloorReleaseMs',
  'maxTracks',
  'trackTimeoutMs',
  'ignoreWhistle',
  'formantGateOverride',
  'chromaticGateOverride',
  'combSweepOverride',
  'ihrGateOverride',
  'ptmrGateOverride',
  'mainsHumGateOverride',
] as const satisfies readonly (keyof DetectorSettings)[]

export type AudioRuntimeSettings = Pick<DetectorSettings, (typeof AUDIO_RUNTIME_KEYS)[number]>
export type WorkerRuntimeSettings = Pick<DetectorSettings, (typeof WORKER_RUNTIME_KEYS)[number]>

export function pickAudioRuntimeSettings(settings: DetectorSettings): AudioRuntimeSettings {
  return pickSettings(settings, AUDIO_RUNTIME_KEYS)
}

export function pickWorkerRuntimeSettings(settings: DetectorSettings): WorkerRuntimeSettings {
  return pickSettings(settings, WORKER_RUNTIME_KEYS)
}
