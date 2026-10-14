import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { requireSupabase } from '@/lib/supabase'
import { friendlyError } from '@/lib/errors'
import { optimisticallyPatchContent } from '@/lib/optimistic'
import { OPEN_STATUSES } from '@/lib/status'
import { useActiveWorkspace } from '@/features/workspace/WorkspaceProvider'
import type { ContentActivity, ContentInsert, ContentItem, ContentStatus, ContentUpdate } from '@/types/database'
import { wsKey } from './useWorkspaceData'

/** Every column except the derived search_text. */
export const CONTENT_COLUMNS =
  'id, workspace_id, monthly_plan_id, brand_id, title, platforms, format_id, pillar_id, caption, hashtags, call_to_action, purpose, target_audience, creative_brief, reference_urls, scheduled_date, scheduled_time, deadline_date, status, assigned_to, internal_notes, approved_at, approved_by, published_at, published_url, publication_notes, source_item_id, is_demo, created_by, updated_by, created_at, updated_at, deleted_at, deleted_by'

export const contentKey = (workspaceId: string) => [...wsKey(workspaceId), 'content'] as const

const client = () => requireSupabase()

/** Scheduled, non-archived content in an inclusive date range. */
export function useContentRange(from: string, to: string) {
  const { workspace } = useActiveWorkspace()
  return useQuery({
    queryKey: [...contentKey(workspace.id), 'range', from, to],
    queryFn: async () => {
      const { data, error } = await client()
        .from('content_items')
        .select(CONTENT_COLUMNS)
        .eq('workspace_id', workspace.id)
        .is('deleted_at', null)
        .gte('scheduled_date', from)
        .lte('scheduled_date', to)
        .order('scheduled_date')
        .order('scheduled_time', { nullsFirst: true })
        .order('created_at')
      if (error) throw error
      return data as unknown as ContentItem[]
    },
    placeholderData: keepPreviousData,
  })
}

export function useUnscheduledContent(planId?: string) {
  const { workspace } = useActiveWorkspace()
  return useQuery({
    queryKey: [...contentKey(workspace.id), 'unscheduled', planId ?? null],
    queryFn: async () => {
      let query = client()
        .from('content_items')
        .select(CONTENT_COLUMNS)
        .eq('workspace_id', workspace.id)
        .is('deleted_at', null)
        .is('scheduled_date', null)
        .order('updated_at', { ascending: false })
        .limit(200)
      if (planId) query = query.eq('monthly_plan_id', planId)
      const { data, error } = await query
      if (error) throw error
      return data as unknown as ContentItem[]
    },
  })
}

export function usePlanContent(planId: string | undefined) {
  const { workspace } = useActiveWorkspace()
  return useQuery({
    queryKey: [...contentKey(workspace.id), 'plan', planId],
    enabled: !!planId,
    queryFn: async () => {
      const { data, error } = await client()
        .from('content_items')
        .select(CONTENT_COLUMNS)
        .eq('workspace_id', workspace.id)
        .eq('monthly_plan_id', planId!)
        .is('deleted_at', null)
        .order('scheduled_date', { nullsFirst: false })
        .order('scheduled_time', { nullsFirst: true })
      if (error) throw error
      return data as unknown as ContentItem[]
    },
  })
}

/** Unfinished work across all dates, for the overview. */
export function useOpenContent() {
  const { workspace } = useActiveWorkspace()
  return useQuery({
    queryKey: [...contentKey(workspace.id), 'open'],
    queryFn: async () => {
      const { data, error } = await client()
        .from('content_items')
        .select(CONTENT_COLUMNS)
        .eq('workspace_id', workspace.id)
        .is('deleted_at', null)
        .in('status', OPEN_STATUSES as ContentStatus[])
        .order('scheduled_date', { nullsFirst: false })
        .limit(1000)
      if (error) throw error
      return data as unknown as ContentItem[]
    },
  })
}

export function useRecentContent(limit = 8) {
  const { workspace } = useActiveWorkspace()
  return useQuery({
    queryKey: [...contentKey(workspace.id), 'recent', limit],
    queryFn: async () => {
      const { data, error } = await client()
        .from('content_items')
        .select(CONTENT_COLUMNS)
        .eq('workspace_id', workspace.id)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return data as unknown as ContentItem[]
    },
  })
}

export function useContentItem(id: string | null | undefined) {
  const { workspace } = useActiveWorkspace()
  return useQuery({
    queryKey: [...contentKey(workspace.id), 'item', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await client().from('content_items').select(CONTENT_COLUMNS).eq('id', id!).maybeSingle()
      if (error) throw error
      return data as unknown as ContentItem | null
    },
  })
}

export function useContentActivity(id: string | null | undefined) {
  const { workspace } = useActiveWorkspace()
  return useQuery({
    queryKey: [...contentKey(workspace.id), 'activity', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await client()
        .from('content_activity')
        .select('*')
        .eq('content_id', id!)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data as ContentActivity[]
    },
  })
}

export interface LibraryParams {
  search: string
  brandIds: string[]
  formatIds: string[]
  pillarIds: string[]
  statuses: ContentStatus[]
  assigneeIds: string[]
  from: string
  to: string
  scheduling: 'all' | 'scheduled' | 'unscheduled' | 'in_plan'
  archived: boolean
  /** Only overdue work (see lib/summary.ts overdueReason), relative to `today`. */
  overdue: boolean
  today: string
  sort: 'scheduled_desc' | 'scheduled_asc' | 'updated_desc' | 'title_asc'
  page: number
}

