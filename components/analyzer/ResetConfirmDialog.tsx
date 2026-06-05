'use client'

import { memo } from 'react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { RotateCcw } from 'lucide-react'

interface ResetConfirmDialogProps {
  onConfirm: () => void
  trigger?: React.ReactNode
  showLabel?: boolean
}

export const ResetConfirmDialog = memo(function ResetConfirmDialog({ onConfirm, trigger, showLabel = false }: ResetConfirmDialogProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {trigger || (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            title="Reset detection settings to defaults"
          >
            <RotateCcw className="w-4 h-4" />
            {showLabel && <span>Reset</span>}
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>Reset settings?</AlertDialogTitle>
        <AlertDialogDescription>
          This will restore all detection settings to their defaults (Speech mode, 26dB sensitivity, input gain 0dB). Active issues will be cleared.
        </AlertDialogDescription>
        <div className="flex items-center gap-3 justify-end">
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            Reset
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
})
