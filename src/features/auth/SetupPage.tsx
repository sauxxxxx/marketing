import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import type { z } from 'zod'
import { ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/common/Field'
import { PageLoader, Spinner } from '@/components/common/states'
import { requireSupabase, setRememberSession } from '@/lib/supabase'
import { EdgeFunctionError, invokeFunction } from '@/lib/functions'
import { setupSchema } from '@/lib/validation'
import { AuthLayout } from './AuthLayout'
import { PasswordInput } from './PasswordInput'
import { useSetupStatus } from './LoginPage'

type SetupValues = z.infer<typeof setupSchema>

/**
 * First-run setup for the first administrator only. The browser never
 * assigns a role: the bootstrap Edge Function validates the setup token and
 * provisions the account atomically, and refuses once setup is complete.
 */
export function SetupPage() {
  const setup = useSetupStatus()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<SetupValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: { fullName: '', email: '', workspaceName: 'Joyno Media', password: '', confirm: '', setupToken: '' },
  })

  if (setup.isPending) return <PageLoader />
  if (setup.data?.initialized) return <Navigate to="/login" replace />

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      await invokeFunction('bootstrap', {
        fullName: values.fullName,
        email: values.email,
        workspaceName: values.workspaceName,
        password: values.password,
        setupToken: values.setupToken,
      })
    } catch (error) {
      if (error instanceof EdgeFunctionError) {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          form.setError(field as keyof SetupValues, { message })
        }
        if (error.code === 'already_initialized') {
          await queryClient.invalidateQueries({ queryKey: ['setup-status'] })
        }
        setFormError(error.message)
      } else {
        setFormError('Setup failed. Please try again.')
      }
      return
    }
    await queryClient.invalidateQueries({ queryKey: ['setup-status'] })
    setRememberSession(true)
    const { error } = await requireSupabase().auth.signInWithPassword({ email: values.email, password: values.password })
    toast.success('Workspace created. Welcome to Content Studio.')
    navigate(error ? '/login' : '/', { replace: true })
  })

  const { errors, isSubmitting } = form.formState

  return (
    <AuthLayout
      title="Set up Content Studio"
      description={
        <div className="mt-3 flex gap-2 rounded-md border bg-accent/50 p-3 text-xs text-accent-foreground">
          <ShieldCheck className="size-4 shrink-0" aria-hidden />
          <span>
            This one-time step creates the <strong>first administrator</strong> and the workspace. It closes permanently once complete.
            Everyone else joins by invitation.
          </span>
        </div>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError && (
          <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {formError}
          </div>
        )}
        <Field label="Your full name" error={errors.fullName?.message} required>
          <Input autoComplete="name" autoFocus {...form.register('fullName')} />
        </Field>
        <Field label="Email" error={errors.email?.message} required>
          <Input type="email" autoComplete="email" {...form.register('email')} />
        </Field>
        <Field label="Workspace name" error={errors.workspaceName?.message} required>
          <Input {...form.register('workspaceName')} />
        </Field>
        <Field label="Password" hint="At least 12 characters, with upper- and lower-case letters and a number." error={errors.password?.message} required>
          <PasswordInput autoComplete="new-password" {...form.register('password')} />
        </Field>
        <Field label="Confirm password" error={errors.confirm?.message} required>
          <PasswordInput autoComplete="new-password" {...form.register('confirm')} />
        </Field>
        <Field
          label="Setup token"
          hint="The BOOTSTRAP_TOKEN secret set on the server by whoever deployed the app."
          error={errors.setupToken?.message}
          required
        >
          <PasswordInput autoComplete="off" {...form.register('setupToken')} />
        </Field>
        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting && <Spinner className="[&_svg]:text-current" />}
          Create workspace
        </Button>
      </form>
    </AuthLayout>
  )
}
