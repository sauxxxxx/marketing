import { DetailedContentCard } from '@/components/content/ContentCard'
import { isWeekend } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { CalendarViewProps } from './calendarTypes'
import { DraggableCard, DayDropZone } from './CalendarInteractions'
import { DayHeader } from './CalendarDayHeader'

/** Week (7 days) and two-week (14 days) views with roomier cards. */
export function PeriodView(props: CalendarViewProps) {
  const {
    days,
    itemsByDay,
    keyDatesByDay,
    lookups,
    today,
    showBrand,
    canCreate,
    canDrag,
    pendingIds,
    onOpen,
    onCreate,
  } = props
  const rows = days.length / 7
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-x-auto">
      <div
        className={cn(
          'grid min-w-[56rem] flex-1 grid-cols-7',
          rows === 1 ? 'grid-rows-1' : 'auto-rows-[minmax(16rem,1fr)]',
        )}
        role="grid"
        aria-label={rows === 1 ? 'Week calendar' : 'Two-week calendar'}
      >
        {days.map((date) => (
          <DayDropZone
            key={date}
            date={date}
            onEmptyClick={canCreate ? () => onCreate(date) : undefined}
            className={cn(
              'group/day flex min-h-[16rem] min-w-0 flex-col gap-1.5 border-r border-b p-2 [&:nth-child(7n)]:border-r-0',
              isWeekend(date) ? 'bg-muted/50' : 'bg-card',
              canCreate && 'cursor-cell',
              rows === 1 && 'min-h-[60vh]',
            )}
          >
            <DayHeader
              date={date}
              today={today}
              keyDates={keyDatesByDay.get(date) ?? []}
              canCreate={canCreate}
              onCreate={() => onCreate(date)}
              large
            />
            {(itemsByDay.get(date) ?? []).map((item) => (
              <DraggableCard
                key={item.id}
                item={item}
                disabled={!canDrag(item)}
                pending={pendingIds.has(item.id)}
                onOpen={() => onOpen(item)}
              >
                {({ dragging }) => (
                  <DetailedContentCard
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
          </DayDropZone>
        ))}
      </div>
    </div>
  )
}
