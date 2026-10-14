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
import type { ContentItem } from '@/types/database'
import type { CalendarViewProps } from './calendarTypes'
import { cn } from '@/lib/utils'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Shared drag-and-drop wrapper: one DndContext, droppable days, draggable cards. */
export function CalendarDnd({
  children,
  onMove,
  renderOverlay,
}: {
  children: ReactNode
  onMove: CalendarViewProps['onMove']
  renderOverlay: (item: ContentItem) => ReactNode
}) {
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
          draggable:
            'To reschedule, press Space to pick up the post, use the arrow keys to move it to another day, then press Space again to drop it. Press Escape to cancel. Press Enter to open it.',
        },
      }}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {active ? <div className="w-56 rotate-1 shadow-lg">{renderOverlay(active)}</div> : null}
      </DragOverlay>
    </DndContext>
  )
}

export function DraggableCard({
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
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: item.id,
    data: { item },
    disabled: disabled || pending,
  })
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

export function DayDropZone({
  date,
  className,
  children,
  onEmptyClick,
}: {
  date: string
  className?: string
  children: ReactNode
  onEmptyClick?: () => void
}) {
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
