import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/features/workspace/WorkspaceProvider'
import { AuthLayout } from './AuthLayout'
import { useAuth } from './AuthProvider'

/** Signed in, but no active workspace membership (never invited, or deactivated). */
export function NoAccessPage() {
  const { user, signOut } = useAuth()
  const { memberships } = useWorkspace()
  const deactivated = memberships.some((m) => m.status === 'deactivated')

  return (
    <AuthLayout title={deactivated ? 'Your access has been deactivated' : 'No workspace access'}>
      <p className="text-sm text-muted-foreground">
        {deactivated
          ? 'An administrator has deactivated your workspace membership. Your past work is kept. Contact an administrator if you think this is a mistake.'
          : `You’re signed in as ${user?.email}, but this account isn’t a member of any workspace yet. Ask an administrator for an invitation, then open the link in the email.`}
      </p>
      <Button variant="outline" className="mt-6 w-full" onClick={() => signOut()}>
        Sign out
      </Button>
    </AuthLayout>
  )
}

export function ConfigErrorPage({ missing }: { missing: string[] }) {
  return (
    <AuthLayout title="Configuration required">
      <p className="text-sm text-muted-foreground">
        The app can’t connect to Supabase because these environment variables are missing or invalid:
      </p>
      <ul className="mt-3 list-inside list-disc text-sm font-medium">
        {missing.map((m) => (
          <li key={m}>
            <code>{m}</code>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted-foreground">
        Copy <code>.env.example</code> to <code>.env.local</code>, fill in the values from your Supabase project, and restart the dev
        server. See the README for details.
      </p>
    </AuthLayout>
  )
}
