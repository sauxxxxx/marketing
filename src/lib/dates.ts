/**
 * Calendar dates are plain ISO strings ("2026-11-05") interpreted in the
 * workspace timezone. Helpers here never pass those strings through the
 * device timezone, so a post scheduled for the 5th stays on the 5th for
 * every viewer.
 */
import {
  addDays as addDaysFns,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { TZDate } from '@date-fns/tz'

export type ISODate = string

export const WEEK_STARTS_ON = 0 as const // Sunday, matching the team's Canva calendar

/** Builds a local Date at midnight for a calendar date (no timezone shift). */
export function toLocalDate(iso: ISODate): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function toISODate(date: Date): ISODate {
  return format(date, 'yyyy-MM-dd')
}

/** Today's date in the given IANA timezone. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): ISODate {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  } catch {
    return toISODate(now)
  }
}

/** Current time "HH:mm" in a timezone, for defaulting publication times. */
export function nowTimeInTimeZone(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
  } catch {
    return format(now, 'HH:mm')
  }
}

export function addDays(iso: ISODate, days: number): ISODate {
  return toISODate(addDaysFns(toLocalDate(iso), days))
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return differenceInCalendarDays(toLocalDate(to), toLocalDate(from))
}

export function isWeekend(iso: ISODate): boolean {
  const day = toLocalDate(iso).getDay()
  return day === 0 || day === 6
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

export function monthRange(year: number, month: number): { from: ISODate; to: ISODate } {
  const first = new Date(year, month - 1, 1)
  return { from: toISODate(startOfMonth(first)), to: toISODate(endOfMonth(first)) }
}

/** Days shown in a month grid: full weeks covering the month. */
export function monthGridDays(year: number, month: number): ISODate[] {
  const first = new Date(year, month - 1, 1)
  const start = startOfWeek(startOfMonth(first), { weekStartsOn: WEEK_STARTS_ON })
  const end = endOfWeek(endOfMonth(first), { weekStartsOn: WEEK_STARTS_ON })
  const days: ISODate[] = []
  for (let d = start; d <= end; d = addDaysFns(d, 1)) days.push(toISODate(d))
  return days
}

/** Consecutive days starting at the week containing `anchor`. */
export function periodDays(anchor: ISODate, length: 7 | 14): ISODate[] {
  const start = startOfWeek(toLocalDate(anchor), { weekStartsOn: WEEK_STARTS_ON })
  return Array.from({ length }, (_, i) => toISODate(addDaysFns(start, i)))
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = addMonths(new Date(year, month - 1, 1), delta)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

export function formatDate(iso: ISODate | null | undefined, pattern = 'EEE, d MMM yyyy'): string {
  if (!iso) return ''
  return format(toLocalDate(iso), pattern)
}

export function formatMonth(year: number, month: number, pattern = 'MMMM yyyy'): string {
  return format(new Date(year, month - 1, 1), pattern)
}

/** "14:30:00" → "2:30 PM" */
export function formatTime(time: string | null | undefined): string {
  if (!time) return ''
  const [h, m] = time.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

/** Formats a timestamp (UTC ISO) in the workspace timezone. */
export function formatTimestamp(value: string | null | undefined, timeZone: string, withTime = true): string {
  if (!value) return ''
  try {
    return new Intl.DateTimeFormat('en-PH', {
      timeZone,
      dateStyle: 'medium',
      ...(withTime ? { timeStyle: 'short' } : {}),
    }).format(new Date(value))
  } catch {
    return value
  }
}

export function relativeDays(iso: ISODate, today: ISODate): string {
  const diff = daysBetween(today, iso)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff < 0) return `${-diff} days ago`
  return `In ${diff} days`
}

export const WEEKDAY_LABELS = Array.from({ length: 7 }, (_, i) =>
  format(addDaysFns(startOfWeek(new Date(2026, 0, 4), { weekStartsOn: WEEK_STARTS_ON }), i), 'EEE'),
)

/** "2026-11-05T09:30" wall-clock time in `timeZone` → ISO timestamp with offset. */
export function zonedInputToTimestamp(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const [, y, mo, d, h, mi] = match.map(Number)
  return new TZDate(y, mo - 1, d, h, mi, timeZone).toISOString()
}

/** ISO timestamp → "2026-11-05T09:30" wall-clock time in `timeZone`, for datetime-local inputs. */
export function timestampToZonedInput(value: string | null | undefined, timeZone: string): string {
  if (!value) return ''
  return format(new TZDate(new Date(value).getTime(), timeZone), "yyyy-MM-dd'T'HH:mm")
}
