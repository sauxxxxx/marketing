import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Field } from '@/components/common/Field'
import { Spinner } from '@/components/common/states'
import { useActiveWorkspace } from '@/features/workspace/WorkspaceProvider'
import { requireSupabase } from '@/lib/supabase'
import { friendlyError } from '@/lib/errors'
import { COMMON_TIMEZONES, PLATFORMS } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { LogoField } from './LogoField'
import { SettingsSection } from './SettingsSection'

const schema = z.object({
  name: z.string().trim().min(1, 'Enter a workspace name.').max(80),
  timezone: z.string().min(1),
  default_calendar_view: z.enum(['month', 'week', 'two_week']),
  default_platforms: z.array(z.string()),
  editors_can_duplicate_plans: z.boolean(),
  logo_path: z.string().nullable(),
})

type Values = z.infer<typeof schema>

export function WorkspaceSettings() {
  const { workspace, refresh } = useActiveWorkspace()
  const timezones = COMMON_TIMEZONES.includes(workspace.timezone) ? COMMON_TIMEZONES : [workspace.timezone, ...COMMON_TIMEZONES]
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: {
      name: workspace.name,
      timezone: workspace.timezone,
      default_calendar_view: workspace.default_calendar_view,
      default_platforms: workspace.default_platforms,
      editors_can_duplicate_plans: workspace.editors_can_duplicate_plans,
      logo_path: workspace.logo_path,
    },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    const { data, error } = await requireSupabase().from('workspaces').update(values).eq('id', workspace.id).select('id')
    if (error || !data?.length) {
      toast.error(friendlyError(error ?? { code: 'PGRST116' }))
      return
    }
    await refresh()
    toast.success('Workspace settings saved.')
  })

  const { errors, isDirty, isSubmitting } = form.formState

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <SettingsSection title="Workspace" description="Applies to everyone in this workspace.">
        <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <Field label="Workspace name" error={errors.name?.message} required>
            <Input {...form.register('name')} />
          </Field>
          <Field label="Timezone" hint="Used for “today”, overdue checks, publication times and exports.">
            <Controller
              control={form.control}
              name="timezone"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {timezones.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field label="Default calendar view">
            <Controller
              control={form.control}
              name="default_calendar_view"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">Month</SelectItem>
                    <SelectItem value="week">Week</SelectItem>
                    <SelectItem value="two_week">Two weeks</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Controller control={form.control} name="logo_path" render={({ field }) => <LogoField value={field.value} onChange={field.onChange} label="Workspace logo" />} />
          <div className="sm:col-span-2">
            <span className="text-xs font-medium text-foreground/80">Default platforms for new content</span>
            <Controller
              control={form.control}
              name="default_platforms"
              render={({ field }) => (
                <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Default platforms">
                  {PLATFORMS.map((p) => {
                    const selected = field.value.includes(p)
                    return (
                      <button
                        key={p}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => field.onChange(selected ? field.value.filter((v) => v !== p) : [...field.value, p])}
                        className={cn('h-7 rounded-full border px-2.5 text-xs', selected ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-accent')}
                      >
                        {p}
                      </button>
                    )
                  })}
                </div>
              )}
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Editing rules"
        description="Editors see and edit only content assigned to them, in the brands they're assigned to (Settings → Brands). Enforced by the database."
      >
        <div className="flex max-w-2xl flex-col gap-4">
          <Controller
            control={form.control}
            name="editors_can_duplicate_plans"
            render={({ field }) => (
              <div className="flex items-start gap-3">
                <Switch id="rule-duplicate" checked={field.value} onCheckedChange={field.onChange} />
                <div>
                  <Label htmlFor="rule-duplicate">Editors can duplicate monthly plans</Label>
                  <p className="text-xs text-muted-foreground">Administrators can always duplicate plans.</p>
                </div>
              </div>
            )}
          />
        </div>
      </SettingsSection>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={!isDirty || isSubmitting} onClick={() => form.reset()}>
          Discard
        </Button>
        <Button type="submit" disabled={!isDirty || isSubmitting}>
          {isSubmitting && <Spinner className="[&_svg]:text-current" />}
          Save settings
        </Button>
      </div>
    </form>
  )
}
