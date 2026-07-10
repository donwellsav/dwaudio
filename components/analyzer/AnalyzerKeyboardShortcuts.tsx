'use client'

import { memo, useEffect } from 'react'
import { useEngine } from '@/contexts/EngineContext'
import { useUI } from '@/contexts/UIContext'

export const AnalyzerKeyboardShortcuts = memo(function AnalyzerKeyboardShortcuts() {
  const { isRunning, isStarting, start, stop } = useEngine()
  const { toggleFreeze } = useUI()

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.target instanceof Element &&
        event.target.closest(
          'a[href], button, summary, input, select, textarea, [contenteditable], [role="button"], [role="slider"], [role="tab"]',
        )
      ) return

      switch (event.key) {
        case ' ':
          event.preventDefault()
          if (isRunning) {
            stop()
          } else if (!isStarting) {
            void start()
          }
          break
        case 'p':
        case 'P':
          if (!isRunning) return
          event.preventDefault()
          toggleFreeze()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isRunning, isStarting, start, stop, toggleFreeze])

  return null
})