export const LIBRARY_PAGE_SIZE = 25

/** Escapes LIKE wildcards. PostgREST also treats * as a wildcard, so it is dropped. */
export function escapeLike(value: string): string {
  value = value.replace(/\*/g, ' ')
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

export function useLibrary(params: LibraryParams) {
  const { workspace } = useActiveWorkspace()
  return useQuery({
    queryKey: [...contentKey(workspace.id), 'library', params],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = client()
        .from('content_items')
        .select(CONTENT_COLUMNS, { count: 'exact' })
        .eq('workspace_id', workspace.id)
      query = params.archived ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null)
      const search = params.search.trim().toLowerCase()
      if (search) query = query.like('search_text', `%${escapeLike(search)}%`)
      if (params.brandIds.length) query = query.in('brand_id', params.brandIds)
      if (params.formatIds.length) query = query.in('format_id', params.formatIds)
      if (params.pillarIds.length) query = query.in('pillar_id', params.pillarIds)
      if (params.statuses.length) query = query.in('status', params.statuses)
      if (params.assigneeIds.length) {
        const ids = params.assigneeIds.filter((a) => a !== 'unassigned')
        const unassigned = params.assigneeIds.includes('unassigned')
        if (unassigned && ids.length) query = query.or(`assigned_to.is.null,assigned_to.in.(${ids.join(',')})`)
        else if (unassigned) query = query.is('assigned_to', null)
        else query = query.in('assigned_to', ids)
      }
      if (params.from) query = query.gte('scheduled_date', params.from)
      if (params.to) query = query.lte('scheduled_date', params.to)
      if (params.scheduling === 'scheduled') query = query.not('scheduled_date', 'is', null)
      if (params.scheduling === 'unscheduled') query = query.is('scheduled_date', null)
      if (params.scheduling === 'in_plan') query = query.not('monthly_plan_id', 'is', null)
      if (params.overdue && /^\d{4}-\d{2}-\d{2}$/.test(params.today)) {
        query = query
          .not('status', 'in', '(published,cancelled)')
          .or(`scheduled_date.lt.${params.today},and(deadline_date.lt.${params.today},status.in.(planned,in_production,for_review,needs_revision))`)
      }
      switch (params.sort) {
        case 'scheduled_asc':
          query = query.order('scheduled_date', { ascending: true, nullsFirst: false })
          break
        case 'updated_desc':
          query = query.order('updated_at', { ascending: false })
          break
        case 'title_asc':
          query = query.order('title', { ascending: true })
          break
        default:
          query = query.order('scheduled_date', { ascending: false, nullsFirst: true })
      }
      const start = params.page * LIBRARY_PAGE_SIZE
      const { data, error, count } = await query.order('id').range(start, start + LIBRARY_PAGE_SIZE - 1)
      if (error) throw error
      return { rows: data as unknown as ContentItem[], count: count ?? 0 }
    },
  })
}

export function useCreateContent() {
  const { workspace } = useActiveWorkspace()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (insert: Omit<ContentInsert, 'workspace_id'>) => {
      const { data, error } = await client()
        .from('content_items')
        .insert({ ...insert, workspace_id: workspace.id })
        .select(CONTENT_COLUMNS)
        .single()
      if (error) throw error
      return data as unknown as ContentItem
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: contentKey(workspace.id) }),
  })
}

export function useUpdateContent() {
  const { workspace } = useActiveWorkspace()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: ContentUpdate }) => {
      const { data, error } = await client().from('content_items').update(patch).eq('id', id).select(CONTENT_COLUMNS).single()
      if (error) throw error
      return data as unknown as ContentItem
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: contentKey(workspace.id) }),
  })
}

/**
 * Optimistic patch for drag-and-drop and quick status changes. The UI moves
 * immediately; if the database rejects the write, every cache is restored
 * and the error is shown.
 */
export function usePatchContentOptimistic(successMessage?: (item: ContentItem) => string) {
  const { workspace } = useActiveWorkspace()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: ContentUpdate; label?: string }) => {
      const { data, error } = await client().from('content_items').update(patch).eq('id', id).select(CONTENT_COLUMNS).single()
      if (error) throw error
      return data as unknown as ContentItem
    },
    onMutate: async ({ id, patch }) => {
      const restore = await optimisticallyPatchContent(queryClient, contentKey(workspace.id), id, patch as Partial<ContentItem>)
      return { restore }
    },
    onError: (error, _vars, context) => {
      context?.restore()
      toast.error(friendlyError(error, 'The change could not be saved.'))
    },
    onSuccess: (item) => {
      if (successMessage) toast.success(successMessage(item))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: contentKey(workspace.id) }),
  })
}

export function useDeleteContentPermanently() {
  const { workspace } = useActiveWorkspace()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data: assets } = await client().from('content_assets').select('storage_path').eq('content_id', id)
      const { data, error } = await client().from('content_items').delete().eq('id', id).select('id')
      if (error) throw error
      if (!data?.length) throw { code: 'PGRST116' }
      // Asset rows cascade with the item; remove the stored files as well.
      const paths = (assets ?? []).map((a) => a.storage_path).filter((p): p is string => !!p)
      if (paths.length) await client().storage.from('workspace-files').remove(paths)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: contentKey(workspace.id) }),
  })
}
