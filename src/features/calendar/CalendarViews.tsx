import { useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { CalendarHeart, Plus } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CompactContentCard, DetailedContentCard } from '@/components/content/ContentCard'
import type { Lookups } from '@/hooks/useWorkspaceData'
import type { ContentItem, KeyDate } from '@/types/database'
import { WEEKDAY_LABELS, formatDate, isWeekend } from '@/lib/dates'
import { cn } from '@/lib/utils'

export interface CalendarViewProps {
  days: string[]
  itemsByDay: Map<string, ContentItem[]>
  keyDatesByDay: Map<string, KeyDate[]>
  lookups: Lookups
  today: string
  /** Month being displayed (month view only), "YYYY-MM". */
  monthKey?: string
  showBrand: boolean
  canCreate: boolean
  canDrag: (item: ContentItem) => boolean
  pendingIds: Set<string>
  onOpen: (item: ContentItem) => void
  onCreate: (date: string) => void
  onMove: (item: ContentItem, date: string) => void
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Shared drag-and-drop wrapper: one DndContext, droppable days, draggable cards. */
export function CalendarDnd({ children, onMove, renderOverlay }: { children: ReactNode; onMove: CalendarViewProps['onMove']; renderOverlay: (item: ContentItem) => ReactNode }) {
  const [active, setActive] = useState<ContentItem | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Space picks up / drops; Enter is left free to open the card.
    useSensor(KeyboardSensor, { keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] } }),
  )
  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e: DragStartEvent) => setActive((e.active.data.current?.item as ContentItem) ?? null)}
      onDragCancel={() => setActive(null)}
      onDragEnd={(e: DragEndEvent) => {
        setActive(null)
        const item = e.active.data.current?.item as ContentItem | undefined
        const target = typeof e.over?.id === 'string' ? e.over.id : null
        if (!item || !target || !ISO_DATE.test(target) || target === item.scheduled_date) return
        onMove(item, target)
      }}
      accessibility={{
        screenReaderInstructions: {
          draggable: 'To reschedule, press Space to pick up the post, use the arrow keys to move it to another day, then press Space again to drop it. Press Escape to cancel. Press Enter to open it.',
        },
      }}
    >
      {children}
      <DragOverlay dropAnimation={null}>{active ? <div className="w-56 rotate-1 shadow-lg">{renderOverlay(active)}</div> : null}</DragOverlay>
    </DndContext>
  )
}

function DraggableCard({
  item,
  disabled,
  pending,
  onOpen,
  children,
}: {
  item: ContentItem
  disabled: boolean
  pending: boolean
  onOpen: () => void
  children: (state: { dragging: boolean }) => ReactNode
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id, data: { item }, disabled: disabled || pending })
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onOpen()
      return
    }
    listeners?.onKeyDown?.(e)
  }
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onKeyDown={onKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`${item.title}. ${disabled ? 'Press Enter to open.' : 'Press Enter to open, Space to move.'}`}
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
      className="rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children({ dragging: isDragging })}
    </div>
  )
}

function DayDropZone({ date, className, children, onEmptyClick }: { date: string; className?: string; children: ReactNode; onEmptyClick?: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: date })
  return (
    <div
      ref={setNodeRef}
      className={cn(className, isOver && 'bg-accent/70 ring-2 ring-primary/40 ring-inset')}
      onClick={(e) => {
        if (e.target === e.currentTarget && onEmptyClick) onEmptyClick()
      }}
    >
      {children}
    </div>
  )
}

