import { describe, expect, it } from 'vitest'
import { getAudioAnalyzerErrorGuidance } from '@/lib/analyzer/audioAnalyzerErrorGuidance'

describe('getAudioAnalyzerErrorGuidance', () => {
  it('prefers HTTPS guidance on insecure non-local pages', () => {
    expect(
      getAudioAnalyzerErrorGuidance('Permission denied', {
        protocol: 'http:',
        hostname: 'donewellaudio.com',
      }),
    ).toBe('Microphone requires a secure (HTTPS) connection. Ask your admin to enable HTTPS.')
  })

  it('returns permission guidance for mic permission errors', () => {
    expect(
      getAudioAnalyzerErrorGuidance('Permission denied by user'),
    ).toContain('Click the mic icon')
  })

  it('does not show HTTPS guidance for loopback permission errors', () => {
    expect(
      getAudioAnalyzerErrorGuidance('Permission denied by system', {
        protocol: 'http:',
        hostname: '127.0.0.1',
      }),
    ).toContain('Click the mic icon')
  })

  it('falls back to the generic guidance for unknown errors', () => {
    expect(getAudioAnalyzerErrorGuidance('Something odd happened')).toBe(
      'Check your microphone connection and browser permissions.',
    )
  })
})
