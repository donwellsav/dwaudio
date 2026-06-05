import type { DetectorSettings } from '@/types/advisory'
import type { ModeId } from '@/types/settings'
import {
  DEFAULT_DIAGNOSTICS,
  DEFAULT_DISPLAY_PREFS,
  DEFAULT_ENVIRONMENT,
  FRESH_START_SENSITIVITY_OFFSET_DB,
  DEFAULT_LIVE_OVERRIDES,
} from '@/lib/settings/defaults'
import { deriveDetectorSettings } from '@/lib/settings/deriveSettings'
import { MODE_BASELINES } from '@/lib/settings/modeBaselines'

/**
 * Builds the effective DetectorSettings default snapshot for a mode.
 *
 * This is the canonical bridge from the layered settings model back to the
 * legacy flat DetectorSettings bag used by older runtime consumers and tests.
 */
export function deriveDefaultDetectorSettings(modeId: ModeId = 'speech'): DetectorSettings {
  const baseline = MODE_BASELINES[modeId]

  return deriveDetectorSettings(
    baseline,
    DEFAULT_ENVIRONMENT,
    {
      ...DEFAULT_LIVE_OVERRIDES,
      inputGainDb: baseline.defaultInputGainDb,
    },
    DEFAULT_DISPLAY_PREFS,
    DEFAULT_DIAGNOSTICS,
  )
}

/**
 * Canonical flat settings snapshot for a brand-new Speech-mode session.
 *
 * This preserves the operator 26 dB startup behavior without changing the
 * explicit Speech mode baseline itself.
 */
export function deriveFreshStartDetectorSettings(): DetectorSettings {
  const baseline = MODE_BASELINES.speech

  return deriveDetectorSettings(
    baseline,
    DEFAULT_ENVIRONMENT,
    {
      ...DEFAULT_LIVE_OVERRIDES,
      inputGainDb: baseline.defaultInputGainDb,
      sensitivityOffsetDb: FRESH_START_SENSITIVITY_OFFSET_DB,
    },
    DEFAULT_DISPLAY_PREFS,
    DEFAULT_DIAGNOSTICS,
  )
}

/** Canonical flat settings snapshot for a fresh-start Speech session. */
export const DEFAULT_DETECTOR_SETTINGS = deriveFreshStartDetectorSettings()
