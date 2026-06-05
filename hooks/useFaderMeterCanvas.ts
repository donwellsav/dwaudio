'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useTheme } from 'next-themes'
import type { FaderMode } from '@/components/analyzer/faderTypes'
import { meterBg, applyMeterStops } from '@/lib/canvas/canvasTokens'
import { DEFAULT_DISPLAY_PREFS } from '@/lib/settings/defaults'

interface UseFaderMeterCanvasParams {
  mode: FaderMode
  min: number
  max: number
  level: number
  showSensitivityZones?: boolean
}

export function useFaderMeterCanvas({
  mode,
  min,
  max,
  level,
  showSensitivityZones = false,
}: UseFaderMeterCanvasParams) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== 'light'
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const dimensionsRef = useRef({ width: 0, height: 0 })
  const gradientRef = useRef<CanvasGradient | null>(null)
  const gradientHeightRef = useRef(0)
  const targetLevelRef = useRef(0)
  const smoothedLevelRef = useRef(0)
  const prevDrawnRef = useRef(-1)
  const rafIdRef = useRef(0)

  const isSensitivity = mode === 'sensitivity'
  const normalizedLevel = Math.max(0, Math.min(1, (level + 60) / 60))

  useEffect(() => {
    targetLevelRef.current = normalizedLevel
  }, [normalizedLevel])

  useEffect(() => {
    const track = trackRef.current
    if (!track) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        dimensionsRef.current = { width, height }
        const canvas = canvasRef.current
        if (canvas) {
          const dpr = window.devicePixelRatio || 1
          canvas.width = Math.floor(width * dpr)
          canvas.height = Math.floor(height * dpr)
        }
        prevDrawnRef.current = -1
      }
    })

    observer.observe(track)
    return () => observer.disconnect()
  }, [])

  const drawMeter = useCallback((smoothed: number) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const { width, height } = dimensionsRef.current
    if (width === 0 || height === 0) return

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, height)

    ctx.fillStyle = meterBg(isDark)
    ctx.fillRect(0, 0, width, height)

    let gradient = gradientRef.current
    if (!gradient || gradientHeightRef.current !== height) {
      gradient = applyMeterStops(ctx.createLinearGradient(0, height, 0, 0))
      gradientRef.current = gradient
      gradientHeightRef.current = height
    }

    const meterHeight = height * smoothed
    ctx.fillStyle = gradient
    ctx.fillRect(0, height - meterHeight, width, meterHeight)

    if (meterHeight > 2) {
      ctx.fillStyle = 'rgba(255,255,255,0.10)'
      ctx.fillRect(0, height - meterHeight, Math.max(1, width * 0.2), meterHeight)
    }

    const labelSize = Math.max(7, Math.min(9, width * 0.2))

    if (isSensitivity) {
      for (const db of [10, 20, 30, 40]) {
        const ratio = (50 - db) / 48
        const y = height * (1 - ratio)

        ctx.strokeStyle = 'rgba(100,180,255,0.15)'
        ctx.lineWidth = 0.75
        ctx.beginPath()
        ctx.moveTo(width * 0.55, y)
        ctx.lineTo(width, y)
        ctx.stroke()

        ctx.fillStyle = 'rgba(100,180,255,0.25)'
        ctx.font = `${labelSize}px monospace`
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'
        ctx.fillText(`${db}`, width * 0.48, y)
      }

      if (showSensitivityZones) {
        const zoneSize = Math.max(5, Math.min(7, width * 0.14))
        ctx.font = `${zoneSize}px monospace`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'

        for (const { db, label } of [
          { db: 15, label: 'MON' },
          { db: 27, label: 'SPK' },
          { db: 42, label: 'MUS' },
        ]) {
          const y = height * (1 - (50 - db) / 48)
          ctx.fillStyle = 'rgba(100,180,255,0.12)'
          ctx.fillText(label, 2, y)
        }
      }

      const defaultDb = DEFAULT_DISPLAY_PREFS.faderLinkCenterSensDb
      const defaultRatio = (50 - defaultDb) / 48
      const defaultY = height * (1 - defaultRatio)
      ctx.strokeStyle = 'rgba(100,180,255,0.35)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(0, defaultY)
      ctx.lineTo(width, defaultY)
      ctx.stroke()
      ctx.fillStyle = 'rgba(100,180,255,0.45)'
      ctx.font = `bold ${labelSize + 1}px monospace`
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(defaultDb), width * 0.48, defaultY)
      return
    }

    const rootStyle = getComputedStyle(document.documentElement)
    const tintR = rootStyle.getPropertyValue('--tint-r').trim() || '245'
    const tintG = rootStyle.getPropertyValue('--tint-g').trim() || '158'
    const tintB = rootStyle.getPropertyValue('--tint-b').trim() || '11'
    const tint = (alpha: number) => `rgba(${tintR},${tintG},${tintB},${alpha})`

    for (const db of [-30, -20, -10, 10, 20, 30]) {
      const ratio = (db - min) / (max - min)
      const y = height * (1 - ratio)

      ctx.strokeStyle = tint(0.18)
      ctx.lineWidth = 0.75
      ctx.beginPath()
      ctx.moveTo(width * 0.55, y)
      ctx.lineTo(width, y)
      ctx.stroke()

      ctx.fillStyle = tint(0.28)
      ctx.font = `${labelSize}px monospace`
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText(`${db}`, width * 0.48, y)
    }

    const zeroRatio = (0 - min) / (max - min)
    const zeroY = height * (1 - zeroRatio)
    ctx.strokeStyle = tint(0.45)
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(0, zeroY)
    ctx.lineTo(width, zeroY)
    ctx.stroke()
    ctx.strokeStyle = tint(0.08)
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(0, zeroY + 1.5)
    ctx.lineTo(width, zeroY + 1.5)
    ctx.stroke()
    ctx.fillStyle = tint(0.55)
    ctx.font = `bold ${labelSize + 1}px monospace`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText('0', width * 0.48, zeroY)
  }, [isDark, isSensitivity, max, min, showSensitivityZones])

  useEffect(() => {
    const ATTACK = 0.3
    const DECAY = 0.05

    const tick = () => {
      const target = targetLevelRef.current
      const current = smoothedLevelRef.current
      const coeff = target > current ? ATTACK : DECAY
      const next = current + (target - current) * coeff
      const smoothed = Math.abs(next - target) < 0.001 ? target : next
      smoothedLevelRef.current = smoothed

      if (Math.abs(smoothed - prevDrawnRef.current) > 0.0005) {
        prevDrawnRef.current = smoothed
        drawMeter(smoothed)
      }

      rafIdRef.current = requestAnimationFrame(tick)
    }

    rafIdRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafIdRef.current)
  }, [drawMeter])

  useEffect(() => {
    prevDrawnRef.current = -1
  }, [isDark])

  return {
    canvasRef,
    trackRef,
  }
}
