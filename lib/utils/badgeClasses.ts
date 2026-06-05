/**
 * Severity badge class vocabulary.
 *
 * Centralizes the inline `text-{color}-400 bg-{color}-500/15 border-{color}-500/30`
 * patterns that were scattered across IssueCard, EarlyWarningPanel, and others.
 * Each tone ships both dark and light variants so badges read on either theme.
 *
 * Usage:
 *   <span className={badgeClass('warning')}><Icon />TEXT</span>
 *   <span className={badgeClass('info', 'sm')}>3pk</span>
 */

export type BadgeTone = 'success' | 'warning' | 'error' | 'info'
export type BadgeSize = 'sm' | 'md'

const BASE_MD = 'inline-flex items-center gap-0.5 text-[10px] font-bold px-1 py-px rounded-sm leading-none border'
const BASE_SM = 'inline-flex items-center text-[9px] px-0.5 py-px rounded-sm leading-none border'

const TONES: Record<BadgeTone, string> = {
  success: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/30',
  warning: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/30',
  error:   'bg-red-100 text-red-800 border-red-300 dark:bg-red-500/15 dark:text-red-400 dark:border-red-500/30',
  info:    'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-500/10 dark:text-sky-400/80 dark:border-sky-500/20',
}

export function badgeClass(tone: BadgeTone, size: BadgeSize = 'md'): string {
  return `${size === 'md' ? BASE_MD : BASE_SM} ${TONES[tone]}`
}
