import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@/lib/dsp/constants'
import {
  deriveDefaultDetectorSettings,
  deriveFreshStartDetectorSettings,
} from '@/lib/settings/defaultDetectorSettings'
import {
  DEFAULT_DIAGNOSTICS,
  DEFAULT_DISPLAY_PREFS,
  DEFAULT_ENVIRONMENT,
  FRESH_START_SENSITIVITY_OFFSET_DB,
  DEFAULT_LIVE_OVERRIDES,
} from '@/lib/settings/defaults'
import { deriveDetectorSettings } from '@/lib/settings/deriveSettings'
import { MODE_BASELINES } from '@/lib/settings/modeBaselines'

describe('deriveDefaultDetectorSettings', () => {
  it('matches the layered Speech composition for explicit Speech mode defaults', () => {
    const expected = deriveDetectorSettings(
      MODE_BASELINES.speech,
      DEFAULT_ENVIRONMENT,
      {
        ...DEFAULT_LIVE_OVERRIDES,
        inputGainDb: MODE_BASELINES.speech.defaultInputGainDb,
      },
      DEFAULT_DISPLAY_PREFS,
      DEFAULT_DIAGNOSTICS,
    )

    expect(deriveDefaultDetectorSettings('speech')).toEqual(expected)
    expect(deriveDefaultDetectorSettings('speech').feedbackThresholdDb).toBe(20)
  })

  it('exports the fresh-start compatibility snapshot at 26 dB with 0 dB gain', () => {
    const expected = deriveDetectorSettings(
      MODE_BASELINES.speech,
      DEFAULT_ENVIRONMENT,
      {
        ...DEFAULT_LIVE_OVERRIDES,
        inputGainDb: MODE_BASELINES.speech.defaultInputGainDb,
        sensitivityOffsetDb: FRESH_START_SENSITIVITY_OFFSET_DB,
      },
      DEFAULT_DISPLAY_PREFS,
      DEFAULT_DIAGNOSTICS,
    )

    expect(deriveFreshStartDetectorSettings()).toEqual(expected)
    expect(DEFAULT_SETTINGS).toEqual(expected)
    expect(DEFAULT_SETTINGS.feedbackThresholdDb).toBe(26)
    expect(DEFAULT_SETTINGS.inputGainDb).toBe(0)
    expect(DEFAULT_SETTINGS.sustainMs).toBeLessThanOrEqual(180)
    expect(DEFAULT_DISPLAY_PREFS.faderLinkCenterSensDb).toBe(26)
    expect(DEFAULT_SETTINGS.faderLinkCenterSensDb).toBe(26)
    expect(DEFAULT_DISPLAY_PREFS.showFreqZones).toBe(true)
    expect(DEFAULT_SETTINGS.showFreqZones).toBe(true)
  })

  it('keeps mode-owned defaults aligned for non-Speech modes', () => {
    const broadcastDefaults = deriveDefaultDetectorSettings('broadcast')
    const liveMusicDefaults = deriveDefaultDetectorSettings('liveMusic')

    expect(broadcastDefaults.feedbackThresholdDb).toBe(MODE_BASELINES.broadcast.feedbackThresholdDb)
    expect(broadcastDefaults.trackTimeoutMs).toBe(MODE_BASELINES.broadcast.defaultTrackTimeoutMs)
    expect(broadcastDefaults.autoGainTargetDb).toBe(MODE_BASELINES.broadcast.defaultAutoGainTargetDb)
    expect(liveMusicDefaults.sustainMs).toBeLessThanOrEqual(240)
  })
})
