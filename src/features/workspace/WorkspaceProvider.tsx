import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { requireSupabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import type { Profile, Workspace, WorkspaceMember, WorkspaceRole } from '@/types/database'
import { todayInTimeZone } from '@/lib/dates'

export interface MembershipWithWorkspace extends Pick<WorkspaceMember, 'id' | 'workspace_id' | 'role' | 'status' | 'joined_at'> {
  workspace: Workspace | null
}

interface WorkspaceContextValue {
  profile: Profile | null
  memberships: MembershipWithWorkspace[]
  membership: MembershipWithWorkspace | null
  workspace: Workspace | null
  role: WorkspaceRole | null
  userId: string | null
  timezone: string
  today: string
  loading: boolean
  error: unknown
  switchWorkspace: (workspaceId: string) => void
  refresh: () => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)
const PREFERRED_KEY = 'jm.preferred-workspace'

function readPreferred(): string | null {
  try {
    return window.localStorage.getItem(PREFERRED_KEY)
  } catch {
    return null
  }
}

/**
 * Loads the signed-in user's profile and memberships from the database.
 * The preferred workspace id in localStorage is only a UI preference; it is
 * honoured only if it matches an active membership returned by the server.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [preferred, setPreferred] = useState<string | null>(readPreferred)
  const userId = user?.id ?? null

  const profileQuery = useQuery({
    queryKey: ['me', userId, 'profile'],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await requireSupabase().from('profiles').select('*').eq('id', userId!).maybeSingle()
      if (error) throw error
      return data
    },
  })

  const membershipsQuery = useQuery({
    queryKey: ['me', userId, 'memberships'],
    enabled: !!userId,
    queryFn: async (): Promise<MembershipWithWorkspace[]> => {
      const { data, error } = await requireSupabase()
        .from('workspace_members')
        .select('id, workspace_id, role, status, joined_at, workspace:workspaces(*)')
        .eq('user_id', userId!)
        .order('joined_at')
      if (error) throw error
      return (data ?? []) as unknown as MembershipWithWorkspace[]
    },
  })

  const memberships = useMemo(() => membershipsQuery.data ?? [], [membershipsQuery.data])
  const active = memberships.filter((m) => m.status === 'active' && m.workspace)
  const membership = active.find((m) => m.workspace_id === preferred) ?? active[0] ?? null
  const workspace = membership?.workspace ?? null
  const timezone = workspace?.timezone ?? 'Asia/Manila'

  const switchWorkspace = useCallback(
    (workspaceId: string) => {
      setPreferred(workspaceId)
      try {
        window.localStorage.setItem(PREFERRED_KEY, workspaceId)
      } catch {
        // Preference only; ignore storage failures.
      }
    },
    [],
  )

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['me', userId] })
  }, [queryClient, userId])

  const value: WorkspaceContextValue = {
    profile: profileQuery.data ?? null,
    memberships,
    membership,
    workspace,
    role: membership?.role ?? null,
    userId,
    timezone,
    today: todayInTimeZone(timezone),
    loading: profileQuery.isPending || membershipsQuery.isPending,
    error: profileQuery.error ?? membershipsQuery.error,
    switchWorkspace,
    refresh,
  }

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return ctx
}

/** For components that only render inside an authorised workspace. */
export function useActiveWorkspace() {
  const ctx = useWorkspace()
  if (!ctx.workspace || !ctx.role || !ctx.userId) throw new Error('No active workspace')
  return { ...ctx, workspace: ctx.workspace, role: ctx.role, userId: ctx.userId }
}
