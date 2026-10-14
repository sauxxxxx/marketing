import { Plus } from 'lucide-react'
import { WEEKDAY_LABELS, formatDate, isWeekend } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { CalendarViewProps } from './calendarTypes'
import { DayDropZone, DraggableCard } from './CalendarInteractions'
import { MonthPostPreview } from './MonthPostPreview'
import { comparePostingTime } from './calendarModel'

const MONTH_VISIBLE = 2

export function MonthView({
  days,
  itemsByDay,
  keyDatesByDay,
  lookups,
  today,
  monthKey,
  showBrand,
  canCreate,
  canDrag,
  pendingIds,
  onOpen,
  onCreate,
  onSelectDay,
}: CalendarViewProps) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="grid grid-cols-7 border-b bg-card" aria-hidden>
        {WEEKDAY_LABELS.map((day) => (
          <div
            key={day}
            className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            {day}
          </div>
        ))}
      </div>
      <div className="grid auto-rows-[9.5rem] grid-cols-7" role="grid" aria-label="Month calendar">
        {days.map((date) => {
          const items = [...(itemsByDay.get(date) ?? [])].sort(comparePostingTime)
          const keyDates = keyDatesByDay.get(date) ?? []
          const visible = items.slice(0, MONTH_VISIBLE)
          const hidden = items.length - visible.length
          const outside = monthKey ? !date.startsWith(monthKey) : false
          const dateLabel = formatDate(date, 'EEEE, d MMMM yyyy') + (date === today ? ' (today)' : '')
          return (
            <DayDropZone
              key={date}
              date={date}
              onEmptyClick={() => onSelectDay?.(date)}
              className={cn(
                'group/day flex min-h-0 min-w-0 flex-col gap-1 overflow-hidden border-r border-b p-1.5 [&:nth-child(7n)]:border-r-0',
                isWeekend(date) ? 'bg-muted/50' : 'bg-card',
                outside && 'bg-muted/70',
              )}
            >
              <div className="flex h-6 shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSelectDay?.(date)}
                  aria-label={dateLabel}
                  className={cn(
                    'flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring',
                    date === today && 'bg-primary text-primary-foreground hover:bg-primary/90',
                    outside && date !== today && 'text-muted-foreground',
                  )}
                >
                  {formatDate(date, 'd')}
                </button>
                {items.length > 0 && (
                  <span className="min-w-0 truncate text-[11px] text-muted-foreground" title={`${items.length} posts`}>
                    {items.length} {items.length === 1 ? 'post' : 'posts'}
                  </span>
                )}
                {canCreate && (
                  <button
                    type="button"
                    className="ml-auto flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                    aria-label={`Add content on ${formatDate(date, 'd MMMM')}`}
                    onClick={() => onCreate(date)}
                  >
                    <Plus className="size-3.5" />
                  </button>
                )}
              </div>
              <div className="h-3 shrink-0 min-w-0">
                {keyDates.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onSelectDay?.(date)}
                    className="block w-full truncate text-left text-[11px] leading-3 font-medium text-rose-800 focus-visible:outline-2 focus-visible:outline-ring"
                    title={keyDates.map((keyDate) => keyDate.name).join(', ')}
                  >
                    {keyDates[0].name}
                    {keyDates.length > 1 && ` +${keyDates.length - 1}`}
                  </button>
                )}
              </div>
              <div className="flex min-h-0 flex-col gap-1">
                {visible.map((item) => (
                  <DraggableCard
                    key={item.id}
                    item={item}
                    disabled={!canDrag(item)}
                    pending={pendingIds.has(item.id)}
                    onOpen={() => onOpen(item)}
                  >
                    {({ dragging }) => (
                      <MonthPostPreview
                        item={item}
                        lookups={lookups}
                        today={today}
                        showBrand={showBrand}
                        dragging={dragging}
                        pending={pendingIds.has(item.id)}
                      />
                    )}
                  </DraggableCard>
                ))}
              </div>
              {hidden > 0 && (
                <button
                  type="button"
                  onClick={() => onSelectDay?.(date)}
                  aria-label={`Show all ${items.length} posts on ${formatDate(date, 'd MMMM')}`}
                  className="mt-auto h-5 shrink-0 rounded px-1 text-left text-xs font-medium text-primary hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                >
                  +{hidden} more
                </button>
              )}
            </DayDropZone>
          )
        })}
      </div>
    </div>
  )
}
