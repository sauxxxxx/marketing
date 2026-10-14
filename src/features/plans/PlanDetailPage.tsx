import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, CalendarDays, Copy, Download, Lightbulb, Pencil, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState, ErrorState, PageLoader } from '@/components/common/states'
import { SummaryPanel } from '@/components/content/SummaryPanel'
import { FormatTag, OverdueFlag, PersonAvatar, PillarTag, StatusBadge } from '@/components/content/badges'
import { useContentPanel } from '@/components/content/ContentPanel'
import { useActiveWorkspace } from '@/features/workspace/WorkspaceProvider'
import { useKeyDates, useLookups } from '@/hooks/useWorkspaceData'
import { usePlanContent } from '@/hooks/useContent'
import { can, canDuplicatePlans } from '@/lib/permissions'
import { friendlyError } from '@/lib/errors'
import { formatDate, formatMonth, formatTime, monthKey, monthRange } from '@/lib/dates'
import { computeSummary, overdueReason } from '@/lib/summary'
import type { ContentItem, PlanStatus } from '@/types/database'
import { ExportDialog } from '@/features/export/ExportDialog'
import { DuplicatePlanDialog, RenamePlanDialog } from './PlanDialogs'
import { PLAN_STATUS_LABEL, usePlan, useSavePlan } from './usePlans'
import { PlanStatusBadge } from './PlansPage'

