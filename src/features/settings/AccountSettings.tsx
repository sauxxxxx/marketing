import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/common/Field'
import { Spinner } from '@/components/common/states'
import { PasswordInput } from '@/features/auth/PasswordInput'
import { useAuth } from '@/features/auth/AuthProvider'
import { useActiveWorkspace } from '@/features/workspace/WorkspaceProvider'
import { requireSupabase } from '@/lib/supabase'
import { friendlyError } from '@/lib/errors'
import { ROLE_LABEL } from '@/lib/permissions'
import { passwordSchema } from '@/lib/validation'
import { SettingsSection } from './SettingsSection'

const profileSchema = z.object({ fullName: z.string().trim().min(1, 'Enter your name.').max(120) })
const passwordChangeSchema = z
  .object({ current: z.string().min(1, 'Enter your current password.'), password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords don’t match.' })
  .refine((v) => v.password !== v.current, { path: ['password'], message: 'Choose a password different from your current one.' })

export function AccountSettings() {
  const { user, signOut } = useAuth()
  const { profile, role, workspace, refresh } = useActiveWorkspace()
  const [passwordError, setPasswordError] = useState<string | null>(null)

  const profileForm = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    values: { fullName: profile?.full_name ?? '' },
  })
  const passwordForm = useForm<z.infer<typeof passwordChangeSchema>>({
    resolver: zodResolver(passwordChangeSchema),
    defaultValues: { current: '', password: '', confirm: '' },
  })

  const saveProfile = profileForm.handleSubmit(async ({ fullName }) => {
    const client = requireSupabase()
    const { data, error } = await client.from('profiles').update({ full_name: fullName }).eq('id', user!.id).select('id')
    if (error || !data?.length) {
      toast.error(friendlyError(error ?? { code: 'PGRST116' }))
      return
    }
    await client.auth.updateUser({ data: { full_name: fullName } })
    await refresh()
    toast.success('Profile updated.')
  })

  const changePassword = passwordForm.handleSubmit(async ({ current, password }) => {
    setPasswordError(null)
    const client = requireSupabase()
    // Re-verify the current password before allowing a change.
    const { error: verifyError } = await client.auth.signInWithPassword({ email: user!.email!, password: current })
    if (verifyError) {
      setPasswordError('Your current password is incorrect.')
      return
    }
    const { error } = await client.auth.updateUser({ password })
    if (error) {
      setPasswordError(friendlyError(error, 'Your password could not be changed.'))
      return
    }
    passwordForm.reset()
    toast.success('Password changed.')
  })

  return (
    <div className="flex flex-col gap-4">
      <SettingsSection title="Profile" description="Your name is shown on assignments and activity history.">
        <form onSubmit={saveProfile} noValidate className="grid max-w-lg gap-3">
          <Field label="Full name" error={profileForm.formState.errors.fullName?.message} required>
            <Input autoComplete="name" {...profileForm.register('fullName')} />
          </Field>
          <Field label="Email" hint="Contact an administrator to change the email on your account.">
            <Input value={user?.email ?? ''} readOnly disabled />
          </Field>
          <p className="text-sm text-muted-foreground">
            {ROLE_LABEL[role]} in <strong className="font-medium text-foreground">{workspace.name}</strong>
          </p>
          <div>
            <Button type="submit" size="sm" disabled={profileForm.formState.isSubmitting || !profileForm.formState.isDirty}>
              {profileForm.formState.isSubmitting && <Spinner className="[&_svg]:text-current" />}
              Save profile
            </Button>
          </div>
        </form>
      </SettingsSection>

      <SettingsSection title="Password" description="Use at least 12 characters with upper- and lower-case letters and a number.">
        <form onSubmit={changePassword} noValidate className="grid max-w-lg gap-3">
          {passwordError && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {passwordError}
            </p>
          )}
          <Field label="Current password" error={passwordForm.formState.errors.current?.message} required>
            <PasswordInput autoComplete="current-password" {...passwordForm.register('current')} />
          </Field>
          <Field label="New password" error={passwordForm.formState.errors.password?.message} required>
            <PasswordInput autoComplete="new-password" {...passwordForm.register('password')} />
          </Field>
          <Field label="Confirm new password" error={passwordForm.formState.errors.confirm?.message} required>
            <PasswordInput autoComplete="new-password" {...passwordForm.register('confirm')} />
          </Field>
          <div>
            <Button type="submit" size="sm" disabled={passwordForm.formState.isSubmitting}>
              {passwordForm.formState.isSubmitting && <Spinner className="[&_svg]:text-current" />}
              Change password
            </Button>
          </div>
        </form>
      </SettingsSection>

      <SettingsSection title="Session">
        <Button variant="outline" size="sm" onClick={() => signOut()}>
          Sign out of this device
        </Button>
      </SettingsSection>
    </div>
  )
}
