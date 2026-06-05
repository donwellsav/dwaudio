// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useEngineMock: vi.fn(),
  useMeteringMock: vi.fn(),
  useSettingsMock: vi.fn(),
}))

vi.mock('@/contexts/EngineContext', () => ({
  useEngine: mocks.useEngineMock,
}))

vi.mock('@/contexts/MeteringContext', () => ({
  useMetering: mocks.useMeteringMock,
}))

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: mocks.useSettingsMock,
}))

import { AudioAnalyzerFooter } from '../AudioAnalyzerFooter'

describe('AudioAnalyzerFooter', () => {
  beforeEach(() => {
    mocks.useEngineMock.mockReturnValue({
      isRunning: true,
    })
    mocks.useMeteringMock.mockReturnValue({
      spectrumStatus: {
        algorithmMode: 'custom',
        contentType: 'speech',
        msdFrameCount: 12,
      },
    })
    mocks.useSettingsMock.mockReturnValue({
      settings: {
        algorithmMode: 'auto',
      },
    })
  })

  it('renders the existing footer text and a muted FPS label', () => {
    render(<AudioAnalyzerFooter actualFps={30} droppedPercent={0} />)

    expect(screen.getByText('DoneWell Audio Analyzer')).not.toBeNull()

    const fps = screen.getByText('FPS 30')
    expect(fps.className).toContain('font-mono')
    expect(fps.className).toContain('text-dwa-xs')
    expect(fps.className).toContain('tabular-nums')
    expect(fps.className).toContain('text-muted-foreground/40')
  })

  it('hides the FPS label when no measured fps is available', () => {
    render(<AudioAnalyzerFooter actualFps={0} droppedPercent={0} />)

    expect(screen.queryByText(/FPS \d+/)).toBeNull()
  })

  it('switches FPS severity colors at the documented thresholds', () => {
    const { rerender } = render(<AudioAnalyzerFooter actualFps={30} droppedPercent={6} />)

    expect(screen.getByText('FPS 30').className).toContain('text-amber-400')

    rerender(<AudioAnalyzerFooter actualFps={30} droppedPercent={21} />)

    expect(screen.getByText('FPS 30').className).toContain('text-red-400')
  })
})
