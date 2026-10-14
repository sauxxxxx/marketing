import { useCallback, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Download, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ErrorState, PageLoader } from '@/components/common/states'
import { FilterBar } from '@/components/content/FilterBar'
import { SummaryPanel } from '@/components/content/SummaryPanel'
import { CompactContentCard } from '@/components/content/ContentCard'
import { useContentPanel } from '@/components/content/ContentPanel'
import { useActiveWorkspace } from '@/features/workspace/WorkspaceProvider'
import { useKeyDates, useLookups } from '@/hooks/useWorkspaceData'
import { useContentRange, usePatchContentOptimistic, useUnscheduledContent } from '@/hooks/useContent'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { applyFilters, filtersFromParams, filtersToParams, type ContentFilters } from '@/lib/filters'
import { computeSummary } from '@/lib/summary'
import { can, canEditContent } from '@/lib/permissions'
import {
  addDays,
  formatDate,
  formatMonth,
  monthGridDays,
  monthKey as toMonthKey,
  monthRange,
  periodDays,
  shiftMonth,
  toLocalDate,
} from '@/lib/dates'
import type { ContentItem, KeyDate } from '@/types/database'
import { ExportDialog } from '@/features/export/ExportDialog'
import { AgendaView, CalendarDnd, MonthView, PeriodView } from './CalendarViews'
import { CalendarDayDrawer } from './CalendarDayDrawer'
import type { DisplayCalendarView } from './calendarTypes'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const VIEWS: DisplayCalendarView[] = ['month', 'week', 'two_week', 'agenda']

