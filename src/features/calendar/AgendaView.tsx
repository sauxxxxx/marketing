import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { CalendarViewProps } from './calendarTypes'
import { CalendarPostList } from './CalendarPostList'
import { comparePostingTime, groupPostsByBrand } from './calendarModel'

/** A list of daily schedules, available on desktop and small screens. */
export function AgendaView({
  days,
  itemsByDay,
  keyDatesByDay,
  lookups,
  today,
  canCreate,
  onOpen,
  onCreate,
}: CalendarViewProps) {
  const [byBrand, setByBrand] = useState(false)
  const visibleDays = days.filter(
    (date) => (itemsByDay.get(date)?.length ?? 0) > 0 || (keyDatesByDay.get(date)?.length ?? 0) > 0 || date === today,
  )
  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <p className="text-xs text-muted-foreground">Posts matching your calendar filters</p>
        <label className="flex shrink-0 items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={byBrand}
            onChange={(event) => setByBrand(event.target.checked)}
            className="size-4 accent-primary"
          />
          Group by brand
        </label>
      </div>
      {visibleDays.length === 0 && (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nothing scheduled in this period.</p>
      )}
      <ol className="flex flex-col">
        {visibleDays.map((date) => {
          const items = [...(itemsByDay.get(date) ?? [])].sort(comparePostingTime)
          return (
            <li key={date} className="border-b px-4 py-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h3 className={cn('text-sm font-semibold', date === today && 'text-primary')}>
                    {formatDate(date, 'EEEE, d MMMM')}
                    {date === today && ' · Today'}
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {items.length} {items.length === 1 ? 'post' : 'posts'}
                  </p>
                </div>
                {canCreate && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onCreate(date)}
                    aria-label={`Add content on ${formatDate(date, 'd MMMM')}`}
                  >
                    <Plus />
                    <span className="hidden sm:inline">Add content</span>
                  </Button>
                )}
              </div>
              {(keyDatesByDay.get(date) ?? []).map((keyDate) => (
                <p key={keyDate.id} className="mb-2 text-xs font-medium text-rose-800">
                  {keyDate.name}
                </p>
              ))}
              {byBrand ? (
                groupPostsByBrand(items, lookups).map((group) => (
                  <section key={group.id} className="mb-3">
                    <h4 className="mb-2 text-xs font-semibold">
                      {group.name} · {group.posts.length}
                    </h4>
                    <CalendarPostList items={group.posts} lookups={lookups} today={today} onOpen={onOpen} />
                  </section>
                ))
              ) : items.length > 0 ? (
                <CalendarPostList items={items} lookups={lookups} today={today} onOpen={onOpen} />
              ) : (
                <p className="text-xs text-muted-foreground">No posts scheduled.</p>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
