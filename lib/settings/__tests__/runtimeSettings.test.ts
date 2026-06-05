import { describe, expect, it } from 'vitest'
import {
  pickAudioRuntimeSettings,
  pickWorkerRuntimeSettings,
} from '@/lib/settings/runtimeSettings'
import { DEFAULT_DETECTOR_SETTINGS } from '@/lib/settings/defaultDetectorSettings'

describe('runtime settings', () => {
  it('does not expose room settings to audio analyzer runtime', () => {
    const runtimeSettings = pickAudioRuntimeSettings(DEFAULT_DETECTOR_SETTINGS)

    expect('roomPreset' in runtimeSettings).toBe(false)
    expect('roomRT60' in runtimeSettings).toBe(false)
    expect('roomVolume' in runtimeSettings).toBe(false)
  })

  it('does not expose room settings to DSP worker runtime', () => {
    const runtimeSettings = pickWorkerRuntimeSettings(DEFAULT_DETECTOR_SETTINGS)

    expect('roomPreset' in runtimeSettings).toBe(false)
    expect('roomRT60' in runtimeSettings).toBe(false)
    expect('roomVolume' in runtimeSettings).toBe(false)
    expect('roomLengthM' in runtimeSettings).toBe(false)
    expect('roomWidthM' in runtimeSettings).toBe(false)
    expect('roomHeightM' in runtimeSettings).toBe(false)
  })
})
