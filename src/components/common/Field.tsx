import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { InlineError } from './states'

/**
 * Label + control + hint + error with correct aria wiring. The single child
 * control receives id, aria-invalid and aria-describedby.
 */
export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: string
  required?: boolean
  className?: string
  children: ReactElement<Record<string, unknown>>
}) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
  const control = isValidElement(children)
    ? cloneElement(children, {
        id: (children.props.id as string | undefined) ?? id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
      })
    : children
  const controlId = (isValidElement(children) && (children.props.id as string | undefined)) || id
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={controlId} className="text-xs font-medium text-foreground/80">
        {label}
        {required && <span className="text-destructive" aria-hidden>*</span>}
      </Label>
      {control}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      <InlineError id={errorId}>{error}</InlineError>
    </div>
  )
}
