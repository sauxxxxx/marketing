import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { CircleCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/common/Field'
import { PageLoader, Spinner } from '@/components/common/states'
import { requireSupabase } from '@/lib/supabase'
import { friendlyError } from '@/lib/errors'
import { newPasswordSchema } from '@/lib/validation'
import { AuthLayout } from './AuthLayout'
import { PasswordInput } from './PasswordInput'
import { useAuth } from './AuthProvider'

type Values = z.infer<typeof newPasswordSchema>

/** Reads an error Supabase appends to the redirect, e.g. #error_code=otp_expired */
function readLinkError(): string | null {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const query = new URLSearchParams(window.location.search)
  const code = hash.get('error_code') ?? query.get('error_code')
  if (!code) return null
  return code === 'otp_expired'
    ? 'This reset link has expired or was already used.'
    : 'This reset link is not valid.'
}

export function ResetPasswordPage() {
  const { status, signOut } = useAuth()
  const [linkError] = useState(readLinkError)
  const [done, setDone] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<Values>({ resolver: zodResolver(newPasswordSchema), defaultValues: { password: '', confirm: '' } })

  if (done) {
    return (
      <AuthLayout title="Password updated">
        <div className="flex gap-3 text-sm">
          <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <p>Your password has been changed. Sign in with your new password.</p>
        </div>
        <Button asChild className="mt-6 w-full">
          <Link to="/login">Sign in</Link>
        </Button>
      </AuthLayout>
    )
  }

  if (status === 'loading') return <PageLoader />

  if (linkError || status !== 'signed_in') {
    return (
      <AuthLayout title="Link not valid">
        <p className="text-sm text-muted-foreground">
          {linkError ?? 'Open the reset link from your email in this browser, or request a new one.'}
        </p>
        <Button asChild className="mt-6 w-full">
          <Link to="/forgot-password">Request a new link</Link>
        </Button>
      </AuthLayout>
    )
  }

  const onSubmit = form.handleSubmit(async ({ password }) => {
    setFormError(null)
    const { error } = await requireSupabase().auth.updateUser({ password })
    if (error) {
      setFormError(friendlyError(error, 'Your password could not be updated.'))
      return
    }
    await signOut()
    setDone(true)
  })

  return (
    <AuthLayout title="Choose a new password" description="Use at least 12 characters with upper- and lower-case letters and a number.">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError && (
          <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {formError}
          </div>
        )}
        <Field label="New password" error={form.formState.errors.password?.message}>
          <PasswordInput autoComplete="new-password" autoFocus {...form.register('password')} />
        </Field>
        <Field label="Confirm new password" error={form.formState.errors.confirm?.message}>
          <PasswordInput autoComplete="new-password" {...form.register('confirm')} />
        </Field>
        <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
          {form.formState.isSubmitting && <Spinner className="[&_svg]:text-current" />}
          Update password
        </Button>
      </form>
    </AuthLayout>
  )
}
