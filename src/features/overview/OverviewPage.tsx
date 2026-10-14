import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, CalendarDays, KanbanSquare, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState, ErrorState, PageLoader } from '@/components/common/states'
import { FormatTag, OverdueFlag, PersonAvatar, StatusBadge, STATUS_STYLE } from '@/components/content/badges'
import { useContentPanel } from '@/components/content/ContentPanel'
import { useActiveWorkspace } from '@/features/workspace/WorkspaceProvider'
import { useLookups, type Lookups } from '@/hooks/useWorkspaceData'
import { useOpenContent, useRecentContent } from '@/hooks/useContent'
import { can } from '@/lib/permissions'
import { addDays, formatDate, formatTime, formatTimestamp, relativeDays } from '@/lib/dates'
import { overdueReason } from '@/lib/summary'
import type { ContentItem, ContentStatus } from '@/types/database'
import { cn } from '@/lib/utils'

function Metric({ to, label, value, hint, tone, icon }: { to: string; label: string; value: number; hint: string; tone?: 'danger'; icon?: ReactNode }) {
  return (
    <Link
      to={to}
      className="group flex flex-col gap-0.5 border-r border-b bg-card px-4 py-3 transition-colors last:border-r-0 hover:bg-accent/50 focus-visible:relative focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className={cn('text-2xl font-semibold tabular', tone === 'danger' && value > 0 && 'text-red-700')}>{value}</span>
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {hint} <ArrowRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </span>
    </Link>
  )
}

