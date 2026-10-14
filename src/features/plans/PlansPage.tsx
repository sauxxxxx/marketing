import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Archive, ArchiveRestore, Copy, MoreHorizontal, NotebookTabs, Pencil, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState, ErrorState, PageLoader } from '@/components/common/states'
import { useActiveWorkspace } from '@/features/workspace/WorkspaceProvider'
import { useLookups, usePlans } from '@/hooks/useWorkspaceData'
import { can, canDuplicatePlans } from '@/lib/permissions'
import { friendlyError } from '@/lib/errors'
import { formatMonth } from '@/lib/dates'
import type { MonthlyPlan } from '@/types/database'
import { cn } from '@/lib/utils'
import { CreatePlanDialog, DuplicatePlanDialog, RenamePlanDialog } from './PlanDialogs'
import { PLAN_STATUS_LABEL, usePlanCounts, useSavePlan } from './usePlans'

const ALL = '__all'

export function PlanStatusBadge({ status }: { status: MonthlyPlan['status'] }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-sm border px-1.5 text-[11px] font-medium',
        status === 'approved' && 'border-emerald-200 bg-emerald-50 text-emerald-800',
        status === 'in_review' && 'border-amber-200 bg-amber-50 text-amber-900',
        status === 'draft' && 'border-slate-200 bg-slate-50 text-slate-700',
        status === 'archived' && 'border-zinc-200 bg-zinc-100 text-zinc-500',
      )}
    >
      {PLAN_STATUS_LABEL[status]}
    </span>
  )
}

export default function PlansPage() {
  const { role, workspace } = useActiveWorkspace()
  const lookups = useLookups()
  const plans = usePlans()
  const save = useSavePlan()
  const [params, setParams] = useSearchParams()
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<MonthlyPlan | null>(null)
  const [duplicating, setDuplicating] = useState<MonthlyPlan | null>(null)
  const brandFilter = params.get('brand') ?? ALL
  const showArchived = params.get('archived') === '1'

  const visible = useMemo(
    () => (plans.data ?? []).filter((p) => (showArchived || p.status !== 'archived') && (brandFilter === ALL || p.brand_id === brandFilter)),
    [plans.data, showArchived, brandFilter],
  )
  const counts = usePlanCounts(visible.map((p) => p.id))
  const canManage = can(role, 'plans.manage')
  const canDuplicate = canDuplicatePlans(role, workspace)

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value === null) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  const archive = async (plan: MonthlyPlan, restore = false) => {
    try {
      await save.mutateAsync({ id: plan.id, status: restore ? 'draft' : 'archived' })
      toast.success(restore ? 'Plan restored.' : 'Plan archived. Its content is kept.')
    } catch (error) {
      toast.error(friendlyError(error))
    }
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Monthly Plans"
        description="One publishing plan per brand per month. Plans group the month’s posts and ideas."
        actions={
          canManage && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> New plan
            </Button>
          )
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <Select value={brandFilter} onValueChange={(v) => setParam('brand', v === ALL ? null : v)}>
            <SelectTrigger size="sm" className="w-48" aria-label="Filter by brand">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All brands</SelectItem>
              {lookups.brands.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Switch id="plans-archived" checked={showArchived} onCheckedChange={(v) => setParam('archived', v ? '1' : null)} />
            <Label htmlFor="plans-archived" className="font-normal">
              Show archived
            </Label>
          </div>
        </div>
      </PageHeader>

      <div className="p-3 md:p-4">
        {plans.isError ? (
          <ErrorState error={plans.error} onRetry={() => plans.refetch()} />
        ) : plans.isPending || lookups.loading ? (
          <PageLoader />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<NotebookTabs />}
            title="No plans yet"
            description={canManage ? 'Create a plan for a brand and month, or duplicate an earlier one.' : 'Plans created by your team appear here.'}
            action={canManage && <Button size="sm" onClick={() => setCreating(true)}><Plus /> New plan</Button>}
            className="rounded-lg border bg-card"
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">Month</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-24 text-right">Planned</TableHead>
                  <TableHead className="w-24 text-right">Published</TableHead>
                  <TableHead className="w-20 text-right">Ideas</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((plan) => {
                  const c = counts.data?.get(plan.id)
                  return (
                    <TableRow key={plan.id}>
                      <TableCell className="font-medium">{formatMonth(plan.year, plan.month)}</TableCell>
                      <TableCell>
                        <Link to={`/plans/${plan.id}`} className="font-medium hover:underline">
                          {plan.title}
                        </Link>
                        <div className="text-xs text-muted-foreground">{lookups.brandById.get(plan.brand_id)?.name}</div>
                      </TableCell>
                      <TableCell>
                        <PlanStatusBadge status={plan.status} />
                      </TableCell>
                      <TableCell className="text-right tabular">{c?.planned ?? (counts.isPending ? '…' : 0)}</TableCell>
                      <TableCell className="text-right tabular">{c?.published ?? (counts.isPending ? '…' : 0)}</TableCell>
                      <TableCell className="text-right tabular">{c?.ideas ?? (counts.isPending ? '…' : 0)}</TableCell>
                      <TableCell>
                        {(canManage || canDuplicate) && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${plan.title}`}>
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {canManage && (
                                <DropdownMenuItem onSelect={() => setRenaming(plan)}>
                                  <Pencil /> Rename
                                </DropdownMenuItem>
                              )}
                              {canDuplicate && (
                                <DropdownMenuItem onSelect={() => setDuplicating(plan)}>
                                  <Copy /> Duplicate…
                                </DropdownMenuItem>
                              )}
                              {canManage &&
                                (plan.status === 'archived' ? (
                                  <DropdownMenuItem onSelect={() => archive(plan, true)}>
                                    <ArchiveRestore /> Restore
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem onSelect={() => archive(plan)}>
                                    <Archive /> Archive
                                  </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <CreatePlanDialog open={creating} onOpenChange={setCreating} defaultBrandId={brandFilter === ALL ? undefined : brandFilter} />
      <RenamePlanDialog plan={renaming} onOpenChange={(o) => !o && setRenaming(null)} />
      <DuplicatePlanDialog plan={duplicating} onOpenChange={(o) => !o && setDuplicating(null)} />
    </div>
  )
}
