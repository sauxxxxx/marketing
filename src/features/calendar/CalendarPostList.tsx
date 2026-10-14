import type { ContentItem } from '@/types/database'
import type { Lookups } from '@/hooks/useWorkspaceData'
import { FormatTag, StatusBadge, PersonAvatar } from '@/components/content/badges'
import { formatTime } from '@/lib/dates'
import { overdueReason } from '@/lib/summary'

/** Shared readable rows for the agenda and the complete day list. */
export function CalendarPostList({
  items,
  lookups,
  today,
  onOpen,
}: {
  items: ContentItem[]
  lookups: Lookups
  today: string
  onOpen: (item: ContentItem) => void
}) {
  return (
    <ul className="divide-y rounded-md border bg-card">
      {items.map((item) => {
        const owner = lookups.personName(item.assigned_to)
        return (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onOpen(item)}
              className="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-accent/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              aria-label={`Open ${item.title}`}
            >
              <span className="w-16 shrink-0 pt-0.5 text-xs text-muted-foreground tabular">
                {item.scheduled_time ? formatTime(item.scheduled_time) : 'No time set'}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {lookups.brandById.get(item.brand_id)?.name ?? 'Unknown brand'}
                </span>
                <span className="text-sm font-medium break-words">{item.title}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={item.status} />
                  <FormatTag format={lookups.formatById.get(item.format_id)} />
                  {overdueReason(item, today) && <span className="text-xs font-medium text-destructive">Overdue</span>}
                </span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <PersonAvatar name={owner} />
                  {owner ?? 'Unassigned'}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
