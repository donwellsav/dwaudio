// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GEQBarEmptyState } from '@/components/analyzer/GEQBarEmptyState'

describe('GEQBarEmptyState', () => {
  it('does not claim cuts are unnecessary when no recommendation exists', () => {
    render(<GEQBarEmptyState isRunning />)

    expect(screen.getByText(/no active eq cuts/i)).toBeDefined()
    expect(screen.queryByText(/no cuts needed/i)).toBeNull()
  })

  it('reports guard and signal states instead of fake recommendations', () => {
    const { rerender } = render(<GEQBarEmptyState isRunning isLowSignal />)
    expect(screen.getByText(/waiting for usable signal/i)).toBeDefined()

    rerender(
      <GEQBarEmptyState
        isRunning
        spectrumStatus={{ peak: -32, contentType: 'music', isSignalPresent: true }}
      />,
    )
    expect(screen.getByText(/music guard active/i)).toBeDefined()

    rerender(
      <GEQBarEmptyState
        isRunning
        spectrumStatus={{ peak: -32, contentType: 'compressed', isSignalPresent: true }}
      />,
    )
    expect(screen.getByText(/compression guard active/i)).toBeDefined()
  })
})
