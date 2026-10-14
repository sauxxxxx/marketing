import { CalendarHeart, Plus } from 'lucide-react'
import type { KeyDate } from '@/types/database'
import { formatDate } from '@/lib/dates'
import { cn } from '@/lib/utils'

export function DayHeader({
  date,
  today,
  keyDates,
  dimmed,
  canCreate,
  onCreate,
  large,
}: {
  date: string
  today: string
  keyDates: KeyDate[]
  dimmed?: boolean
  canCreate: boolean
  onCreate: () => void
  large?: boolean
}) {
  const isToday = date === today
  return (
    <div className="pointer-events-none flex items-start justify-between gap-1">
      <div className="min-w-0">
        <span
          className={cn(
            'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold tabular',
            isToday && 'bg-primary text-primary-foreground',
            dimmed && !isToday && 'text-muted-foreground/60',
          )}
          aria-label={formatDate(date, 'EEEE, d MMMM yyyy') + (isToday ? ' (today)' : '')}
        >
          {large ? formatDate(date, 'EEE d') : formatDate(date, 'd')}
        </span>
        {keyDates.map((k) => (
          <div
            key={k.id}
            className="mt-0.5 flex items-center gap-1 text-[10.5px] font-medium leading-tight text-rose-800"
            title={k.notes ?? k.name}
          >
            <CalendarHeart className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{k.name}</span>
          </div>
        ))}
      </div>
      {canCreate && (
        <button
          type="button"
          onClick={onCreate}
          className="pointer-events-auto flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-hover/day:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
          aria-label={`Add content on ${formatDate(date, 'd MMMM')}`}
        >
          <Plus className="size-3.5" />
        </button>
      )}
    </div>
  )
}