export default function CalendarPage() {
  const { workspace, role, userId, today } = useActiveWorkspace()
  const lookups = useLookups()
  const { openContent, createContent, isOpen: editorOpen } = useContentPanel()
  const [params, setParams] = useSearchParams()
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const isWide = useMediaQuery('(min-width: 1280px)')
  const [summaryOpen, setSummaryOpen] = useState(true)
  const [exportOpen, setExportOpen] = useState(false)
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const dayTrigger = useRef<HTMLElement | null>(null)

  const view: DisplayCalendarView = VIEWS.includes(params.get('view') as DisplayCalendarView) ? (params.get('view') as DisplayCalendarView) : workspace.default_calendar_view
  const isMonthPeriod = view === 'month' || view === 'agenda'
  const anchor = ISO_DATE.test(params.get('d') ?? '') ? params.get('d')! : today
  const filters = useMemo(() => filtersFromParams(params), [params])
  const anchorDate = toLocalDate(anchor)
  const year = anchorDate.getFullYear()
  const month = anchorDate.getMonth() + 1

  const days = useMemo(
    () => view === 'agenda'
      ? monthGridDays(year, month).filter((date) => date.startsWith(toMonthKey(year, month)))
      : view === 'month' ? monthGridDays(year, month) : periodDays(anchor, view === 'week' ? 7 : 14),
    [view, year, month, anchor],
  )
  const period = isMonthPeriod ? monthRange(year, month) : { from: days[0], to: days[days.length - 1] }
  const content = useContentRange(days[0], days[days.length - 1])
  const keyDates = useKeyDates(days[0], days[days.length - 1])
  const unscheduled = useUnscheduledContent()

  const update = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params)
      for (const [k, v] of Object.entries(changes)) {
        if (v === null) next.delete(k)
        else next.set(k, v)
      }
      setParams(next, { replace: true })
    },
    [params, setParams],
  )
  const setFilters = (f: ContentFilters) => setParams(filtersToParams(f, params), { replace: true })

  const move = (delta: -1 | 1) => {
    setSelectedDay(null)
    if (isMonthPeriod) {
      const next = shiftMonth(year, month, delta)
      update({ d: `${toMonthKey(next.year, next.month)}-01` })
    } else {
      update({ d: addDays(anchor, delta * (view === 'week' ? 7 : 14)) })
    }
  }

  const filtered = useMemo(() => applyFilters(content.data ?? [], filters), [content.data, filters])
  const itemsByDay = useMemo(() => {
    const map = new Map<string, ContentItem[]>()
    for (const item of filtered) {
      if (!item.scheduled_date) continue
      const list = map.get(item.scheduled_date) ?? []
      list.push(item)
      map.set(item.scheduled_date, list)
    }
    return map
  }, [filtered])
  const keyDatesByDay = useMemo(() => {
    const map = new Map<string, KeyDate[]>()
    for (const k of keyDates.data ?? []) map.set(k.date, [...(map.get(k.date) ?? []), k])
    return map
  }, [keyDates.data])

  const summary = useMemo(
    () =>
      computeSummary({
        items: filtered,
        from: period.from,
        to: period.to,
        today,
        formats: lookups.formats,
        pillars: lookups.pillars,
        unscheduledIdeas: applyFilters(unscheduled.data ?? [], filters).length,
      }),
    [filtered, period.from, period.to, today, lookups.formats, lookups.pillars, unscheduled.data, filters],
  )

  const patch = usePatchContentOptimistic((item) => `Moved to ${formatDate(item.scheduled_date, 'EEE, d MMM')}.`)
  const onMove = (item: ContentItem, date: string) => {
    setPendingIds((s) => new Set(s).add(item.id))
    patch.mutate(
      { id: item.id, patch: { scheduled_date: date } },
      {
        onSettled: () =>
          setPendingIds((s) => {
            const next = new Set(s)
            next.delete(item.id)
            return next
          }),
      },
    )
  }

  const canCreate = can(role, 'content.create')
  const singleBrand = filters.brandIds.length === 1 ? filters.brandIds[0] : undefined
  const heading =
    isMonthPeriod
      ? formatMonth(year, month)
      : `${formatDate(days[0], 'd MMM')} – ${formatDate(days[days.length - 1], 'd MMM yyyy')}`
  const periodLabel = isMonthPeriod ? formatMonth(year, month) : heading

  const viewProps = {
    days,
    itemsByDay,
    keyDatesByDay,
    lookups,
    today,
    monthKey: view === 'month' ? toMonthKey(year, month) : undefined,
    showBrand: lookups.brands.length > 1 && filters.brandIds.length !== 1,
    canCreate,
    canDrag: (item: ContentItem) => canEditContent(role, workspace, item, userId),
    pendingIds,
    onOpen: (item: ContentItem) => openContent(item.id),
    onCreate: (date: string) => createContent({ scheduled_date: date, brand_id: singleBrand }),
    onMove,
    onSelectDay: (date: string) => {
      dayTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setSelectedDay(date)
    },
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="no-print flex flex-col gap-2 border-b bg-card px-3 py-2.5 md:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" aria-label="Previous period" onClick={() => move(-1)}>
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setSelectedDay(null); update({ d: today }) }}>
              Today
            </Button>
            <Button variant="outline" size="icon-sm" aria-label="Next period" onClick={() => move(1)}>
              <ChevronRight />
            </Button>
          </div>
          <h1 className="min-w-0 truncate text-lg font-semibold" aria-live="polite">
            {heading}
          </h1>
          <div className="ml-auto flex items-center gap-2">
            {isDesktop && (
              <Tabs value={view} onValueChange={(v) => { setSelectedDay(null); update({ view: v }) }}>
                <TabsList>
                  <TabsTrigger value="month">Month</TabsTrigger>
                  <TabsTrigger value="week">Week</TabsTrigger>
                  <TabsTrigger value="two_week">2 weeks</TabsTrigger>
                  <TabsTrigger value="agenda">Agenda</TabsTrigger>
                </TabsList>
              </Tabs>
            )}
            <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
              <Download /> <span className="hidden sm:inline">Export PDF</span>
            </Button>
            {isWide && (
              <Button variant="ghost" size="icon-sm" aria-label={summaryOpen ? 'Hide summary' : 'Show summary'} aria-pressed={summaryOpen} onClick={() => setSummaryOpen((o) => !o)}>
                {summaryOpen ? <PanelRightClose /> : <PanelRightOpen />}
              </Button>
            )}
          </div>
        </div>
        <FilterBar filters={filters} onChange={setFilters} lookups={lookups} />
      </div>

      {content.isError ? (
        <ErrorState error={content.error} onRetry={() => content.refetch()} />
      ) : content.isPending || lookups.loading ? (
        <PageLoader label="Loading calendar…" />
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col overflow-auto">
            {!isDesktop || view === 'agenda' ? (
              <AgendaView {...viewProps} />
            ) : (
              <CalendarDnd onMove={onMove} renderOverlay={(item) => <CompactContentCard item={item} lookups={lookups} today={today} />}>
                {view === 'month' ? <MonthView {...viewProps} /> : <PeriodView {...viewProps} />}
              </CalendarDnd>
            )}
            {filtered.length === 0 && isDesktop && (
              <p className="border-t bg-card px-4 py-2 text-center text-xs text-muted-foreground">
                {role === 'editor' ? 'No content assigned to you' : 'Nothing scheduled'}
                {filters.brandIds.length + filters.formatIds.length + filters.statuses.length > 0 ? ' matches these filters' : ''} in this period.
                {canCreate && ' Click a day to add content.'}
              </p>
            )}
          </div>
          {isWide && summaryOpen && (
            <SummaryPanel
              className="w-72 shrink-0 overflow-y-auto border-l"
              summary={summary}
              keyDates={(keyDates.data ?? []).filter((k) => k.date >= period.from && k.date <= period.to)}
              periodLabel={periodLabel}
              unscheduledHref="/library?scheduling=unscheduled"
            />
          )}
        </div>
      )}

      {!isWide && !content.isPending && (
        <details className="border-t bg-card">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
            Summary · {summary.plannedTotal} planned posts
          </summary>
          <SummaryPanel summary={summary} keyDates={(keyDates.data ?? []).filter((k) => k.date >= period.from && k.date <= period.to)} periodLabel={periodLabel} />
        </details>
      )}

      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} year={year} month={month} brandIds={filters.brandIds} />
      <CalendarDayDrawer
        date={selectedDay}
        items={selectedDay ? itemsByDay.get(selectedDay) ?? [] : []}
        keyDates={selectedDay ? keyDatesByDay.get(selectedDay) ?? [] : []}
        lookups={lookups}
        today={today}
        canCreate={canCreate}
        editorOpen={editorOpen}
        returnFocus={dayTrigger.current}
        onClose={() => setSelectedDay(null)}
        onOpen={viewProps.onOpen}
        onCreate={viewProps.onCreate}
      />
    </div>
  )
}
