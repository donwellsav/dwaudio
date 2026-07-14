export function getPA2StatusDotClass(status: string): string {
  if (status === 'connected') return 'bg-green-500'
  if (status === 'connecting') return 'bg-yellow-500 animate-pulse'
  if (status === 'error') return 'bg-red-500'
  return 'bg-muted-foreground'
}

interface PA2TooltipTextParams {
  status: string
  error: string | null
  notchSlotsUsed: number
  notchSlotsAvailable: number
}

export function getPA2TooltipText({
  status,
  error,
  notchSlotsUsed,
  notchSlotsAvailable,
}: PA2TooltipTextParams): string {
  if (status === 'connected') {
    return `PA2 connected - PEQ ${notchSlotsUsed}/${notchSlotsUsed + notchSlotsAvailable} slots`
  }

  if (status === 'error') {
    return `PA2 error: ${error ?? 'connection failed'}`
  }

  return `PA2 ${status}`
}