function ItemRow({ item, lookups, today, onOpen, showDate = true }: { item: ContentItem; lookups: Lookups; today: string; onOpen: () => void; showDate?: boolean }) {
  const overdue = overdueReason(item, today)
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none">
        {showDate && (
          <div className="w-20 shrink-0 text-xs">
            <div className="font-medium">{item.scheduled_date ? formatDate(item.scheduled_date, 'EEE d MMM') : 'Unscheduled'}</div>
            <div className="text-muted-foreground">
              {item.scheduled_date ? relativeDays(item.scheduled_date, today) : ''}
              {item.scheduled_time ? ` · ${formatTime(item.scheduled_time)}` : ''}
            </div>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{item.title}</div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <FormatTag format={lookups.formatById.get(item.format_id)} />
            <span className="truncate">{lookups.brandById.get(item.brand_id)?.name}</span>
          </div>
        </div>
        <div className="hidden shrink-0 items-center gap-2 sm:flex">
          {overdue && <OverdueFlag reason={overdue} />}
          <StatusBadge status={item.status} />
          {item.assigned_to && <PersonAvatar name={lookups.personName(item.assigned_to)} />}
        </div>
      </button>
    </li>
  )
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col rounded-lg border bg-card">
      <header className="flex items-center justify-between border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  )
}

export default function OverviewPage() {
  const { role, today, profile, timezone } = useActiveWorkspace()
  const lookups = useLookups()
  const { openContent, createContent } = useContentPanel()
  const open = useOpenContent()
  const recent = useRecentContent(8)

  const groups = useMemo(() => {
    const items = open.data ?? []
    const by = (s: ContentStatus) => items.filter((i) => i.status === s)
    const horizon = addDays(today, 14)
    return {
      upcoming: items
        .filter((i) => i.scheduled_date && i.scheduled_date >= today && i.scheduled_date <= horizon)
        .sort((a, b) => (a.scheduled_date! + (a.scheduled_time ?? '')).localeCompare(b.scheduled_date! + (b.scheduled_time ?? ''))),
      upcomingWeek: items.filter((i) => i.scheduled_date && i.scheduled_date >= today && i.scheduled_date <= addDays(today, 6)).length,
      inProduction: by('in_production').length,
      forReview: by('for_review').length,
      needsRevision: by('needs_revision').length,
      approved: by('approved').length,
      overdue: items.filter((i) => overdueReason(i, today)).sort((a, b) => (a.scheduled_date ?? '').localeCompare(b.scheduled_date ?? '')),
    }
  }, [open.data, today])

  const greetingName = profile?.full_name?.split(' ')[0]

  return (
    <div className="flex flex-col">
      <PageHeader
        title={greetingName ? `Hello, ${greetingName}` : 'Overview'}
        description={`Today is ${formatDate(today, 'EEEE, d MMMM yyyy')} (${timezone}).`}
        actions={
          <>
            {can(role, 'content.create') && (
              <Button size="sm" onClick={() => createContent({ scheduled_date: today })}>
                <Plus /> New content
              </Button>
            )}
            <Button size="sm" variant="outline" asChild>
              <Link to="/calendar">
                <CalendarDays /> Open calendar
              </Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to="/board">
                <KanbanSquare /> Production board
              </Link>
            </Button>
          </>
        }
      />

      {open.isError ? (
        <ErrorState error={open.error} onRetry={() => open.refetch()} />
      ) : open.isPending || lookups.loading ? (
        <PageLoader />
      ) : (
        <div className="flex flex-col gap-4 p-4 md:p-6">
          <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-b-0 sm:grid-cols-3 xl:grid-cols-6">
            <Metric to={`/calendar?view=week&d=${today}`} label="Next 7 days" value={groups.upcomingWeek} hint="Scheduled, not yet live" icon={<CalendarDays className="size-3.5" />} />
            <Metric to="/board?status=in_production" label="In production" value={groups.inProduction} hint="Being created" icon={<STATUS_STYLE.in_production.icon className="size-3.5" />} />
            <Metric to="/board?status=for_review" label="Awaiting review" value={groups.forReview} hint="Ready to check" icon={<STATUS_STYLE.for_review.icon className="size-3.5" />} />
            <Metric to="/board?status=needs_revision" label="Needs revision" value={groups.needsRevision} hint="Sent back" icon={<STATUS_STYLE.needs_revision.icon className="size-3.5" />} />
            <Metric to="/board?status=approved" label="Approved" value={groups.approved} hint="Waiting to publish" icon={<STATUS_STYLE.approved.icon className="size-3.5" />} />
            <Metric to="/library?overdue=1" label="Overdue" value={groups.overdue.length} hint="Past deadline or date" tone="danger" icon={<AlertTriangle className="size-3.5" />} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Panel
              title="Upcoming posts · next 14 days"
              action={
                <Link to={`/calendar?view=two_week&d=${today}`} className="text-xs font-medium text-primary hover:underline">
                  Two-week view
                </Link>
              }
            >
              {groups.upcoming.length === 0 ? (
                <EmptyState title="Nothing scheduled in the next two weeks" description={can(role, 'content.create') ? 'Plan something from the calendar.' : undefined} />
              ) : (
                <ul className="divide-y">
                  {groups.upcoming.slice(0, 12).map((item) => (
                    <ItemRow key={item.id} item={item} lookups={lookups} today={today} onOpen={() => openContent(item.id)} />
                  ))}
                </ul>
              )}
            </Panel>

            <div className="flex min-w-0 flex-col gap-4">
              <Panel
                title={`Overdue (${groups.overdue.length})`}
                action={
                  groups.overdue.length > 0 && (
                    <Link to="/library?overdue=1" className="text-xs font-medium text-primary hover:underline">
                      View all
                    </Link>
                  )
                }
              >
                {groups.overdue.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing overdue.</p>
                ) : (
                  <ul className="divide-y">
                    {groups.overdue.slice(0, 6).map((item) => (
                      <ItemRow key={item.id} item={item} lookups={lookups} today={today} onOpen={() => openContent(item.id)} />
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel
                title="Recently updated"
                action={
                  <Link to="/library?sort=updated_desc" className="text-xs font-medium text-primary hover:underline">
                    Library
                  </Link>
                }
              >
                {recent.isPending ? (
                  <PageLoader />
                ) : recent.isError ? (
                  <ErrorState error={recent.error} onRetry={() => recent.refetch()} />
                ) : recent.data.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-muted-foreground">No content yet.</p>
                ) : (
                  <ul className="divide-y">
                    {recent.data.map((item) => (
                      <li key={item.id}>
                        <button type="button" onClick={() => openContent(item.id)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{item.title}</div>
                            <div className="text-xs text-muted-foreground">
                              {formatTimestamp(item.updated_at, timezone)}
                              {item.updated_by && ` · ${lookups.personName(item.updated_by)}`}
                            </div>
                          </div>
                          <StatusBadge status={item.status} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
