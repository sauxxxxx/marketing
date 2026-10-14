import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requireSupabase } from '@/lib/supabase'
import { useActiveWorkspace } from '@/features/workspace/WorkspaceProvider'
import { wsKey } from '@/hooks/useWorkspaceData'
import { contentKey } from '@/hooks/useContent'
import type { ContentStatus, DuplicatePreviewRow, MonthlyPlan, PlanStatus } from '@/types/database'

export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  archived: 'Archived',
}

export function usePlan(planId: string | undefined) {
  const { workspace } = useActiveWorkspace()
  return useQuery({
    queryKey: [...wsKey(workspace.id), 'plans', planId],
    enabled: !!planId,
    queryFn: async () => {
      const { data, error } = await requireSupabase().from('monthly_plans').select('*').eq('id', planId!).maybeSingle()
      if (error) throw error
      return data as MonthlyPlan | null
    },
  })
}

/** Per-plan counts (scheduled, non-cancelled posts and ideas) for the plans list. */
export function usePlanCounts(planIds: string[]) {
  const { workspace } = useActiveWorkspace()
  return useQuery({
    queryKey: [...contentKey(workspace.id), 'plan-counts', planIds],
    enabled: planIds.length > 0,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('content_items')
        .select('monthly_plan_id, status, scheduled_date')
        .in('monthly_plan_id', planIds)
        .is('deleted_at', null)
      if (error) throw error
      const counts = new Map<string, { planned: number; published: number; ideas: number }>()
      for (const row of (data ?? []) as { monthly_plan_id: string; status: ContentStatus; scheduled_date: string | null }[]) {
        const c = counts.get(row.monthly_plan_id) ?? { planned: 0, published: 0, ideas: 0 }
        if (!row.scheduled_date) c.ideas += 1
        else if (row.status !== 'cancelled') c.planned += 1
        if (row.status === 'published') c.published += 1
        counts.set(row.monthly_plan_id, c)
      }
      return counts
    },
  })
}

export function useSavePlan() {
  const { workspace } = useActiveWorkspace()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id?: string; brand_id?: string; year?: number; month?: number; title?: string; status?: PlanStatus; notes?: string | null }) => {
      const client = requireSupabase()
      if (input.id) {
        const { id, ...patch } = input
        const update: Partial<Pick<MonthlyPlan, 'title' | 'status' | 'notes'>> = {}
        if (patch.title !== undefined) update.title = patch.title
        if (patch.status !== undefined) update.status = patch.status
        if (patch.notes !== undefined) update.notes = patch.notes
        const { data, error } = await client.from('monthly_plans').update(update).eq('id', id).select('*').single()
        if (error) throw error
        return data as MonthlyPlan
      }
      const { data, error } = await client
        .from('monthly_plans')
        .insert({
          workspace_id: workspace.id,
          brand_id: input.brand_id!,
          year: input.year!,
          month: input.month!,
          title: input.title!,
          status: input.status ?? 'draft',
        })
        .select('*')
        .single()
      if (error) throw error
      return data as MonthlyPlan
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [...wsKey(workspace.id), 'plans'] })
      queryClient.invalidateQueries({ queryKey: contentKey(workspace.id) })
    },
  })
}

export interface DuplicateInput {
  sourcePlanId: string
  targetBrandId: string
  targetYear: number
  targetMonth: number
  copyMode: 'full' | 'structure'
  includeUnscheduled: boolean
  missingDateStrategy: 'last_day' | 'skip' | 'unscheduled'
  targetTitle?: string
}

export async function runDuplicate(input: DuplicateInput, dryRun: boolean): Promise<DuplicatePreviewRow[]> {
  const { data, error } = await requireSupabase().rpc('duplicate_monthly_plan', {
    p_source_plan_id: input.sourcePlanId,
    p_target_brand_id: input.targetBrandId,
    p_target_year: input.targetYear,
    p_target_month: input.targetMonth,
    p_copy_mode: input.copyMode,
    p_include_unscheduled: input.includeUnscheduled,
    p_missing_date_strategy: input.missingDateStrategy,
    p_dry_run: dryRun,
    p_target_title: input.targetTitle?.trim() || null,
  })
  if (error) throw error
  return (data ?? []) as DuplicatePreviewRow[]
}
