'use client'

import { memo, type KeyboardEvent, type MutableRefObject } from 'react'
import { AlertTriangle, Settings2 } from 'lucide-react'
import { haptic } from '@/components/analyzer/MobileLayoutCommon'
import type { MobileTabId } from '@/hooks/useMobileTabNavigation'

interface MobileBottomNavProps {
  activeAdvisoryCount: number
  handleTabKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  mobileTab: MobileTabId
  setMobileTab: (tab: MobileTabId) => void
  tabIndex: number
  tabRefs: MutableRefObject<(HTMLButtonElement | null)[]>
}

const MOBILE_BOTTOM_TABS = [
  { id: 'issues' as const, label: 'Issues', Icon: AlertTriangle },
  { id: 'settings' as const, label: 'Settings', Icon: Settings2 },
]

export const MobileBottomNav = memo(function MobileBottomNav({
  activeAdvisoryCount,
  handleTabKeyDown,
  mobileTab,
  setMobileTab,
  tabIndex,
  tabRefs,
}: MobileBottomNavProps) {
  return (
    <nav
      className="landscape:hidden xl:hidden flex-shrink-0 border-t border-border/60 bg-card/90 backdrop-blur-sm"
      style={{ paddingBottom: 'var(--safe-bottom)' }}
    >
      <div className="flex items-stretch relative" role="tablist" onKeyDown={handleTabKeyDown}>
        <div
          className="absolute top-0 h-[2px] bg-[var(--console-amber)] rounded-full transition-[left,width] duration-200 ease-out"
          style={{ left: `${tabIndex * 50 + 10}%`, width: '30%' }}
          aria-hidden
        />
        {MOBILE_BOTTOM_TABS.map((tab, index) => {
          const badge = tab.id === 'issues' ? activeAdvisoryCount : 0

          return (
            <button
              key={tab.id}
              ref={(element) => {
                tabRefs.current[index] = element
              }}
              onClick={() => {
                haptic()
                setMobileTab(tab.id)
              }}
              role="tab"
              id={`mobile-tab-${tab.id}`}
              aria-selected={mobileTab === tab.id}
              aria-controls={`mobile-tabpanel-${tab.id}`}
              tabIndex={mobileTab === tab.id ? 0 : -1}
              className={`cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 flex-1 flex flex-col items-center justify-center py-2 gap-0.5 min-h-[50px] transition-colors relative ${
                mobileTab === tab.id
                  ? 'text-[var(--console-amber)] bg-[var(--console-amber)]/5'
                  : 'text-muted-foreground active:text-foreground'
              }`}
              aria-label={tab.label}
            >
              <div className="relative">
                <tab.Icon
                  className={
                    mobileTab === tab.id ? 'w-[22px] h-[22px] motion-safe:animate-tab-bounce' : 'w-5 h-5'
                  }
                />
                {badge > 0 ? (
                  <span
                    className="absolute -top-1.5 -right-2.5 bg-[var(--console-amber)] text-background text-xs rounded-full min-w-[16px] h-[16px] flex items-center justify-center font-bold leading-none px-0.5"
                    aria-label={`${badge} active feedback ${badge === 1 ? 'detection' : 'detections'}`}
                    role="status"
                  >
                    {badge}
                  </span>
                ) : null}
              </div>
              <span className="text-sm font-mono font-bold tracking-[0.15em] leading-none">{tab.label}</span>
            </button>
          )
        })}
      </div>
      <div className="flex items-center justify-center py-0.5" aria-hidden>
        <span className="font-mono text-dwa-xs tracking-[0.15em] text-muted-foreground/25 uppercase">
          DoneWell Audio - v{process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0'}
        </span>
      </div>
    </nav>
  )
})
