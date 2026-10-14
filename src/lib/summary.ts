/**
 * Monthly summary — replaces the hand-counted totals on the Canva calendar.
 *
 * Counting rules (documented in docs/DATA-RULES.md and covered by tests):
 *  1. The summary set is every non-archived item scheduled inside the period
 *     that passes the active filters.
 *  2. "Planned posts" = items in the set whose status is not Cancelled.
 *  3. "Published" = items whose status is Published.
 *  4. "Approved" = items approved but not yet published (status Approved).
 *  5. Unscheduled ideas are never counted as scheduled; they are reported
 *     separately.
 *  6. Format and pillar breakdowns use exactly the "planned posts" set, so
 *     they always add up to the planned total.
 *  7. Status breakdown covers the whole set, including Cancelled.
 */
import type { ConfigItem, ContentItem, ContentStatus } from '@/types/database'
import { CONTENT_STATUSES } from './status'
import { WEEK_STARTS_ON, addDays, toISODate, toLocalDate, type ISODate } from './dates'
import { startOfWeek } from 'date-fns'

export type SummaryItem = Pick<
  ContentItem,
  'id' | 'status' | 'scheduled_date' | 'deadline_date' | 'format_id' | 'pillar_id' | 'deleted_at'
>

export interface Breakdown {
  id: string | null
  name: string
  color: string
  count: number
}

export interface MonthlySummary {
  plannedTotal: number
  publishedTotal: number
  approvedAwaitingPublication: number
  cancelledTotal: number
  unscheduledIdeas: number
  byStatus: Record<ContentStatus, number>
  byFormat: Breakdown[]
  byPillar: Breakdown[]
  byWeek: { start: ISODate; end: ISODate; count: number }[]
  byDay: Record<ISODate, number>
  overdueCount: number
}

export type OverdueReason = 'production' | 'publication'

const PRODUCTION_STATUSES: readonly ContentStatus[] = ['planned', 'in_production', 'for_review', 'needs_revision']

/**
 * Overdue when the production deadline has passed while work is unfinished,
 * or the scheduled date has passed without the post being published.
 */
export function overdueReason(item: Pick<SummaryItem, 'status' | 'scheduled_date' | 'deadline_date'>, today: ISODate): OverdueReason | null {
  if (item.status === 'published' || item.status === 'cancelled') return null
  if (item.scheduled_date && item.scheduled_date < today) return 'publication'
  if (item.deadline_date && item.deadline_date < today && PRODUCTION_STATUSES.includes(item.status)) return 'production'
  return null
}

export function isOverdue(item: Pick<SummaryItem, 'status' | 'scheduled_date' | 'deadline_date'>, today: ISODate): boolean {
  return overdueReason(item, today) !== null
}

export function computeSummary(input: {
  items: readonly SummaryItem[]
  from: ISODate
  to: ISODate
  today: ISODate
  formats: readonly ConfigItem[]
  pillars: readonly ConfigItem[]
  unscheduledIdeas?: number
}): MonthlySummary {
  const { from, to, today } = input
  const set = input.items.filter(
    (i) => !i.deleted_at && i.scheduled_date !== null && i.scheduled_date >= from && i.scheduled_date <= to,
  )
  const planned = set.filter((i) => i.status !== 'cancelled')

  const byStatus = Object.fromEntries(CONTENT_STATUSES.map((s) => [s, 0])) as Record<ContentStatus, number>
  for (const item of set) byStatus[item.status] += 1

  const formatCounts = new Map<string, number>()
  const pillarCounts = new Map<string | null, number>()
  const byDay: Record<ISODate, number> = {}
  for (const item of planned) {
    formatCounts.set(item.format_id, (formatCounts.get(item.format_id) ?? 0) + 1)
    pillarCounts.set(item.pillar_id, (pillarCounts.get(item.pillar_id) ?? 0) + 1)
    byDay[item.scheduled_date!] = (byDay[item.scheduled_date!] ?? 0) + 1
  }

  const byFormat = breakdown(formatCounts, input.formats)
  const byPillar = breakdown(pillarCounts, input.pillars)

  const byWeek: MonthlySummary['byWeek'] = []
  let weekStart = toISODate(startOfWeek(toLocalDate(from), { weekStartsOn: WEEK_STARTS_ON }))
  while (weekStart <= to) {
    const weekEnd = addDays(weekStart, 6)
    const start = weekStart < from ? from : weekStart
    const end = weekEnd > to ? to : weekEnd
    const count = planned.filter((i) => i.scheduled_date! >= start && i.scheduled_date! <= end).length
    byWeek.push({ start, end, count })
    weekStart = addDays(weekStart, 7)
  }

  return {
    plannedTotal: planned.length,
    publishedTotal: byStatus.published,
    approvedAwaitingPublication: byStatus.approved,
    cancelledTotal: byStatus.cancelled,
    unscheduledIdeas: input.unscheduledIdeas ?? 0,
    byStatus,
    byFormat,
    byPillar,
    byWeek,
    byDay,
    overdueCount: set.filter((i) => isOverdue(i, today)).length,
  }
}

function breakdown(counts: Map<string | null, number>, config: readonly ConfigItem[]): Breakdown[] {
  const rows: Breakdown[] = []
  const known = new Set<string>()
  for (const c of [...config].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))) {
    known.add(c.id)
    const count = counts.get(c.id) ?? 0
    if (count > 0 || c.is_active) rows.push({ id: c.id, name: c.name, color: c.color, count })
  }
  const none = counts.get(null)
  if (none) rows.push({ id: null, name: 'No pillar', color: '#9aa5a8', count: none })
  // Items referencing configuration not loaded (should not happen) stay counted.
  let other = 0
  for (const [id, count] of counts) if (id !== null && !known.has(id)) other += count
  if (other) rows.push({ id: 'unknown', name: 'Other', color: '#9aa5a8', count: other })
  return rows
}
