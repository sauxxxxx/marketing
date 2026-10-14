import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { requireSupabase } from '@/lib/supabase'
import { useActiveWorkspace } from '@/features/workspace/WorkspaceProvider'
import type { Brand, BrandEditor, ConfigItem, KeyDate, MonthlyPlan, Profile, WorkspaceMember } from '@/types/database'

export const wsKey = (workspaceId: string) => ['ws', workspaceId] as const

export interface MemberWithProfile extends Pick<WorkspaceMember, 'id' | 'user_id' | 'role' | 'status' | 'joined_at' | 'deactivated_at'> {
  profile: Pick<Profile, 'id' | 'full_name' | 'email' | 'avatar_url'> | null
}

export function useBrands() {
  const { workspace } = useActiveWorkspace()
  return useQuery({
    queryKey: [...wsKey(workspace.id), 'brands'],
    queryFn: async () => {
      const { data, error } = await requireSupabase().from('brands').select('*').eq('workspace_id', workspace.id).order('name')
      if (error) throw error
      return data as Brand[]
    },
    staleTime: 60_000,
  })
}

function useConfig(table: 'content_formats' | 'content_pillars') {
  const { workspace } = useActiveWorkspace()
  return useQuery({
    queryKey: [...wsKey(workspace.id), table],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from(table)
        .select('*')
        .eq('workspace_id', workspace.id)
        .order('sort_order')
        .order('name')
      if (error) throw error
      return data as ConfigItem[]
    },
    staleTime: 60_000,
  })
}

export const useFormats = () => useConfig('content_formats')
export const usePillars = () => useConfig('content_pillars')

export function useMembers() {
  const { workspace } = useActiveWorkspace()
  return useQuery({
    queryKey: [...wsKey(workspace.id), 'members'],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('workspace_members')
        .select('id, user_id, role, status, joined_at, deactivated_at, profile:profiles!workspace_members_user_id_fkey(id, full_name, email, avatar_url)')
        .eq('workspace_id', workspace.id)
        .order('joined_at')
      if (error) throw error
      return data as unknown as MemberWithProfile[]
    },
    staleTime: 60_000,
  })
}

export function useKeyDates(from?: string, to?: string) {
  const { workspace } = useActiveWorkspace()
  return useQuery({
    queryKey: [...wsKey(workspace.id), 'key_dates', from ?? null, to ?? null],
    queryFn: async () => {
      let query = requireSupabase().from('key_dates').select('*').eq('workspace_id', workspace.id).order('date')
      if (from) query = query.gte('date', from)
      if (to) query = query.lte('date', to)
      const { data, error } = await query
      if (error) throw error
      return data as KeyDate[]
    },
    staleTime: 60_000,
  })
}

export function usePlans() {
  const { workspace } = useActiveWorkspace()
  return useQuery({
    queryKey: [...wsKey(workspace.id), 'plans'],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('monthly_plans')
        .select('*')
        .eq('workspace_id', workspace.id)
        .order('year', { ascending: false })
        .order('month', { ascending: false })
      if (error) throw error
      return data as MonthlyPlan[]
    },
  })
}

/** Which editors work on which brands (see migration 900). */
export function useBrandEditors() {
  const { workspace } = useActiveWorkspace()
  return useQuery({
    queryKey: [...wsKey(workspace.id), 'brand_editors'],
    queryFn: async () => {
      const { data, error } = await requireSupabase().from('brand_editors').select('*').eq('workspace_id', workspace.id)
      if (error) throw error
      return data as BrandEditor[]
    },
    staleTime: 60_000,
  })
}

/** Lookup maps used by cards, filters, the editor and PDF export. */
export function useLookups() {
  const { role, userId } = useActiveWorkspace()
  const brands = useBrands()
  const formats = useFormats()
  const pillars = usePillars()
  const members = useMembers()
  const brandEditors = useBrandEditors()
  return useMemo(() => {
    const editorsByBrand = new Map<string, string[]>()
    for (const be of brandEditors.data ?? []) editorsByBrand.set(be.brand_id, [...(editorsByBrand.get(be.brand_id) ?? []), be.user_id])
    // Editors work only in brands assigned to them; admins and viewers see all brands.
    const myBrandIds = new Set(
      role === 'editor'
        ? (brandEditors.data ?? []).filter((be) => be.user_id === userId).map((be) => be.brand_id)
        : (brands.data ?? []).map((b) => b.id),
    )
    const brandById = new Map((brands.data ?? []).map((b) => [b.id, b]))
    const formatById = new Map((formats.data ?? []).map((f) => [f.id, f]))
    const pillarById = new Map((pillars.data ?? []).map((p) => [p.id, p]))
    const memberByUserId = new Map((members.data ?? []).map((m) => [m.user_id, m]))
    return {
      brands: brands.data ?? [],
      formats: formats.data ?? [],
      pillars: pillars.data ?? [],
      members: members.data ?? [],
      brandById,
      formatById,
      pillarById,
      memberByUserId,
      editorsByBrand,
      myBrandIds,
      personName: (userId: string | null | undefined) => {
        if (!userId) return null
        const m = memberByUserId.get(userId)
        return m?.profile?.full_name || m?.profile?.email || 'Former member'
      },
      loading: brands.isPending || formats.isPending || pillars.isPending || members.isPending || brandEditors.isPending,
      error: brands.error ?? formats.error ?? pillars.error ?? members.error ?? brandEditors.error,
      refetch: () => Promise.all([brands.refetch(), formats.refetch(), pillars.refetch(), members.refetch(), brandEditors.refetch()]),
    }
  }, [role, userId, brands, formats, pillars, members, brandEditors])
}

export type Lookups = ReturnType<typeof useLookups>
