import { forwardRef, type HTMLAttributes } from 'react'
import { CalendarDays, Clock } from 'lucide-react'
import type { ContentItem } from '@/types/database'
import type { Lookups } from '@/hooks/useWorkspaceData'
import { PLATFORM_SHORT } from '@/lib/constants'
import { formatDate, formatTime } from '@/lib/dates'
import { overdueReason } from '@/lib/summary'
import { cn } from '@/lib/utils'
import { FormatTag, OverdueFlag, PersonAvatar, PillarTag, StatusBadge } from './badges'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  item: ContentItem
  lookups: Lookups
  today: string
  showBrand?: boolean
  dragging?: boolean
  pending?: boolean
}

/** Compact card for month cells: time, title (2 lines), format colour bar, status icon. */
export const CompactContentCard = forwardRef<HTMLDivElement, CardProps>(function CompactContentCard(
  { item, lookups, today, showBrand, dragging, pending, className, ...rest },
  ref,
) {
  const format = lookups.formatById.get(item.format_id)
  const brand = lookups.brandById.get(item.brand_id)
  const owner = lookups.personName(item.assigned_to)
  const overdue = overdueReason(item, today)
  return (
    <div
      ref={ref}
      className={cn(
        'group relative flex w-full cursor-pointer flex-col gap-0.5 rounded-[4px] border border-l-[3px] bg-card py-1 pr-1.5 pl-1.5 text-left text-xs shadow-[0_1px_0_rgba(16,24,40,0.03)] transition-colors hover:bg-accent/40',
        item.status === 'cancelled' && 'opacity-60',
        dragging && 'opacity-40',
        pending && 'animate-pulse',
        className,
      )}
      style={{ borderLeftColor: format?.color ?? 'var(--border)' }}
      {...rest}
    >
      <div className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
        <StatusBadge status={item.status} compact />
        {item.scheduled_time && <span className="shrink-0 whitespace-nowrap tabular">{formatTime(item.scheduled_time)}</span>}
        <span className="min-w-0 truncate">{format?.name}</span>
        {overdue && (
          <span className="ml-auto font-semibold text-red-700" title="Overdue">
            !<span className="sr-only">Overdue</span>
          </span>
        )}
      </div>
      <div className={cn('line-clamp-2 font-medium leading-snug', item.status === 'cancelled' && 'line-through')}>{item.title}</div>
      {(showBrand || owner) && (
        <div className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
          {showBrand && brand && <span className="truncate">{brand.name}</span>}
          {owner && <PersonAvatar name={owner} className="ml-auto size-4 text-[8px]" />}
        </div>
      )}
    </div>
  )
})

/** Roomier card for week / two-week views and the agenda list. */
export const DetailedContentCard = forwardRef<HTMLDivElement, CardProps>(function DetailedContentCard(
  { item, lookups, today, showBrand = true, dragging, pending, className, ...rest },
  ref,
) {
  const format = lookups.formatById.get(item.format_id)
  const pillar = item.pillar_id ? lookups.pillarById.get(item.pillar_id) : null
  const brand = lookups.brandById.get(item.brand_id)
  const owner = lookups.personName(item.assigned_to)
  const overdue = overdueReason(item, today)
  return (
    <div
      ref={ref}
      className={cn(
        'group flex w-full cursor-pointer flex-col gap-1.5 rounded-md border border-l-[3px] bg-card p-2 text-left text-xs shadow-[0_1px_0_rgba(16,24,40,0.03)] transition-colors hover:bg-accent/40',
        item.status === 'cancelled' && 'opacity-60',
        dragging && 'opacity-40',
        pending && 'animate-pulse',
        className,
      )}
      style={{ borderLeftColor: format?.color ?? 'var(--border)' }}
      {...rest}
    >
      <div className="flex items-center justify-between gap-2">
        <FormatTag format={format} />
        {item.scheduled_time && (
          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] whitespace-nowrap text-muted-foreground tabular">
            <Clock className="size-3" aria-hidden />
            {formatTime(item.scheduled_time)}
          </span>
        )}
      </div>
      <div className={cn('line-clamp-3 text-[13px] font-medium leading-snug', item.status === 'cancelled' && 'line-through')}>
        {item.title}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <StatusBadge status={item.status} />
        {overdue && <OverdueFlag reason={overdue} />}
        {pillar && <PillarTag pillar={pillar} />}
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {showBrand && brand && <span className="truncate font-medium">{brand.name}</span>}
        {item.platforms.length > 0 && (
          <span className="truncate" title={item.platforms.join(', ')}>
            · {item.platforms.map((p) => PLATFORM_SHORT[p] ?? p).join(' ')}
          </span>
        )}
        {owner && <PersonAvatar name={owner} className="ml-auto" />}
      </div>
    </div>
  )
})

/** Card for the production board: adds dates and deadline. */
export function BoardCard({ item, lookups, today, dragging, pending }: CardProps) {
  const format = lookups.formatById.get(item.format_id)
  const brand = lookups.brandById.get(item.brand_id)
  const owner = lookups.personName(item.assigned_to)
  const overdue = overdueReason(item, today)
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-md border border-l-[3px] bg-card p-2.5 text-xs shadow-[0_1px_0_rgba(16,24,40,0.03)] transition-colors hover:bg-accent/40',
        dragging && 'opacity-40',
        pending && 'animate-pulse',
      )}
      style={{ borderLeftColor: format?.color ?? 'var(--border)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-medium text-muted-foreground">{brand?.name}</span>
        <StatusBadge status={item.status} compact />
      </div>
      <div className="line-clamp-3 text-[13px] font-medium leading-snug">{item.title}</div>
      <FormatTag format={format} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <CalendarDays className="size-3" aria-hidden />
          {item.scheduled_date ? formatDate(item.scheduled_date, 'd MMM') : 'Unscheduled'}
        </span>
        {item.deadline_date && (
          <span className={cn('inline-flex items-center gap-1', overdue === 'production' && 'font-semibold text-red-700')}>
            Due {formatDate(item.deadline_date, 'd MMM')}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {overdue && <OverdueFlag reason={overdue} />}
        {owner ? (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <PersonAvatar name={owner} />
            <span className="max-w-24 truncate">{owner}</span>
          </span>
        ) : (
          <span className="ml-auto text-[11px] text-muted-foreground">Unassigned</span>
        )}
      </div>
    </div>
  )
}
