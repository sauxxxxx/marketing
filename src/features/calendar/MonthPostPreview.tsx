import { StatusBadge } from '@/components/content/badges'
import type { ContentItem } from '@/types/database'
import type { Lookups } from '@/hooks/useWorkspaceData'
import { formatTime } from '@/lib/dates'
import { overdueReason } from '@/lib/summary'
import { cn } from '@/lib/utils'

/** A fixed-height, two-line preview; full metadata lives in the day drawer. */
export function MonthPostPreview({
  item,
  lookups,
  today,
  showBrand,
  dragging,
  pending,
}: {
  item: ContentItem
  lookups: Lookups
  today: string
  showBrand: boolean
  dragging: boolean
  pending: boolean
}) {
  const brand = lookups.brandById.get(item.brand_id)
  const format = lookups.formatById.get(item.format_id)
  const overdue = overdueReason(item, today)
  return (
    <div
      className={cn(
        'flex h-8 min-w-0 flex-col justify-center rounded border-l-2 bg-background px-1.5 text-left hover:bg-accent/60',
        dragging && 'opacity-40',
        pending && 'animate-pulse',
        item.status === 'cancelled' && 'opacity-60',
      )}
      style={{ borderLeftColor: format?.color ?? 'var(--border)' }}
      title={[brand?.name, item.title, format?.name].filter(Boolean).join(' · ')}
    >
      <div className="flex min-w-0 items-center gap-1 text-xs leading-4">
        <StatusBadge status={item.status} compact />
        <span className={cn('min-w-0 truncate font-medium', item.status === 'cancelled' && 'line-through')}>
          {item.title}
        </span>
        {overdue && (
          <span className="ml-auto font-semibold text-destructive" title="Overdue">
            !<span className="sr-only">Overdue</span>
          </span>
        )}
      </div>
      <div className="flex min-w-0 gap-1 text-[11px] leading-3 text-muted-foreground">
        {item.scheduled_time && <span className="shrink-0 tabular">{formatTime(item.scheduled_time)}</span>}
        <span className="min-w-0 truncate">{showBrand ? brand?.name : format?.name}</span>
      </div>
    </div>
  )
}
