import { Suspense, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ErrorState, PageLoader, PermissionDenied } from '@/components/common/states'
import { ContentPanelProvider } from '@/components/content/ContentPanel'
import { useAuth } from '@/features/auth/AuthProvider'
import { NoAccessPage } from '@/features/auth/NoAccessPage'
import { useWorkspace } from '@/features/workspace/WorkspaceProvider'
import { can, type Permission } from '@/lib/permissions'

/** Redirects to sign-in when there is no Supabase session. */
export function RequireAuth() {
  const { status, recovering } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <PageLoader />
  if (status === 'signed_out') {
    const next = `${location.pathname}${location.search}`
    return <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />
  }
  if (recovering) return <Navigate to="/reset-password" replace />
  return <Outlet />
}

/**
 * Requires an active workspace membership, re-read from the database on
 * every session. Users without one (never invited, or deactivated) see an
 * explanation instead of workspace data.
 */
export function RequireWorkspace() {
  const { loading, error, workspace, refresh } = useWorkspace()
  const { signOut } = useAuth()
  if (loading) return <PageLoader />
  if (error) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-2">
        <ErrorState error={error} onRetry={() => refresh()} title="Couldn’t load your workspace" />
        <Button variant="ghost" size="sm" onClick={() => signOut()}>
          Sign out
        </Button>
      </div>
    )
  }
  if (!workspace) return <NoAccessPage />
  return (
    <ContentPanelProvider>
      <Suspense fallback={<PageLoader />}>
        <Outlet />
      </Suspense>
    </ContentPanelProvider>
  )
}

export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { role } = useWorkspace()
  if (!can(role, permission)) return <PermissionDenied />
  return <>{children}</>
}
