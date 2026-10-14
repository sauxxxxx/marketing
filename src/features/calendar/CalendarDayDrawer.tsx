import { useRef } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { ContentItem, KeyDate } from '@/types/database'
import type { Lookups } from '@/hooks/useWorkspaceData'
import { formatDate } from '@/lib/dates'
import { CalendarPostList } from './CalendarPostList'
import { comparePostingTime } from './calendarModel'

export function CalendarDayDrawer({
  date,
  items,
  keyDates,
  lookups,
  today,
  canCreate,
  editorOpen,
  returnFocus,
  onClose,
  onOpen,
  onCreate,
}: {
  date: string | null
  items: ContentItem[]
  keyDates: KeyDate[]
  lookups: Lookups
  today: string
  canCreate: boolean
  editorOpen: boolean
  returnFocus: HTMLElement | null
  onClose: () => void
  onOpen: (item: ContentItem) => void
  onCreate: (date: string) => void
}) {
  const scroll = useRef({ date, top: 0 })
  return (
    <Sheet
      open={!!date && !editorOpen}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[520px] motion-reduce:animate-none"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (!editorOpen) returnFocus?.focus()
        }}
      >
        <SheetHeader className="shrink-0 border-b p-5 pr-12">
          <SheetTitle>{date ? formatDate(date, 'EEEE, d MMMM yyyy') : 'Day schedule'}</SheetTitle>
          <SheetDescription>
            {items.length} {items.length === 1 ? 'post' : 'posts'} · Matching your calendar filters
          </SheetDescription>
        </SheetHeader>
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4"
          ref={(node) => {
            if (!node) return
            if (scroll.current.date !== date) scroll.current = { date, top: 0 }
            node.scrollTop = scroll.current.top
          }}
          onScroll={(event) => {
            scroll.current = { date, top: event.currentTarget.scrollTop }
          }}
        >
          {keyDates.length > 0 && (
            <section className="mb-4 rounded-md border bg-accent/40 p-3" aria-label="Key dates">
              {keyDates.map((keyDate) => (
                <div key={keyDate.id} className="mb-2 last:mb-0">
                  <p className="text-sm font-medium">{keyDate.name}</p>
                  {keyDate.notes && <p className="mt-1 text-xs text-muted-foreground">{keyDate.notes}</p>}
                </div>
              ))}
            </section>
          )}
          {items.length > 0 ? (
            <CalendarPostList
              items={[...items].sort(comparePostingTime)}
              lookups={lookups}
              today={today}
              onOpen={onOpen}
            />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No posts match your calendar filters for this day.
            </p>
          )}
        </div>
        {canCreate && date && (
          <div className="shrink-0 border-t p-4">
            <Button className="w-full" onClick={() => onCreate(date)}>
              <Plus />
              Add content for this day
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
