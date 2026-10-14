import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/common/Field'
import { ErrorState, PageLoader, Spinner } from '@/components/common/states'
import { requireSupabase } from '@/lib/supabase'
import { friendlyError } from '@/lib/errors'
import { ROLE_LABEL } from '@/lib/permissions'
import { passwordSchema } from '@/lib/validation'
import { useWorkspace } from '@/features/workspace/WorkspaceProvider'
import { AuthLayout } from './AuthLayout'
import { PasswordInput } from './PasswordInput'
import { useAuth } from './AuthProvider'

const accountSchema = z
  .object({ fullName: z.string().trim().min(1, 'Enter your full name.').max(120), password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords don’t match.' })

const TOKEN_PATTERN = /^[0-9a-f]{64}$/

export function AcceptInvitePage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const needsAccountSetup = params.get('setup') === '1'
  const { status, user, signOut } = useAuth()
  const { refresh, switchWorkspace } = useWorkspace()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  const invitation = useQuery({
    queryKey: ['invitation', token, user?.id],
    enabled: status === 'signed_in' && TOKEN_PATTERN.test(token),
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('get_invitation', { p_token: token })
      if (error) throw error
      return data?.[0] ?? null
    },
  })

  const form = useForm<z.infer<typeof accountSchema>>({
    resolver: zodResolver(accountSchema),
    defaultValues: { fullName: (user?.user_metadata?.full_name as string | undefined) ?? '', password: '', confirm: '' },
  })

  const accept = useMutation({
    mutationFn: async (account?: z.infer<typeof accountSchema>) => {
      const client = requireSupabase()
      if (account) {
        const { error: pwError } = await client.auth.updateUser({ password: account.password, data: { full_name: account.fullName } })
        if (pwError) throw pwError
        await client.from('profiles').update({ full_name: account.fullName }).eq('id', user!.id)
      }
      const { data, error } = await client.rpc('accept_invitation', { p_token: token })
      if (error) throw error
      return data as string
    },
    onSuccess: async (workspaceId) => {
      switchWorkspace(workspaceId)
      await refresh()
      toast.success('You’ve joined the workspace.')
      navigate('/', { replace: true })
    },
    onError: (e) => setError(friendlyError(e, 'The invitation could not be accepted.')),
  })

  if (!TOKEN_PATTERN.test(token)) {
    return (
      <AuthLayout title="Invitation link not valid">
        <p className="text-sm text-muted-foreground">Check that you opened the full link from your invitation email.</p>
      </AuthLayout>
    )
  }

  if (status === 'loading') return <PageLoader />

  if (status === 'signed_out') {
    const next = `/accept-invite?token=${token}`
    return (
      <AuthLayout title="Accept your invitation" description="Sign in with the email address the invitation was sent to.">
        <Button asChild className="w-full">
          <Link to={`/login?next=${encodeURIComponent(next)}`}>Sign in to continue</Link>
        </Button>
        <p className="mt-4 text-xs text-muted-foreground">
          New to Content Studio? Open the link in your invitation email — it sets up your account automatically.
        </p>
      </AuthLayout>
    )
  }

  if (invitation.isPending) return <PageLoader label="Checking invitation…" />
  if (invitation.isError) {
    return (
      <AuthLayout title="Accept your invitation">
        <ErrorState error={invitation.error} onRetry={() => invitation.refetch()} />
      </AuthLayout>
    )
  }

  const state = invitation.data?.state ?? 'invalid'
  if (state !== 'valid') {
    const messages: Record<string, string> = {
      invalid: 'This invitation link is not valid.',
      expired: 'This invitation has expired. Ask an administrator to send a new one.',
      revoked: 'This invitation was revoked by an administrator.',
      accepted: 'This invitation has already been used.',
      email_mismatch: `This invitation was sent to a different email address. You’re signed in as ${user?.email}.`,
    }
    return (
      <AuthLayout title="Can’t accept this invitation">
        <p className="text-sm text-muted-foreground">{messages[state] ?? messages.invalid}</p>
        <div className="mt-6 flex gap-2">
          {state === 'accepted' && (
            <Button asChild className="flex-1">
              <Link to="/">Open Content Studio</Link>
            </Button>
          )}
          <Button variant="outline" className="flex-1" onClick={() => signOut()}>
            Sign out
          </Button>
        </div>
      </AuthLayout>
    )
  }

  const inv = invitation.data!
  const description = (
    <>
      You’ve been invited to <strong className="font-medium text-foreground">{inv.workspace_name}</strong> as{' '}
      <strong className="font-medium text-foreground">{inv.role ? ROLE_LABEL[inv.role] : 'a member'}</strong>.
    </>
  )

  if (needsAccountSetup) {
    const onSubmit = form.handleSubmit((values) => {
      setError(null)
      accept.mutate(values)
    })
    return (
      <AuthLayout title="Set up your account" description={description}>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {error && (
            <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          <Field label="Email">
            <Input value={user?.email ?? ''} readOnly disabled />
          </Field>
          <Field label="Full name" error={form.formState.errors.fullName?.message} required>
            <Input autoComplete="name" autoFocus {...form.register('fullName')} />
          </Field>
          <Field label="Choose a password" hint="At least 12 characters, with upper- and lower-case letters and a number." error={form.formState.errors.password?.message} required>
            <PasswordInput autoComplete="new-password" {...form.register('password')} />
          </Field>
          <Field label="Confirm password" error={form.formState.errors.confirm?.message} required>
            <PasswordInput autoComplete="new-password" {...form.register('confirm')} />
          </Field>
          <Button type="submit" disabled={accept.isPending} className="w-full">
            {accept.isPending && <Spinner className="[&_svg]:text-current" />}
            Create account and join
          </Button>
        </form>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Join workspace" description={description}>
      {error && (
        <div role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <p className="text-sm text-muted-foreground">Signed in as {user?.email}.</p>
      <Button className="mt-6 w-full" disabled={accept.isPending} onClick={() => accept.mutate(undefined)}>
        {accept.isPending && <Spinner className="[&_svg]:text-current" />}
        Accept invitation
      </Button>
    </AuthLayout>
  )
}