function DayHeader({ date, today, keyDates, dimmed, canCreate, onCreate, large }: { date: string; today: string; keyDates: KeyDate[]; dimmed?: boolean; canCreate: boolean; onCreate: () => void; large?: boolean }) {
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
          <div key={k.id} className="mt-0.5 flex items-center gap-1 text-[10.5px] font-medium leading-tight text-rose-800" title={k.notes ?? k.name}>
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

const MONTH_VISIBLE = 3

export function MonthView(props: CalendarViewProps) {
  const { days, itemsByDay, keyDatesByDay, lookups, today, monthKey, showBrand, canCreate, canDrag, pendingIds, onOpen, onCreate } = props
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="grid grid-cols-7 border-b bg-card" aria-hidden>
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {d}
          </div>
        ))}
      </div>
      <div className="grid auto-rows-[minmax(7.5rem,auto)] grid-cols-7" role="grid" aria-label="Month calendar">
        {days.map((date) => {
          const items = itemsByDay.get(date) ?? []
          const visible = items.slice(0, MONTH_VISIBLE)
          const hidden = items.length - visible.length
          const outside = monthKey ? !date.startsWith(monthKey) : false
          return (
            <DayDropZone
              key={date}
              date={date}
              onEmptyClick={canCreate ? () => onCreate(date) : undefined}
              className={cn(
                'group/day flex min-w-0 flex-col gap-1 border-r border-b p-1.5 transition-colors [&:nth-child(7n)]:border-r-0',
                isWeekend(date) ? 'bg-muted/50' : 'bg-card',
                outside && 'bg-muted/70',
                canCreate && 'cursor-cell',
              )}
            >
              <DayHeader date={date} today={today} keyDates={keyDatesByDay.get(date) ?? []} dimmed={outside} canCreate={canCreate} onCreate={() => onCreate(date)} />
              {visible.map((item) => (
                <DraggableCard key={item.id} item={item} disabled={!canDrag(item)} pending={pendingIds.has(item.id)} onOpen={() => onOpen(item)}>
                  {({ dragging }) => (
                    <CompactContentCard item={item} lookups={lookups} today={today} showBrand={showBrand} dragging={dragging} pending={pendingIds.has(item.id)} />
                  )}
                </DraggableCard>
              ))}
              {hidden > 0 && (
                <Popover>
                  <PopoverTrigger className="rounded px-1 text-left text-[11px] font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                    +{hidden} more
                  </PopoverTrigger>
                  <PopoverContent className="flex w-64 flex-col gap-1 p-2" align="start">
                    <div className="mb-1 text-xs font-semibold">{formatDate(date)}</div>
                    {items.map((item) => (
                      <DraggableCard key={item.id} item={item} disabled pending={false} onOpen={() => onOpen(item)}>
                        {() => <CompactContentCard item={item} lookups={lookups} today={today} showBrand={showBrand} />}
                      </DraggableCard>
                    ))}
                  </PopoverContent>
                </Popover>
              )}
            </DayDropZone>
          )
        })}
      </div>
    </div>
  )
}

/** Week (7 days) and two-week (14 days) views with roomier cards. */
export function PeriodView(props: CalendarViewProps) {
  const { days, itemsByDay, keyDatesByDay, lookups, today, showBrand, canCreate, canDrag, pendingIds, onOpen, onCreate } = props
  const rows = days.length / 7
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-x-auto">
      <div className={cn('grid min-w-[56rem] flex-1 grid-cols-7', rows === 1 ? 'grid-rows-1' : 'auto-rows-[minmax(16rem,1fr)]')} role="grid" aria-label={rows === 1 ? 'Week calendar' : 'Two-week calendar'}>
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
            <DayHeader date={date} today={today} keyDates={keyDatesByDay.get(date) ?? []} canCreate={canCreate} onCreate={() => onCreate(date)} large />
            {(itemsByDay.get(date) ?? []).map((item) => (
              <DraggableCard key={item.id} item={item} disabled={!canDrag(item)} pending={pendingIds.has(item.id)} onOpen={() => onOpen(item)}>
                {({ dragging }) => (
                  <DetailedContentCard item={item} lookups={lookups} today={today} showBrand={showBrand} dragging={dragging} pending={pendingIds.has(item.id)} />
                )}
              </DraggableCard>
            ))}
          </DayDropZone>
        ))}
      </div>
    </div>
  )
}

/** Small screens: a list grouped by day instead of a grid. */
export function AgendaView({ days, itemsByDay, keyDatesByDay, lookups, today, showBrand, canCreate, onOpen, onCreate }: CalendarViewProps) {
  const visibleDays = days.filter((d) => (itemsByDay.get(d)?.length ?? 0) > 0 || (keyDatesByDay.get(d)?.length ?? 0) > 0 || d === today)
  if (visibleDays.length === 0) {
    return <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nothing scheduled in this period.</p>
  }
  return (
    <ol className="flex flex-col">
      {visibleDays.map((date) => (
        <li key={date} className={cn('border-b px-4 py-3', isWeekend(date) && 'bg-muted/40')}>
          <div className="mb-2 flex items-center justify-between">
            <h3 className={cn('text-sm font-semibold', date === today && 'text-primary')}>
              {formatDate(date, 'EEEE, d MMMM')}
              {date === today && ' · Today'}
            </h3>
            {canCreate && (
              <button type="button" onClick={() => onCreate(date)} className="flex size-7 items-center justify-center rounded hover:bg-accent" aria-label={`Add content on ${formatDate(date, 'd MMMM')}`}>
                <Plus className="size-4" />
              </button>
            )}
          </div>
          {(keyDatesByDay.get(date) ?? []).map((k) => (
            <div key={k.id} className="mb-2 flex items-center gap-1.5 text-xs font-medium text-rose-800">
              <CalendarHeart className="size-3.5" aria-hidden /> {k.name}
            </div>
          ))}
          <div className="flex flex-col gap-2">
            {(itemsByDay.get(date) ?? []).map((item) => (
              <DetailedContentCard
                key={item.id}
                item={item}
                lookups={lookups}
                today={today}
                showBrand={showBrand}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(item)}
                onKeyDown={(e) => e.key === 'Enter' && onOpen(item)}
              />
            ))}
          </div>
        </li>
      ))}
    </ol>
  )
}
