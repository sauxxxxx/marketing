import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorState, PageLoader } from '@/components/common/states'
import { StatusBadge } from '@/components/content/badges'
import { useActiveWorkspace } from '@/features/workspace/WorkspaceProvider'
import { useLookups } from '@/hooks/useWorkspaceData'
import { CONTENT_STATUSES, STATUS_LABEL } from '@/lib/status'
import { WEEKDAY_LABELS, formatDate, formatTime, isWeekend, toISODate } from '@/lib/dates'
import type { ContentItem } from '@/types/database'
import { loadExportData, type ExportMode } from './exportData'

/**
 * Internal, authenticated, read-only sharing view. It sits behind the same
 * session and membership checks as the rest of the app and reads through
 * RLS, so it never exposes data publicly.
 */
export default function PrintPage() {
  const { workspace, today } = useActiveWorkspace()
  const lookups = useLookups()
  const [params] = useSearchParams()
  const [y, m] = (params.get('month') ?? toISODate(new Date()).slice(0, 7)).split('-').map(Number)
  const mode: ExportMode = params.get('mode') === 'detailed' ? 'detailed' : 'calendar'
  const brandIds = (params.get('brand') ?? '').split(',').filter((b) => /^[0-9a-f-]{36}$/.test(b))
  const options = useMemo(
    () => ({ year: y, month: m, brandIds, mode, includeNotes: params.get('notes') === '1', includeCancelled: params.get('cancelled') === '1' }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [y, m, mode, params.get('brand'), params.get('notes'), params.get('cancelled')],
  )

  const data = useQuery({
    queryKey: ['ws', workspace.id, 'content', 'print', options],
    enabled: !lookups.loading && !!y && !!m,
    queryFn: () => loadExportData({ workspace, options, formats: lookups.formats, pillars: lookups.pillars, brands: lookups.brands, today }),
  })

  if (lookups.loading || data.isPending) return <PageLoader />
  if (data.isError) return <ErrorState error={data.error} onRetry={() => data.refetch()} />
  const d = data.data
  const formatById = lookups.formatById
  const byDay = new Map<string, ContentItem[]>()
  for (const item of d.items) byDay.set(item.scheduled_date!, [...(byDay.get(item.scheduled_date!) ?? []), item])
  const monthPrefix = `${d.year}-${String(d.month).padStart(2, '0')}`

  return (
    <div className="min-h-dvh bg-white text-[13px] text-foreground print:text-[11px]">
      <div className="no-print sticky top-0 flex items-center justify-between gap-2 border-b bg-card px-4 py-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/calendar">
            <ArrowLeft /> Back to calendar
          </Link>
        </Button>
        <span className="text-xs text-muted-foreground">Internal view — requires sign-in. Use your browser’s print dialog to save as PDF.</span>
        <Button size="sm" onClick={() => window.print()}>
          <Printer /> Print
        </Button>
      </div>
      <div className="mx-auto max-w-[1100px] p-6 print:p-0">
        <header className="mb-4 flex items-end justify-between border-b-2 border-primary pb-2">
          <div>
            <h1 className="text-2xl font-semibold">{d.title}</h1>
            <p className="font-semibold text-primary">{d.subtitle}</p>
          </div>
          <p className="text-right text-xs text-muted-foreground">
            {d.summary.plannedTotal} planned · {d.summary.publishedTotal} published · {d.summary.approvedAwaitingPublication} approved
            <br />
            Generated {d.generatedAt} ({d.workspace.timezone})
          </p>
        </header>

        {mode === 'calendar' ? (
          <div className="flex gap-4">
            <div className="grid flex-1 grid-cols-7 border-t border-l">
              {WEEKDAY_LABELS.map((w) => (
                <div key={w} className="border-r border-b bg-muted px-1.5 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
                  {w}
                </div>
              ))}
              {d.gridDays.map((day) => {
                const outside = !day.startsWith(monthPrefix)
                return (
                  <div key={day} className={`min-h-24 break-inside-avoid border-r border-b p-1 ${outside ? 'bg-muted/70' : isWeekend(day) ? 'bg-muted/40' : ''}`}>
                    <div className={`text-xs font-semibold ${outside ? 'text-muted-foreground/50' : ''}`}>{formatDate(day, 'd')}</div>
                    {!outside &&
                      d.keyDates
                        .filter((k) => k.date === day)
                        .map((k) => (
                          <div key={k.id} className="text-[10px] font-semibold text-rose-800">
                            {k.name}
                          </div>
                        ))}
                    {!outside &&
                      (byDay.get(day) ?? []).map((item) => (
                        <div key={item.id} className="mt-0.5 border-l-[3px] pl-1 text-[11px] leading-tight" style={{ borderLeftColor: formatById.get(item.format_id)?.color }}>
                          {item.title}
                        </div>
                      ))}
                  </div>
                )
              })}
            </div>
            <aside className="w-48 shrink-0 text-xs">
              <h2 className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">Formats</h2>
              {d.summary.byFormat.map((f) => (
                <div key={f.id ?? 'none'} className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-[2px]" style={{ backgroundColor: f.color }} />
                  <span className="flex-1">{f.name}</span>
                  <span className="font-semibold tabular">{f.count}</span>
                </div>
              ))}
              <h2 className="mt-3 mb-1 font-semibold uppercase tracking-wide text-muted-foreground">Pillars</h2>
              {d.summary.byPillar
                .filter((p) => p.count > 0)
                .map((p) => (
                  <div key={p.id ?? 'none'} className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-full border-2" style={{ borderColor: p.color }} />
                    <span className="flex-1">{p.name}</span>
                    <span className="font-semibold tabular">{p.count}</span>
                  </div>
                ))}
              <h2 className="mt-3 mb-1 font-semibold uppercase tracking-wide text-muted-foreground">Status</h2>
              {CONTENT_STATUSES.filter((s) => d.summary.byStatus[s] > 0).map((s) => (
                <div key={s} className="flex">
                  <span className="flex-1">{STATUS_LABEL[s]}</span>
                  <span className="font-semibold tabular">{d.summary.byStatus[s]}</span>
                </div>
              ))}
              <h2 className="mt-3 mb-1 font-semibold uppercase tracking-wide text-muted-foreground">Key dates</h2>
              {d.keyDates.length === 0 && <p className="text-muted-foreground">None</p>}
              {d.keyDates.map((k) => (
                <div key={k.id}>
                  {formatDate(k.date, 'd MMM')} · {k.name}
                </div>
              ))}
            </aside>
          </div>
        ) : (
          <ol className="divide-y">
            {d.items.length === 0 && <p className="py-10 text-center text-muted-foreground">No scheduled content for this month.</p>}
            {d.items.map((item) => (
              <li key={item.id} className="grid break-inside-avoid grid-cols-[6rem_1fr] gap-3 py-3">
                <div>
                  <div className="font-semibold">{formatDate(item.scheduled_date, 'EEE d MMM')}</div>
                  {item.scheduled_time && <div className="text-xs text-muted-foreground">{formatTime(item.scheduled_time)}</div>}
                </div>
                <div>
                  <div className="text-base font-semibold">{item.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1">
                      <span className="size-2.5 rounded-[2px]" style={{ backgroundColor: formatById.get(item.format_id)?.color }} />
                      {formatById.get(item.format_id)?.name}
                    </span>
                    {item.pillar_id && <span style={{ color: lookups.pillarById.get(item.pillar_id)?.color }}>{lookups.pillarById.get(item.pillar_id)?.name}</span>}
                    <StatusBadge status={item.status} />
                    {item.platforms.length > 0 && <span className="text-muted-foreground">{item.platforms.join(', ')}</span>}
                  </div>
                  {item.purpose && <p className="mt-2"><strong className="text-xs uppercase text-muted-foreground">Purpose</strong><br />{item.purpose}</p>}
                  <p className="mt-2 whitespace-pre-wrap"><strong className="text-xs uppercase text-muted-foreground">Caption</strong><br />{item.caption || '—'}</p>
                  {item.hashtags.length > 0 && <p className="mt-2 text-primary">{item.hashtags.join(' ')}</p>}
                  {item.call_to_action && <p className="mt-2"><strong className="text-xs uppercase text-muted-foreground">Call to action</strong><br />{item.call_to_action}</p>}
                  {options.includeNotes && item.internal_notes && (
                    <p className="mt-2 whitespace-pre-wrap"><strong className="text-xs uppercase text-muted-foreground">Internal notes</strong><br />{item.internal_notes}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
