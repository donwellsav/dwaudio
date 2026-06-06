/**
 * Typed localStorage abstraction — generic factory for per-domain storage.
 *
 * Every domain gets a typed accessor via typedStorage<T>(key, defaultValue).
 * All accessors share: try/catch, JSON ser/de, SSR guard, quota-safe writes.
 *
 * Domain-specific storage with complex behavior should live beside that
 * domain. Current analyzer recurrence state is intentionally in-memory only.
 */

// ── Quota exceeded detection ─────────────────────────────────────────────────

import { logError, logWarn } from '@/lib/utils/logger'

function isQuotaExceeded(err: unknown): boolean {
  return err instanceof DOMException && (
    err.name === 'QuotaExceededError' || err.code === 22
  )
}

/**
 * Notify the UI that localStorage is full. Dispatches a custom event on window
 * so any component can listen for it (e.g., show a "storage full" banner).
 */
function notifyQuotaExceeded(key: string): void {
  logError(`[dwaStorage] Storage quota exceeded writing "${key}" — settings may not persist. Clear old data or reduce usage.`)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('dwa:storage-quota-exceeded', { detail: { key } }))
  }
}

// ── Generic factory ──────────────────────────────────────────────────────────

export interface TypedStorage<T> {
  load(): T
  save(value: T): void
  clear(): void
}

/**
 * Create a typed localStorage accessor for a single domain.
 *
 * @param key       localStorage key
 * @param fallback  default value returned when key is missing or corrupt
 */
export function typedStorage<T>(key: string, fallback: T): TypedStorage<T> {
  return {
    load(): T {
      if (typeof window === 'undefined') return fallback
      try {
        const raw = localStorage.getItem(key)
        if (raw === null) return fallback
        const parsed = JSON.parse(raw)
        // Reject null and non-object primitives when fallback is an object —
        // prevents malformed localStorage from bypassing type safety
        if (parsed === null || parsed === undefined) return fallback
        if (Array.isArray(fallback) && !Array.isArray(parsed)) return fallback
        if (!Array.isArray(fallback) && Array.isArray(parsed)) return fallback
        if (typeof fallback === 'object' && typeof parsed !== 'object') return fallback
        return parsed as T
      } catch {
        return fallback
      }
    },

    save(value: T): void {
      if (typeof window === 'undefined') return
      try {
        localStorage.setItem(key, JSON.stringify(value))
      } catch (err) {
        if (isQuotaExceeded(err)) {
          notifyQuotaExceeded(key)
        } else {
          logWarn(`[dwaStorage] Failed to save "${key}":`, err instanceof Error ? err.message : err)
        }
      }
    },

    clear(): void {
      if (typeof window === 'undefined') return
      try {
        localStorage.removeItem(key)
      } catch {
        // Ignore
      }
    },
  }
}

// ── String storage (no JSON wrapper) ─────────────────────────────────────────

export interface StringStorage {
  load(): string
  save(value: string): void
  clear(): void
}

/**
 * Like typedStorage but for raw string values (no JSON serialization).
 */
export function stringStorage(key: string, fallback: string = ''): StringStorage {
  return {
    load(): string {
      if (typeof window === 'undefined') return fallback
      try {
        return localStorage.getItem(key) ?? fallback
      } catch {
        return fallback
      }
    },

    save(value: string): void {
      if (typeof window === 'undefined') return
      try {
        localStorage.setItem(key, value)
      } catch (err) {
        if (isQuotaExceeded(err)) {
          notifyQuotaExceeded(key)
        } else {
          logWarn(`[dwaStorage] Failed to save "${key}":`, err instanceof Error ? err.message : err)
        }
      }
    },

    clear(): void {
      if (typeof window === 'undefined') return
      try {
        localStorage.removeItem(key)
      } catch {
        // Ignore
      }
    },
  }
}

// ── Flag storage (boolean presence check) ────────────────────────────────────

export interface FlagStorage {
  isSet(): boolean
  set(): void
  clear(): void
}

/**
 * Boolean flag backed by key presence (value = 'true').
 */
export function flagStorage(key: string): FlagStorage {
  return {
    isSet(): boolean {
      if (typeof window === 'undefined') return false
      try {
        return localStorage.getItem(key) !== null
      } catch {
        return false
      }
    },

    set(): void {
      if (typeof window === 'undefined') return
      try {
        localStorage.setItem(key, 'true')
      } catch (err) {
        if (isQuotaExceeded(err)) {
          notifyQuotaExceeded(key)
        } else {
          logWarn(`[dwaStorage] Failed to set flag "${key}":`, err instanceof Error ? err.message : err)
        }
      }
    },

    clear(): void {
      if (typeof window === 'undefined') return
      try {
        localStorage.removeItem(key)
      } catch {
        // Ignore
      }
    },
  }
}

// ── Domain accessors ─────────────────────────────────────────────────────────

/** Selected audio input device ID */
export const deviceStorage = stringStorage('dwa-audio-device')

/** First-drag hint dismissed — once user drags the RTA threshold, hide the "Drag to adjust" label forever */
export const thresholdDraggedStorage = flagStorage('dwa-threshold-dragged')
