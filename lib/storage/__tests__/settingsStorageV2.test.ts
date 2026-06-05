// @vitest-environment jsdom
/**
 * Tests for the v2 settings storage layer.
 *
 * Covers:
 *   - Default fallback when localStorage is empty
 *   - Save/load round-trips for all four storage domains
 *   - Clear resets to defaults
 *   - Corrupt JSON graceful fallback
 *   - localStorage throw scenarios (getItem, setItem, removeItem)
 *   - QuotaExceededError handling
 *   - Domain isolation (v2 keys don't conflict with v1 or each other)
 *   - Partial/malformed stored data
 *   - Multiple presets round-trip
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DISPLAY_PREFS, DEFAULT_SESSION_STATE } from '@/lib/settings/defaults'
import {
  displayStorageV2,
  presetsStorageV2,
  sessionStorageV2,
  startupStorageV2,
} from '@/lib/storage/settingsStorageV2'
import type { DwaSessionState, RigPresetV1 } from '@/types/settings'

// ── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

afterEach(() => {
  localStorage.removeItem('dwa-v2-session')
  localStorage.removeItem('dwa-v2-display')
  localStorage.removeItem('dwa-v2-presets')
  localStorage.removeItem('dwa-v2-startup')
  vi.restoreAllMocks()
})

// ── sessionStorageV2 ─────────────────────────────────────────────────────────

describe('sessionStorageV2', () => {
  it('returns DEFAULT_SESSION_STATE when no saved data', () => {
    const loaded = sessionStorageV2.load()
    expect(loaded).toEqual(DEFAULT_SESSION_STATE)
  })

  it('round-trips session state', () => {
    const custom: DwaSessionState = {
      ...DEFAULT_SESSION_STATE,
      modeId: 'liveMusic',
      liveOverrides: {
        ...DEFAULT_SESSION_STATE.liveOverrides,
        sensitivityOffsetDb: 5,
      },
    }
    sessionStorageV2.save(custom)
    const loaded = sessionStorageV2.load()
    expect(loaded.modeId).toBe('liveMusic')
    expect(loaded.liveOverrides.sensitivityOffsetDb).toBe(5)
  })

  it('preserves environment mains-hum fields through round-trip', () => {
    const custom: DwaSessionState = {
      ...DEFAULT_SESSION_STATE,
      modeId: 'monitors',
      environment: {
        ...DEFAULT_SESSION_STATE.environment,
        mainsHumEnabled: false,
        mainsHumFundamental: 60,
      },
    }
    sessionStorageV2.save(custom)
    const loaded = sessionStorageV2.load()
    expect(loaded.environment.mainsHumEnabled).toBe(false)
    expect(loaded.environment.mainsHumFundamental).toBe(60)
  })

  it('clear resets to default', () => {
    sessionStorageV2.save({ ...DEFAULT_SESSION_STATE, modeId: 'worship' })
    sessionStorageV2.clear()
    expect(sessionStorageV2.load()).toEqual(DEFAULT_SESSION_STATE)
  })

  it('returns default when stored JSON is corrupt', () => {
    localStorage.setItem('dwa-v2-session', '{not valid json!!!')
    expect(sessionStorageV2.load()).toEqual(DEFAULT_SESSION_STATE)
  })

  it('returns default when stored value is a bare string', () => {
    localStorage.setItem('dwa-v2-session', 'just a string')
    expect(sessionStorageV2.load()).toEqual(DEFAULT_SESSION_STATE)
  })

  it('returns fallback default when stored value is null JSON', () => {
    localStorage.setItem('dwa-v2-session', 'null')
    // JSON.parse('null') === null; typedStorage now rejects null and returns fallback
    // This prevents malformed localStorage from corrupting app state
    const loaded = sessionStorageV2.load()
    expect(loaded).not.toBeNull()
    expect(loaded).toHaveProperty('modeId')
  })

  it('handles localStorage.getItem throwing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: access denied')
    })
    // Should not throw — falls back to default
    expect(sessionStorageV2.load()).toEqual(DEFAULT_SESSION_STATE)
  })

  it('handles localStorage.setItem throwing non-quota error', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Unknown storage error')
    })
    // Should not throw
    expect(() =>
      sessionStorageV2.save({ ...DEFAULT_SESSION_STATE, modeId: 'outdoor' }),
    ).not.toThrow()
  })

  it('handles QuotaExceededError on save without throwing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError')
    })
    expect(() =>
      sessionStorageV2.save({ ...DEFAULT_SESSION_STATE, modeId: 'broadcast' }),
    ).not.toThrow()
  })

  it('handles localStorage.removeItem throwing on clear', () => {
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError: storage disabled')
    })
    // clear() should swallow the error
    expect(() => sessionStorageV2.clear()).not.toThrow()
    spy.mockRestore()
  })
})

// ── displayStorageV2 ─────────────────────────────────────────────────────────

describe('displayStorageV2', () => {
  it('returns DEFAULT_DISPLAY_PREFS when no saved data', () => {
    expect(displayStorageV2.load()).toEqual(DEFAULT_DISPLAY_PREFS)
  })

  it('round-trips display prefs', () => {
    const custom = { ...DEFAULT_DISPLAY_PREFS, graphFontSize: 22, showFreqZones: true }
    displayStorageV2.save(custom)
    const loaded = displayStorageV2.load()
    expect(loaded.graphFontSize).toBe(22)
    expect(loaded.showFreqZones).toBe(true)
  })

  it('preserves boolean fields correctly', () => {
    const custom = {
      ...DEFAULT_DISPLAY_PREFS,
      showTooltips: false,
      showAlgorithmScores: true,
      showPeqDetails: true,
      showThresholdLine: false,
    }
    displayStorageV2.save(custom)
    const loaded = displayStorageV2.load()
    expect(loaded.showTooltips).toBe(false)
    expect(loaded.showAlgorithmScores).toBe(true)
    expect(loaded.showPeqDetails).toBe(true)
    expect(loaded.showThresholdLine).toBe(false)
  })

  it('clear resets display prefs to default', () => {
    displayStorageV2.save({ ...DEFAULT_DISPLAY_PREFS, graphFontSize: 99 })
    displayStorageV2.clear()
    expect(displayStorageV2.load()).toEqual(DEFAULT_DISPLAY_PREFS)
  })

  it('returns default on corrupt JSON', () => {
    localStorage.setItem('dwa-v2-display', '<<< broken >>>')
    expect(displayStorageV2.load()).toEqual(DEFAULT_DISPLAY_PREFS)
  })
})

// ── presetsStorageV2 ─────────────────────────────────────────────────────────

describe('presetsStorageV2', () => {
  const makePreset = (id: string, name: string, mode: string = 'speech'): RigPresetV1 => ({
    schemaVersion: 1,
    id,
    name,
    modeId: mode as RigPresetV1['modeId'],
    liveDefaults: DEFAULT_SESSION_STATE.liveOverrides,
    createdAt: '2026-03-25T00:00:00Z',
    updatedAt: '2026-03-25T00:00:00Z',
  })

  it('returns empty array when no saved presets', () => {
    expect(presetsStorageV2.load()).toEqual([])
  })

  it('round-trips a single preset', () => {
    const preset = makePreset('test-1', 'My Speech Preset')
    presetsStorageV2.save([preset])
    const loaded = presetsStorageV2.load()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].name).toBe('My Speech Preset')
    expect(loaded[0].schemaVersion).toBe(1)
  })

  it('round-trips multiple presets preserving order', () => {
    const presets = [
      makePreset('p1', 'Speech Rig', 'speech'),
      makePreset('p2', 'Music Rig', 'liveMusic'),
      makePreset('p3', 'Worship Rig', 'worship'),
    ]
    presetsStorageV2.save(presets)
    const loaded = presetsStorageV2.load()
    expect(loaded).toHaveLength(3)
    expect(loaded[0].id).toBe('p1')
    expect(loaded[1].id).toBe('p2')
    expect(loaded[2].id).toBe('p3')
    expect(loaded[1].modeId).toBe('liveMusic')
  })

  it('clear resets to empty array', () => {
    presetsStorageV2.save([makePreset('x', 'Temp')])
    presetsStorageV2.clear()
    expect(presetsStorageV2.load()).toEqual([])
  })

  it('returns empty array on corrupt JSON', () => {
    localStorage.setItem('dwa-v2-presets', 'not an array')
    expect(presetsStorageV2.load()).toEqual([])
  })

  it('overwriting presets replaces entire array', () => {
    presetsStorageV2.save([makePreset('a', 'First')])
    presetsStorageV2.save([makePreset('b', 'Second'), makePreset('c', 'Third')])
    const loaded = presetsStorageV2.load()
    expect(loaded).toHaveLength(2)
    expect(loaded[0].id).toBe('b')
  })
})

// ── startupStorageV2 ─────────────────────────────────────────────────────────

describe('startupStorageV2', () => {
  it('returns empty object when no saved preference', () => {
    expect(startupStorageV2.load()).toEqual({})
  })

  it('round-trips startup preference', () => {
    startupStorageV2.save({ presetId: 'test-1' })
    expect(startupStorageV2.load().presetId).toBe('test-1')
  })

  it('round-trips empty presetId (no auto-load)', () => {
    startupStorageV2.save({})
    const loaded = startupStorageV2.load()
    expect(loaded.presetId).toBeUndefined()
  })

  it('clear resets to empty object', () => {
    startupStorageV2.save({ presetId: 'abc' })
    startupStorageV2.clear()
    expect(startupStorageV2.load()).toEqual({})
  })

  it('returns default on corrupt JSON', () => {
    localStorage.setItem('dwa-v2-startup', '???')
    expect(startupStorageV2.load()).toEqual({})
  })
})

// ── Domain isolation ─────────────────────────────────────────────────────────

describe('v2 keys do not conflict with v1 keys', () => {
  it('v2 session key is distinct from v1 defaults key', () => {
    localStorage.setItem('dwa-custom-defaults', JSON.stringify({ mode: 'worship' }))
    sessionStorageV2.save({ ...DEFAULT_SESSION_STATE, modeId: 'liveMusic' })

    const v1 = JSON.parse(localStorage.getItem('dwa-custom-defaults') ?? '{}')
    const v2 = sessionStorageV2.load()

    expect(v1.mode).toBe('worship')
    expect(v2.modeId).toBe('liveMusic')

    localStorage.removeItem('dwa-custom-defaults')
  })
})

describe('v2 domains are isolated from each other', () => {
  it('saving session does not affect display', () => {
    sessionStorageV2.save({ ...DEFAULT_SESSION_STATE, modeId: 'outdoor' })
    expect(displayStorageV2.load()).toEqual(DEFAULT_DISPLAY_PREFS)
  })

  it('saving display does not affect presets', () => {
    displayStorageV2.save({ ...DEFAULT_DISPLAY_PREFS, graphFontSize: 30 })
    expect(presetsStorageV2.load()).toEqual([])
  })

  it('clearing one domain does not affect others', () => {
    sessionStorageV2.save({ ...DEFAULT_SESSION_STATE, modeId: 'worship' })
    displayStorageV2.save({ ...DEFAULT_DISPLAY_PREFS, showTooltips: false })
    startupStorageV2.save({ presetId: 'my-rig' })

    sessionStorageV2.clear()

    expect(sessionStorageV2.load()).toEqual(DEFAULT_SESSION_STATE)
    expect(displayStorageV2.load().showTooltips).toBe(false)
    expect(startupStorageV2.load().presetId).toBe('my-rig')
  })
})

// ── Error handling ───────────────────────────────────────────────────────────

describe('error handling across all domains', () => {
  it('all domains return defaults when getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Access denied')
    })

    expect(sessionStorageV2.load()).toEqual(DEFAULT_SESSION_STATE)
    expect(displayStorageV2.load()).toEqual(DEFAULT_DISPLAY_PREFS)
    expect(presetsStorageV2.load()).toEqual([])
    expect(startupStorageV2.load()).toEqual({})
  })

  it('all domains handle setItem throwing without propagating', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage disabled')
    })

    expect(() => sessionStorageV2.save(DEFAULT_SESSION_STATE)).not.toThrow()
    expect(() => displayStorageV2.save(DEFAULT_DISPLAY_PREFS)).not.toThrow()
    expect(() => presetsStorageV2.save([])).not.toThrow()
    expect(() => startupStorageV2.save({})).not.toThrow()
  })

  it('all domains handle removeItem throwing without propagating', () => {
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('Locked')
    })

    expect(() => sessionStorageV2.clear()).not.toThrow()
    expect(() => displayStorageV2.clear()).not.toThrow()
    expect(() => presetsStorageV2.clear()).not.toThrow()
    expect(() => startupStorageV2.clear()).not.toThrow()

    spy.mockRestore()
  })

  it('QuotaExceededError dispatches custom event', () => {
    const handler = vi.fn()
    window.addEventListener('dwa:storage-quota-exceeded', handler)

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError')
    })

    sessionStorageV2.save(DEFAULT_SESSION_STATE)
    expect(handler).toHaveBeenCalledTimes(1)
    expect((handler.mock.calls[0][0] as CustomEvent).detail.key).toBe('dwa-v2-session')

    window.removeEventListener('dwa:storage-quota-exceeded', handler)
  })
})

// ── Edge cases ───────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('empty string in localStorage falls back to default (invalid JSON)', () => {
    localStorage.setItem('dwa-v2-session', '')
    expect(sessionStorageV2.load()).toEqual(DEFAULT_SESSION_STATE)
  })

  it('stores and retrieves maximum allowed presets (5)', () => {
    const presets: RigPresetV1[] = Array.from({ length: 5 }, (_, i) => ({
      schemaVersion: 1 as const,
      id: `preset-${i}`,
      name: `Preset ${i}`,
      modeId: 'speech' as const,
      environment: DEFAULT_SESSION_STATE.environment,
      liveDefaults: DEFAULT_SESSION_STATE.liveOverrides,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }))
    presetsStorageV2.save(presets)
    expect(presetsStorageV2.load()).toHaveLength(5)
    expect(presetsStorageV2.load()[4].id).toBe('preset-4')
  })

  it('save then immediately load returns the saved value', () => {
    const custom = { ...DEFAULT_DISPLAY_PREFS, canvasTargetFps: 60 }
    displayStorageV2.save(custom)
    expect(displayStorageV2.load().canvasTargetFps).toBe(60)
  })

  it('multiple saves overwrite previous value', () => {
    sessionStorageV2.save({ ...DEFAULT_SESSION_STATE, modeId: 'speech' })
    sessionStorageV2.save({ ...DEFAULT_SESSION_STATE, modeId: 'worship' })
    sessionStorageV2.save({ ...DEFAULT_SESSION_STATE, modeId: 'outdoor' })
    expect(sessionStorageV2.load().modeId).toBe('outdoor')
  })

  it('stored data persists raw JSON in localStorage', () => {
    startupStorageV2.save({ presetId: 'rig-42' })
    const raw = localStorage.getItem('dwa-v2-startup')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!)
    expect(parsed.presetId).toBe('rig-42')
  })
})