export default function PlanDetailPage() {
  const { planId } = useParams()
  const { role, workspace, today } = useActiveWorkspace()
  const lookups = useLookups()
  const { openContent, createContent } = useContentPanel()
  const plan = usePlan(planId)
  const content = usePlanContent(planId)
  const range = plan.data ? monthRange(plan.data.year, plan.data.month) : null
  const keyDates = useKeyDates(range?.from, range?.to)
  const save = useSavePlan()
  const [renaming, setRenaming] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [exporting, setExporting] = useState(false)

  const { scheduled, ideas } = useMemo(() => {
    const items = content.data ?? []
    return { scheduled: items.filter((i) => i.scheduled_date), ideas: items.filter((i) => !i.scheduled_date) }
  }, [content.data])

  if (plan.isPending || lookups.loading) return <PageLoader />
  if (plan.isError) return <ErrorState error={plan.error} onRetry={() => plan.refetch()} />
  if (!plan.data) return <EmptyState title="Plan not found" description="It may belong to another workspace or no longer exist." action={<Button asChild size="sm"><Link to="/plans">Back to plans</Link></Button>} />

  const p = plan.data
  const brand = lookups.brandById.get(p.brand_id)
  const canManage = can(role, 'plans.manage')
  const summary = computeSummary({ items: scheduled, from: range!.from, to: range!.to, today, formats: lookups.formats, pillars: lookups.pillars, unscheduledIdeas: ideas.length })

  const setStatus = async (status: PlanStatus) => {
    try {
      await save.mutateAsync({ id: p.id, status })
      toast.success(`Plan marked ${PLAN_STATUS_LABEL[status].toLowerCase()}.`)
    } catch (error) {
      toast.error(friendlyError(error))
    }
  }

  const row = (item: ContentItem) => {
    const overdue = overdueReason(item, today)
    return (
      <li key={item.id}>
        <button type="button" onClick={() => openContent(item.id)} className="grid w-full grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-3 px-4 py-2.5 text-left hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none sm:grid-cols-[5.5rem_minmax(0,1fr)_auto]">
          <div className="text-xs">
            <div className="font-medium">{item.scheduled_date ? formatDate(item.scheduled_date, 'EEE d MMM') : 'Idea'}</div>
            {item.scheduled_time && <div className="text-muted-foreground">{formatTime(item.scheduled_time)}</div>}
          </div>
          <div className="min-w-0">
            <div className={`truncate text-sm font-medium ${item.status === 'cancelled' ? 'line-through opacity-60' : ''}`}>{item.title}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <FormatTag format={lookups.formatById.get(item.format_id)} />
              {item.pillar_id && <PillarTag pillar={lookups.pillarById.get(item.pillar_id)} />}
              {item.caption ? <span className="truncate text-xs text-muted-foreground">{item.caption.slice(0, 90)}</span> : <span className="text-xs text-muted-foreground italic">No caption yet</span>}
            </div>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            {overdue && <OverdueFlag reason={overdue} />}
            <StatusBadge status={item.status} />
            {item.assigned_to && <PersonAvatar name={lookups.personName(item.assigned_to)} />}
          </div>
        </button>
      </li>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Link to="/plans" className="text-muted-foreground hover:text-foreground" aria-label="Back to plans">
              <ArrowLeft className="size-4" />
            </Link>
            {p.title}
          </span>
        }
        description={`${brand?.name ?? 'Brand'} · ${formatMonth(p.year, p.month)}`}
        actions={
          <>
            {canManage ? (
              <Select value={p.status} onValueChange={(v) => setStatus(v as PlanStatus)}>
                <SelectTrigger size="sm" className="w-36" aria-label="Plan status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PLAN_STATUS_LABEL) as PlanStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {PLAN_STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <PlanStatusBadge status={p.status} />
            )}
            <Button size="sm" variant="outline" asChild>
              <Link to={`/calendar?view=month&d=${monthKey(p.year, p.month)}-01&brand=${p.brand_id}`}>
                <CalendarDays /> Calendar
              </Link>
            </Button>
            <Button size="sm" variant="outline" onClick={() => setExporting(true)}>
              <Download /> Export
            </Button>
            {canManage && (
              <Button size="sm" variant="outline" onClick={() => setRenaming(true)}>
                <Pencil /> Rename
              </Button>
            )}
            {canDuplicatePlans(role, workspace) && (
              <Button size="sm" variant="outline" onClick={() => setDuplicating(true)}>
                <Copy /> Duplicate
              </Button>
            )}
          </>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-4 p-3 md:p-4">
          {p.status === 'archived' && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">This plan is archived. Its content is kept and still appears on the calendar.</p>
          )}
          <section className="rounded-lg border bg-card">
            <header className="flex items-center justify-between border-b px-4 py-2.5">
              <h2 className="text-sm font-semibold">Scheduled posts ({scheduled.length})</h2>
              {can(role, 'content.create') && brand?.is_active && (
                <Button size="xs" variant="outline" onClick={() => createContent({ brand_id: p.brand_id, scheduled_date: `${monthKey(p.year, p.month)}-01` })}>
                  <Plus /> Add post
                </Button>
              )}
            </header>
            {content.isPending ? (
              <PageLoader />
            ) : content.isError ? (
              <ErrorState error={content.error} onRetry={() => content.refetch()} />
            ) : scheduled.length === 0 ? (
              <EmptyState title="No posts scheduled in this plan" description="Posts scheduled for this brand and month are added automatically." />
            ) : (
              <ul className="divide-y">{scheduled.map(row)}</ul>
            )}
          </section>
          <section className="rounded-lg border bg-card">
            <header className="flex items-center justify-between border-b px-4 py-2.5">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <Lightbulb className="size-4 text-muted-foreground" aria-hidden /> Unscheduled ideas ({ideas.length})
              </h2>
              {can(role, 'content.create') && brand?.is_active && (
                <Button size="xs" variant="outline" onClick={() => createContent({ brand_id: p.brand_id, monthly_plan_id: p.id })}>
                  <Plus /> Add idea
                </Button>
              )}
            </header>
            {ideas.length === 0 ? <p className="px-4 py-4 text-sm text-muted-foreground">No ideas parked in this plan. Ideas don’t count as scheduled posts.</p> : <ul className="divide-y">{ideas.map(row)}</ul>}
          </section>
        </div>
        <SummaryPanel
          className="shrink-0 border-t lg:w-72 lg:overflow-y-auto lg:border-t-0 lg:border-l"
          summary={summary}
          keyDates={keyDates.data ?? []}
          periodLabel={formatMonth(p.year, p.month)}
        />
      </div>

      <RenamePlanDialog plan={renaming ? p : null} onOpenChange={(o) => !o && setRenaming(false)} />
      <DuplicatePlanDialog plan={duplicating ? p : null} onOpenChange={(o) => !o && setDuplicating(false)} />
      <ExportDialog open={exporting} onOpenChange={setExporting} year={p.year} month={p.month} brandIds={[p.brand_id]} />
    </div>
  )
}
