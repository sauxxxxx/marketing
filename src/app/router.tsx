import { lazy, Suspense } from 'react'
import { createBrowserRouter, Link } from 'react-router-dom'
import { PageLoader } from '@/components/common/states'
import { Button } from '@/components/ui/button'
import { AppShell } from '@/components/layout/AppShell'
import { LoginPage } from '@/features/auth/LoginPage'
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage'
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage'
import { SetupPage } from '@/features/auth/SetupPage'
import { AcceptInvitePage } from '@/features/auth/AcceptInvitePage'
import { AuthLayout } from '@/features/auth/AuthLayout'
import { RequireAuth, RequirePermission, RequireWorkspace } from './guards'

const OverviewPage = lazy(() => import('@/features/overview/OverviewPage'))
const CalendarPage = lazy(() => import('@/features/calendar/CalendarPage'))
const BoardPage = lazy(() => import('@/features/board/BoardPage'))
const LibraryPage = lazy(() => import('@/features/library/LibraryPage'))
const PlansPage = lazy(() => import('@/features/plans/PlansPage'))
const PlanDetailPage = lazy(() => import('@/features/plans/PlanDetailPage'))
const PrintPage = lazy(() => import('@/features/export/PrintPage'))
const TeamPage = lazy(() => import('@/features/team/TeamPage'))
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'))

function NotFound() {
  return (
    <AuthLayout title="Page not found" description="The page you’re looking for doesn’t exist.">
      <Button asChild className="w-full">
        <Link to="/">Go to Overview</Link>
      </Button>
    </AuthLayout>
  )
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/setup', element: <SetupPage /> },
  { path: '/accept-invite', element: <AcceptInvitePage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <RequireWorkspace />,
        children: [
          {
            path: '/print',
            element: (
              <Suspense fallback={<PageLoader />}>
                <PrintPage />
              </Suspense>
            ),
          },
          {
            element: <AppShell />,
            children: [
              { index: true, element: <OverviewPage /> },
              { path: 'calendar', element: <CalendarPage /> },
              { path: 'board', element: <BoardPage /> },
              { path: 'library', element: <LibraryPage /> },
              { path: 'plans', element: <PlansPage /> },
              { path: 'plans/:planId', element: <PlanDetailPage /> },
              {
                path: 'team',
                element: (
                  <RequirePermission permission="team.manage">
                    <TeamPage />
                  </RequirePermission>
                ),
              },
              { path: 'settings', element: <SettingsPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFound /> },
])
