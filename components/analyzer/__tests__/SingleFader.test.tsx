// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SingleFader } from '@/components/analyzer/SingleFader'

const faderTrackProps = vi.hoisted(() => [] as Array<{
  onTrackTouchStart?: () => void
  referenceValue?: number
}>)

vi.mock('@/hooks/useFaderMeterCanvas', () => ({
  useFaderMeterCanvas: () => ({
    canvasRef: { current: null },
    trackRef: { current: null },
  }),
}))

vi.mock('@/hooks/useWheelStep', () => ({
  useWheelStep: vi.fn(),
}))

vi.mock('@/components/analyzer/FaderTrack', () => ({
  FaderTrack: (props: {
    onTrackTouchStart?: () => void
    referenceValue?: number
  }) => {
    faderTrackProps.push(props)
    return (
      <button
        type="button"
        data-testid="fader-track"
        onClick={() => props.onTrackTouchStart?.()}
      >
        track
      </button>
    )
  },
}))

afterEach(() => {
  vi.useRealTimers()
  faderTrackProps.length = 0
})

describe('SingleFader', () => {
  it('uses the configured sensitivity home for double-tap reset and reference line', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const onChange = vi.fn()

    render(
      <SingleFader
        mode="sensitivity"
        value={34}
        onChange={onChange}
        min={2}
        max={50}
        label="SENS"
        homeValue={26}
      />,
    )

    expect(faderTrackProps.at(-1)?.referenceValue).toBe(26)

    fireEvent.click(screen.getByTestId('fader-track'))
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('fader-track'))
    expect(onChange).toHaveBeenCalledWith(26)
  })

  it('uses the configured gain home and disables auto-gain on double-tap reset', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const onChange = vi.fn()
    const onAutoGainToggle = vi.fn()

    render(
      <SingleFader
        mode="gain"
        value={8}
        onChange={onChange}
        min={-40}
        max={40}
        label="GAIN"
        autoGainEnabled
        onAutoGainToggle={onAutoGainToggle}
        homeValue={-3}
      />,
    )

    fireEvent.click(screen.getByTestId('fader-track'))
    fireEvent.click(screen.getByTestId('fader-track'))

    expect(onAutoGainToggle).toHaveBeenCalledWith(false)
    expect(onChange).toHaveBeenCalledWith(-3)
  })
})
