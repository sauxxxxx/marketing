import { useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import type { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Field } from '@/components/common/Field'
import { PageLoader, Spinner } from '@/components/common/states'
import { getRememberSession, requireSupabase, setRememberSession } from '@/lib/supabase'
import { friendlyError } from '@/lib/errors'
import { loginSchema } from '@/lib/validation'
import { AuthLayout, safeNext } from './AuthLayout'
import { PasswordInput } from './PasswordInput'
import { useAuth } from './AuthProvider'

type LoginValues = z.infer<typeof loginSchema>

export function useSetupStatus() {
  return useQuery({
    queryKey: ['setup-status'],
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('get_setup_status')
      if (error) throw error
      return data as { initialized: boolean }
    },
    staleTime: 60_000,
  })
}

export function LoginPage() {
  const { status } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const next = safeNext(params.get('next'))
  const setup = useSetupStatus()
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', remember: getRememberSession() },
  })

  if (status === 'signed_in') return <Navigate to={next} replace />
  if (setup.data && !setup.data.initialized) return <Navigate to="/setup" replace />
  if (setup.isPending) return <PageLoader />

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    setRememberSession(values.remember)
    const { error } = await requireSupabase().auth.signInWithPassword({ email: values.email, password: values.password })
    if (error) {
      setFormError(friendlyError(error, 'Sign-in failed. Please try again.'))
      return
    }
    navigate(next, { replace: true })
  })

  const { errors, isSubmitting } = form.formState

  return (
    <AuthLayout title="Sign in" description="Plan, produce and track Joyno Media content.">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError && (
          <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {formError}
          </div>
        )}
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" autoComplete="email" autoFocus {...form.register('email')} />
        </Field>
        <Field label="Password" error={errors.password?.message}>
          <PasswordInput autoComplete="current-password" {...form.register('password')} />
        </Field>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Checkbox
              id="remember"
              checked={form.watch('remember')}
              onCheckedChange={(v) => form.setValue('remember', v === true)}
            />
            <Label htmlFor="remember" className="text-sm font-normal">
              Keep me signed in
            </Label>
          </div>
          <Link to="/forgot-password" className="text-sm font-medium text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" disabled={isSubmitting} className="mt-1 w-full">
          {isSubmitting && <Spinner className="[&_svg]:text-current" />}
          Sign in
        </Button>
      </form>
    </AuthLayout>
  )
}
