import { describe, expect, it } from 'vitest'

import { parseFftSize } from '../shared'

describe('parseFftSize', () => {
  it('accepts supported FFT sizes exactly', () => {
    expect(parseFftSize('4096')).toBe(4096)
    expect(parseFftSize('8192')).toBe(8192)
    expect(parseFftSize('16384')).toBe(16384)
  })

  it('falls back to the default when the value is malformed or unsupported', () => {
    expect(parseFftSize('4096x')).toBe(4096)
    expect(parseFftSize('8192.5')).toBe(4096)
    expect(parseFftSize('32768')).toBe(4096)
    expect(parseFftSize('')).toBe(4096)
  })
})
