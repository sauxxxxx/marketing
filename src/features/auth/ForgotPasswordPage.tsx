import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { MailCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/common/Field'
import { Spinner } from '@/components/common/states'
import { appUrl, requireSupabase } from '@/lib/supabase'
import { emailSchema } from '@/lib/validation'
import { AuthLayout } from './AuthLayout'

const schema = z.object({ email: emailSchema })

export function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null)
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: '' } })

  const onSubmit = form.handleSubmit(async ({ email }) => {
    // The response is the same whether or not the account exists.
    await requireSupabase()
      .auth.resetPasswordForEmail(email, { redirectTo: `${appUrl}/reset-password` })
      .catch(() => undefined)
    setSentTo(email)
  })

  if (sentTo) {
    return (
      <AuthLayout title="Check your email" footer={<Link to="/login" className="font-medium text-primary hover:underline">Back to sign in</Link>}>
        <div className="flex gap-3 text-sm">
          <MailCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <p>
            If an account exists for <strong className="font-medium">{sentTo}</strong>, we’ve sent a link to reset the password. The link
            expires in one hour.
          </p>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Reset your password"
      description="Enter the email you use for Content Studio and we’ll send you a reset link."
      footer={<Link to="/login" className="font-medium text-primary hover:underline">Back to sign in</Link>}
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Email" error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" autoFocus {...form.register('email')} />
        </Field>
        <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
          {form.formState.isSubmitting && <Spinner className="[&_svg]:text-current" />}
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  )
}
