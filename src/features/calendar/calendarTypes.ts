import type { Lookups } from '@/hooks/useWorkspaceData'
import type { ContentItem, KeyDate, CalendarView } from '@/types/database'

export type DisplayCalendarView = CalendarView | 'agenda'

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
  onSelectDay?: (date: string) => void
  onMove: (item: ContentItem, date: string) => void
}
