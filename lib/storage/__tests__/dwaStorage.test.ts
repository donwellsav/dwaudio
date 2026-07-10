// @vitest-environment jsdom
/**
 * Tests for dwaStorage.ts — typed localStorage abstraction.
 *
 * Covers three factory functions (typedStorage, stringStorage, flagStorage),
 * and domain accessors.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  typedStorage,
  stringStorage,
  flagStorage,
} from '../dwaStorage'

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear()
})

// ── typedStorage ──────────────────────────────────────────────────────────────

describe('typedStorage', () => {
  it('reports storage presence without throwing when access is denied', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied')
    })

    try {
      expect(typedStorage('test-denied', {} as object).exists()).toBe(false)
    } finally {
      getItem.mockRestore()
    }
  })

  it('returns fallback when key does not exist', () => {
    const store = typedStorage<number[]>('test-typed', [1, 2, 3])
    expect(store.load()).toEqual([1, 2, 3])
  })

  it('round-trips JSON save/load', () => {
    const store = typedStorage<{ name: string; count: number }>('test-typed-obj', { name: '', count: 0 })
    store.save({ name: 'feedback', count: 42 })
    expect(store.load()).toEqual({ name: 'feedback', count: 42 })
  })

  it('clear removes the key and load returns fallback', () => {
    const store = typedStorage<string>('test-clear', 'default')
    store.save('stored')
    expect(store.load()).toBe('stored')
    store.clear()
    expect(store.load()).toBe('default')
  })

  it('returns fallback when stored JSON is corrupt', () => {
    localStorage.setItem('test-corrupt', '{invalid json!!!}')
    const store = typedStorage<number>('test-corrupt', 99)
    expect(store.load()).toBe(99)
  })

  it('rejects object and array shape mismatches', () => {
    localStorage.setItem('test-array-store', JSON.stringify({ 0: 1, length: 1 }))
    const arrayStore = typedStorage<number[]>('test-array-store', [1, 2, 3])
    expect(arrayStore.load()).toEqual([1, 2, 3])

    localStorage.setItem('test-object-store', JSON.stringify(['not', 'an', 'object']))
    const objectStore = typedStorage<{ enabled: boolean }>('test-object-store', { enabled: false })
    expect(objectStore.load()).toEqual({ enabled: false })
  })

  it('silently handles QuotaExceededError on save', () => {
    const store = typedStorage<string>('test-quota', '')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    // Should not throw
    expect(() => store.save('big data')).not.toThrow()
    vi.restoreAllMocks()
  })
})

// ── stringStorage ─────────────────────────────────────────────────────────────

describe('stringStorage', () => {
  it('returns empty string fallback by default', () => {
    const store = stringStorage('test-str')
    expect(store.load()).toBe('')
  })

  it('returns custom fallback when key is missing', () => {
    const store = stringStorage('test-str-custom', 'default-device')
    expect(store.load()).toBe('default-device')
  })

  it('stores raw string without JSON wrapping', () => {
    const store = stringStorage('test-str-raw')
    store.save('device-id-123')
    // Raw value in localStorage — no JSON quotes
    expect(localStorage.getItem('test-str-raw')).toBe('device-id-123')
    expect(store.load()).toBe('device-id-123')
  })

  it('clear removes key', () => {
    const store = stringStorage('test-str-clear')
    store.save('value')
    store.clear()
    expect(store.load()).toBe('')
  })
})

// ── flagStorage ───────────────────────────────────────────────────────────────

describe('flagStorage', () => {
  it('isSet returns false when key does not exist', () => {
    const flag = flagStorage('test-flag')
    expect(flag.isSet()).toBe(false)
  })

  it('set makes isSet return true', () => {
    const flag = flagStorage('test-flag-set')
    flag.set()
    expect(flag.isSet()).toBe(true)
  })

  it('clear makes isSet return false again', () => {
    const flag = flagStorage('test-flag-cycle')
    flag.set()
    expect(flag.isSet()).toBe(true)
    flag.clear()
    expect(flag.isSet()).toBe(false)
  })

  it('stores the string "true" as the value', () => {
    const flag = flagStorage('test-flag-value')
    flag.set()
    expect(localStorage.getItem('test-flag-value')).toBe('true')
  })
})
