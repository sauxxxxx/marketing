import { useEffect, useMemo, useState } from 'react'
import { useFieldArray, useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Archive, ArchiveRestore, Copy, MoreHorizontal, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field } from '@/components/common/Field'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState, ErrorState, PageLoader, Spinner } from '@/components/common/states'
import { useActiveWorkspace } from '@/features/workspace/WorkspaceProvider'
import { useLookups } from '@/hooks/useWorkspaceData'
import {
  useContentItem,
  useCreateContent,
  useDeleteContentPermanently,
  useUpdateContent,
} from '@/hooks/useContent'
import { can, canEditContent } from '@/lib/permissions'
import { CONTENT_STATUSES, STATUS_LABEL, nextStatuses, isReopen } from '@/lib/status'
import { PLATFORMS } from '@/lib/constants'
import { formatDate, formatTimestamp, timestampToZonedInput, zonedInputToTimestamp } from '@/lib/dates'
import { friendlyError } from '@/lib/errors'
import { contentFormSchema, parseHashtags, type ContentFormInput, type ContentFormValues } from '@/lib/validation'
import type { ContentItem, ContentUpdate, Workspace } from '@/types/database'
import { cn } from '@/lib/utils'
import { StatusBadge } from './badges'
import { AssetsPanel } from './AssetsPanel'
import { ActivityList } from './ActivityList'
import type { ContentDefaults } from './ContentPanel'

const NONE = '__none'

interface EditorProps {
  itemId: string | null
  defaults?: ContentDefaults
  onDirtyChange: (dirty: boolean) => void
  onClose: () => void
  onCreated: (id: string) => void
  onReuse: (defaults: ContentDefaults) => void
}

export function ContentEditor(props: EditorProps) {
  const lookups = useLookups()
  const item = useContentItem(props.itemId)

  if (lookups.loading || (props.itemId && item.isPending)) return <PageLoader />
  if (lookups.error) return <ErrorState error={lookups.error} onRetry={() => lookups.refetch()} />
  if (props.itemId && item.isError) return <ErrorState error={item.error} onRetry={() => item.refetch()} />
  if (props.itemId && !item.data) {
    return <EmptyState title="This content item no longer exists" description="It may have been deleted." className="flex-1" />
  }
  return <EditorBody {...props} item={item.data ?? null} />
}

function toFormValues(source: ContentItem | ContentDefaults, workspace: Workspace, timezone: string): ContentFormInput {
  const s = source as Partial<ContentItem>
  return {
    title: s.title ?? '',
    brand_id: s.brand_id ?? '',
    platforms: (s.platforms ?? workspace.default_platforms) as ContentFormInput['platforms'],
    format_id: s.format_id ?? '',
    pillar_id: s.pillar_id ?? NONE,
    scheduled_date: s.scheduled_date ?? '',
    scheduled_time: s.scheduled_time?.slice(0, 5) ?? '',
    caption: s.caption ?? '',
    hashtags: (s.hashtags ?? []).join(' '),
    call_to_action: s.call_to_action ?? '',
    purpose: s.purpose ?? '',
    target_audience: s.target_audience ?? '',
    creative_brief: s.creative_brief ?? '',
    reference_urls: (s.reference_urls ?? []).map((value) => ({ value })),
    assigned_to: s.assigned_to ?? NONE,
    deadline_date: s.deadline_date ?? '',
    status: s.status ?? 'planned',
    internal_notes: s.internal_notes ?? '',
    published_at: timestampToZonedInput(s.published_at, timezone),
    published_url: s.published_url ?? '',
    publication_notes: s.publication_notes ?? '',
  }
}

function toPayload(values: ContentFormValues, timezone: string): ContentUpdate {
  return {
    title: values.title,
    brand_id: values.brand_id,
    platforms: values.platforms,
    format_id: values.format_id,
    pillar_id: values.pillar_id === NONE ? null : values.pillar_id,
    scheduled_date: values.scheduled_date || null,
    scheduled_time: values.scheduled_date && values.scheduled_time ? values.scheduled_time : null,
    caption: values.caption,
    hashtags: parseHashtags(values.hashtags),
    call_to_action: values.call_to_action,
    purpose: values.purpose,
    target_audience: values.target_audience,
    creative_brief: values.creative_brief,
    reference_urls: values.reference_urls.map((r) => r.value.trim()),
    assigned_to: values.assigned_to === NONE ? null : values.assigned_to,
    deadline_date: values.deadline_date || null,
    status: values.status,
    internal_notes: values.internal_notes,
    published_at: values.published_at ? zonedInputToTimestamp(values.published_at, timezone) : null,
    published_url: values.published_url || null,
    publication_notes: values.publication_notes,
  }
}

/**
 * For updates, send only what the user changed. Untouched fields must not be
 * rewritten (e.g. published_at would lose its seconds through the
 * minute-precision input and log a spurious edit).
 */
export function pickChanged(payload: ContentUpdate, dirty: Partial<Record<keyof ContentFormInput, unknown>>): ContentUpdate {
  const isDirty = (value: unknown): boolean =>
    Array.isArray(value) ? value.some(isDirty) : value !== null && typeof value === 'object' ? Object.values(value).some(isDirty) : !!value
  const out: ContentUpdate = {}
  for (const key of Object.keys(payload) as (keyof ContentUpdate)[]) {
    const formKey = key as keyof ContentFormInput
    const changed = isDirty(dirty[formKey]) || (key === 'scheduled_time' && isDirty(dirty.scheduled_date))
    if (changed) (out as Record<string, unknown>)[key] = payload[key]
  }
  return out
}

function EditorBody({ item, defaults, onDirtyChange, onClose, onCreated, onReuse }: EditorProps & { item: ContentItem | null }) {
  const { workspace, role, userId, timezone } = useActiveWorkspace()
  const lookups = useLookups()
  const createMutation = useCreateContent()
  const updateMutation = useUpdateContent()
  const deleteMutation = useDeleteContentPermanently()
  const [confirm, setConfirm] = useState<null | 'delete' | 'archive'>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const isEditor = role === 'editor'
  const noBrands = !item && isEditor && lookups.myBrandIds.size === 0
  const editable = item ? canEditContent(role, workspace, item, userId) && !item.deleted_at : can(role, 'content.create') && !noBrands
  const initial = useMemo(() => {
    const values = toFormValues(item ?? defaults ?? {}, workspace, timezone)
    if (item) return values
    // New content is owned by its creator; editors may only use their own brands.
    return {
      ...values,
      assigned_to: (isEditor ? null : defaults?.assigned_to) ?? userId,
      brand_id: isEditor && values.brand_id && !lookups.myBrandIds.has(values.brand_id) ? '' : values.brand_id,
    }
    // lookups are loaded before the editor renders; recompute only for a new item/defaults.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, defaults, workspace, timezone, userId, isEditor])

  const form = useForm<ContentFormInput, unknown, ContentFormValues>({
    resolver: zodResolver(contentFormSchema),
    defaultValues: initial,
  })
  const references = useFieldArray({ control: form.control, name: 'reference_urls' })
  const { errors, isDirty, isSubmitting } = form.formState

  useEffect(() => {
    onDirtyChange(isDirty)
  }, [isDirty, onDirtyChange])

  // Pick sensible defaults for brand/format when creating.
  useEffect(() => {
    if (item) return
    const activeBrands = lookups.brands.filter((b) => b.is_active && lookups.myBrandIds.has(b.id))
    if (!form.getValues('brand_id') && activeBrands.length === 1) form.setValue('brand_id', activeBrands[0].id)
    const firstFormat = lookups.formats.find((f) => f.is_active)
    if (!form.getValues('format_id') && firstFormat) form.setValue('format_id', firstFormat.id)
  }, [item, lookups.brands, lookups.formats, lookups.myBrandIds, form])

  const canAssign = can(role, 'content.assign')
  const statusOptions = item ? [item.status, ...nextStatuses(item.status, role)] : [...CONTENT_STATUSES]
  const watchedBrand = form.watch('brand_id')
  // Owners: active administrators, plus editors assigned to the selected brand.
  const assignable = lookups.members.filter(
    (m) =>
      m.status === 'active' &&
      (m.role === 'admin' || (m.role === 'editor' && !!watchedBrand && (lookups.editorsByBrand.get(watchedBrand) ?? []).includes(m.user_id))),
  )

  // If the brand changes to one the chosen editor doesn't work on, fall back to the admin.
  useEffect(() => {
    if (!canAssign || !userId) return
    const owner = form.getValues('assigned_to')
    if (owner && owner !== userId && !assignable.some((m) => m.user_id === owner) && owner !== item?.assigned_to) {
      form.setValue('assigned_to', userId, { shouldDirty: true })
    }
  }, [watchedBrand, canAssign, userId, assignable, form, item?.assigned_to])
  const watchedStatus = form.watch('status')
  const caption = form.watch('caption') ?? ''

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    const payload = toPayload(values, timezone)
    try {
      if (item) {
        const patch = pickChanged(payload, form.formState.dirtyFields)
        // Array fields are compared directly so removals are never missed.
        for (const key of ['platforms', 'hashtags', 'reference_urls'] as const) {
          if (JSON.stringify(payload[key]) !== JSON.stringify(item[key])) patch[key] = payload[key]
        }
        if (Object.keys(patch).length === 0) return
        const saved = await updateMutation.mutateAsync({ id: item.id, patch })
        form.reset(toFormValues(saved, workspace, timezone))
        toast.success('Changes saved.')
      } else {
        const created = await createMutation.mutateAsync({
          ...payload,
          brand_id: values.brand_id,
          format_id: values.format_id,
          title: values.title,
          monthly_plan_id: defaults?.monthly_plan_id ?? null,
          source_item_id: defaults?.source_item_id ?? null,
        })
        form.reset(toFormValues(created, workspace, timezone))
        toast.success('Content created.')
        onCreated(created.id)
      }
    } catch (error) {
      setFormError(friendlyError(error, 'The content could not be saved.'))
    }
  })

  const archive = async (restore = false) => {
    if (!item) return
    try {
      await updateMutation.mutateAsync({ id: item.id, patch: { deleted_at: restore ? null : new Date().toISOString() } })
      if (restore) {
        toast.success('Content restored.')
      } else {
        toast.success('Content archived.', {
          action: { label: 'Undo', onClick: () => updateMutation.mutate({ id: item.id, patch: { deleted_at: null } }) },
        })
        onClose()
      }
    } catch (error) {
      toast.error(friendlyError(error))
    }
  }

  const reuse = () => {
    if (!item) return
    onReuse({
      title: item.title,
      brand_id: item.brand_id,
      platforms: item.platforms,
      format_id: item.format_id,
      pillar_id: item.pillar_id,
      caption: item.caption,
      hashtags: item.hashtags,
      call_to_action: item.call_to_action,
      purpose: item.purpose,
      target_audience: item.target_audience,
      creative_brief: item.creative_brief,
      reference_urls: item.reference_urls,
      status: 'planned',
      source_item_id: item.id,
    })
  }

  const brandOptions = lookups.brands.filter((b) => (b.is_active && lookups.myBrandIds.has(b.id)) || b.id === item?.brand_id)
  const formatOptions = lookups.formats.filter((f) => f.is_active || f.id === item?.format_id)
  const pillarOptions = lookups.pillars.filter((p) => p.is_active || p.id === item?.pillar_id)

  return (
    <>
      <div className="flex items-start justify-between gap-3 border-b px-5 py-3.5">
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground">
            {item ? lookups.brandById.get(item.brand_id)?.name : 'New content'}
            {item?.scheduled_date && ` · ${formatDate(item.scheduled_date)}`}
            {item && !item.scheduled_date && ' · Unscheduled idea'}
          </div>
          <h2 className="mt-0.5 line-clamp-2 text-base font-semibold leading-snug">{form.watch('title') || 'Untitled content'}</h2>
          {item && (
            <div className="mt-1.5 flex items-center gap-2">
              <StatusBadge status={item.status} />
              {item.is_demo && <span className="rounded-sm bg-amber-100 px-1.5 text-[11px] font-medium text-amber-900">Demo data</span>}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {item && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {can(role, 'content.reuse') && (
                  <DropdownMenuItem onSelect={reuse}>
                    <Copy /> Reuse as new content
                  </DropdownMenuItem>
                )}
                {canEditContent(role, workspace, item, userId) &&
                  (item.deleted_at ? (
                    <DropdownMenuItem onSelect={() => archive(true)}>
                      <ArchiveRestore /> Restore
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={() => setConfirm('archive')}>
                      <Archive /> Archive
                    </DropdownMenuItem>
                  ))}
                {can(role, 'content.deletePermanently') && item.deleted_at && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setConfirm('delete')}>
                      <Trash2 /> Delete permanently
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
            <X />
          </Button>
        </div>
      </div>

      {item?.deleted_at && (
        <div className="flex items-center justify-between gap-2 border-b bg-amber-50 px-5 py-2 text-xs text-amber-900">
          <span>This item is archived. It is hidden from calendars, the board and summaries.</span>
          {canEditContent(role, workspace, item, userId) && (
            <Button size="xs" variant="outline" onClick={() => archive(true)}>
              Restore
            </Button>
          )}
        </div>
      )}
      {item && !editable && !item.deleted_at && (
        <div className="border-b bg-muted px-5 py-2 text-xs text-muted-foreground">
          {role === 'viewer' ? 'You have view-only access.' : 'You can view this item but not edit it under the workspace’s editing rules.'}
        </div>
      )}

      {noBrands && (
        <div role="alert" className="border-b bg-amber-50 px-5 py-2 text-xs text-amber-900">
          You aren’t assigned to any brand yet, so you can’t create content. Ask an administrator to add you to a brand in Settings → Brands.
        </div>
      )}

      <Tabs defaultValue="content" className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList className="mx-5 mt-3 w-fit">
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="files" disabled={!item}>
            Files
          </TabsTrigger>
          <TabsTrigger value="activity" disabled={!item}>
            Activity
          </TabsTrigger>
        </TabsList>

        <TabsContent value="content" className="flex min-h-0 flex-1 flex-col">
          <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
            <fieldset disabled={!editable || isSubmitting} className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
              {formError && (
                <div role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {formError}
                </div>
              )}

              <Section title="Basics">
                <Field label="Title / topic" error={errors.title?.message} required className="sm:col-span-2">
                  <Input {...form.register('title')} placeholder="e.g. 5 signs your brand needs a refresh" />
                </Field>
                <Field label="Brand" error={errors.brand_id?.message} required>
                  <Controller
                    control={form.control}
                    name="brand_id"
                    render={({ field }) => (
                      <Select value={field.value || undefined} onValueChange={field.onChange} disabled={!editable}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Choose a brand" />
                        </SelectTrigger>
                        <SelectContent>
                          {brandOptions.map((b) => (
                            <SelectItem key={b.id} value={b.id}>
                              {b.name}
                              {!b.is_active && ' (inactive)'}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
                <Field label="Format" error={errors.format_id?.message} required>
                  <Controller
                    control={form.control}
                    name="format_id"
                    render={({ field }) => (
                      <Select value={field.value || undefined} onValueChange={field.onChange} disabled={!editable}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Choose a format" />
                        </SelectTrigger>
                        <SelectContent>
                          {formatOptions.map((f) => (
                            <SelectItem key={f.id} value={f.id}>
                              <span className="size-2.5 rounded-[2px]" style={{ backgroundColor: f.color }} aria-hidden />
                              {f.name}
                              {!f.is_active && ' (inactive)'}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
                <Field label="Content pillar" error={errors.pillar_id?.message}>
                  <Controller
                    control={form.control}
                    name="pillar_id"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange} disabled={!editable}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>No pillar</SelectItem>
                          {pillarOptions.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              <span className="size-2.5 rounded-full border-2" style={{ borderColor: p.color }} aria-hidden />
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
                <div className="grid grid-cols-[1fr_7.5rem] gap-3">
                  <Field label="Publish date" hint={`Times are in ${timezone}. Leave empty for an unscheduled idea.`} error={errors.scheduled_date?.message}>
                    <Input type="date" {...form.register('scheduled_date')} />
                  </Field>
                  <Field label="Time" error={errors.scheduled_time?.message}>
                    <Input type="time" {...form.register('scheduled_time')} />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-xs font-medium text-foreground/80">Platforms</span>
                  <Controller
                    control={form.control}
                    name="platforms"
                    render={({ field }) => (
                      <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Platforms">
                        {PLATFORMS.map((p) => {
                          const selected = field.value.includes(p)
                          return (
                            <button
                              key={p}
                              type="button"
                              aria-pressed={selected}
                              disabled={!editable}
                              onClick={() => field.onChange(selected ? field.value.filter((v) => v !== p) : [...field.value, p])}
                              className={cn(
                                'h-7 rounded-full border px-2.5 text-xs transition-colors disabled:opacity-60',
                                selected ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-accent',
                              )}
                            >
                              {p}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  />
                </div>
              </Section>

              <Section title="Copywriting" description="Captions can be added later — the post can be planned first.">
                <Field
                  label="Caption"
                  error={errors.caption?.message}
                  hint={`${caption.length.toLocaleString()} characters${caption.length > 2200 ? ' — over Instagram’s 2,200 limit' : ''}`}
                  className="sm:col-span-2"
                >
                  <Textarea rows={7} {...form.register('caption')} />
                </Field>
                <Field label="Hashtags" hint="Separate with spaces or commas; # is added automatically." error={errors.hashtags?.message}>
                  <Input {...form.register('hashtags')} placeholder="#JoynoMedia #ContentTips" />
                </Field>
                <Field label="Call to action" error={errors.call_to_action?.message}>
                  <Input {...form.register('call_to_action')} placeholder="e.g. Book a free audit" />
                </Field>
              </Section>

              <Section title="Strategy">
                <Field label="Purpose / theme" error={errors.purpose?.message}>
                  <Input {...form.register('purpose')} />
                </Field>
                <Field label="Target audience" error={errors.target_audience?.message}>
                  <Input {...form.register('target_audience')} />
                </Field>
                <Field label="Creative brief" error={errors.creative_brief?.message} className="sm:col-span-2">
                  <Textarea rows={4} {...form.register('creative_brief')} />
                </Field>
                <div className="sm:col-span-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground/80">Reference URLs</span>
                    {editable && (
                      <Button type="button" variant="ghost" size="xs" onClick={() => references.append({ value: '' })} disabled={references.fields.length >= 20}>
                        <Plus /> Add link
                      </Button>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-col gap-2">
                    {references.fields.length === 0 && <p className="text-xs text-muted-foreground">No references yet.</p>}
                    {references.fields.map((field, index) => (
                      <div key={field.id} className="flex items-start gap-2">
                        <div className="flex-1">
                          <Input
                            {...form.register(`reference_urls.${index}.value`)}
                            placeholder="https://"
                            aria-label={`Reference URL ${index + 1}`}
                            aria-invalid={!!errors.reference_urls?.[index]?.value}
                          />
                          {errors.reference_urls?.[index]?.value && (
                            <p className="mt-1 text-xs text-destructive" role="alert">
                              {errors.reference_urls[index]?.value?.message}
                            </p>
                          )}
                        </div>
                        {editable && (
                          <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove link" onClick={() => references.remove(index)}>
                            <X />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </Section>

              <Section title="Production">
                <Field
                  label="Status"
                  error={errors.status?.message}
                  hint={item && isReopen(item.status, watchedStatus) ? 'This reopens the item and is recorded in the activity history.' : undefined}
                >
                  <Controller
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange} disabled={!editable}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {statusOptions.map((s) => (
                            <SelectItem key={s} value={s}>
                              {STATUS_LABEL[s]}
                              {item && isReopen(item.status, s) && ' (reopen)'}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
                <Field
                  label="Assigned owner"
                  error={errors.assigned_to?.message}
                  hint={
                    editable && !canAssign
                      ? 'Content you create is assigned to you. Only administrators can reassign it.'
                      : canAssign
                        ? 'Administrators or editors of this brand.'
                        : undefined
                  }
                >
                  <Controller
                    control={form.control}
                    name="assigned_to"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange} disabled={!editable || !canAssign}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {assignable.map((m) => (
                            <SelectItem key={m.user_id} value={m.user_id}>
                              {m.profile?.full_name || m.profile?.email}
                              {m.user_id === userId ? ' (you)' : m.role === 'admin' ? ' · Admin' : ''}
                            </SelectItem>
                          ))}
                          {field.value && field.value !== NONE && !assignable.some((m) => m.user_id === field.value) && (
                            <SelectItem value={field.value} disabled>
                              {lookups.personName(field.value)}
                              {field.value === userId ? ' (you)' : ' (not on this brand)'}
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
                <Field label="Production deadline" error={errors.deadline_date?.message}>
                  <Input type="date" {...form.register('deadline_date')} />
                </Field>
                <div className="text-xs text-muted-foreground sm:pt-6">
                  {item?.approved_at ? (
                    <>
                      Approved by <strong className="font-medium text-foreground">{lookups.personName(item.approved_by) ?? 'system'}</strong> on{' '}
                      {formatTimestamp(item.approved_at, timezone)}
                    </>
                  ) : (
                    'Not approved yet.'
                  )}
                </div>
                <Field label="Internal notes" hint="Visible to the team only. Included in PDF exports only when selected." error={errors.internal_notes?.message} className="sm:col-span-2">
                  <Textarea rows={3} {...form.register('internal_notes')} />
                </Field>
              </Section>

              <Section title="Publishing" description="Approval and publication are tracked separately.">
                <Field label="Published at" hint={`Actual publication time (${timezone}). Filled in automatically when marked Published.`} error={errors.published_at?.message}>
                  <Input type="datetime-local" {...form.register('published_at')} />
                </Field>
                <Field label="Live post URL" error={errors.published_url?.message}>
                  <Input type="url" {...form.register('published_url')} placeholder="https://" />
                </Field>
                <Field label="Publication notes" error={errors.publication_notes?.message} className="sm:col-span-2">
                  <Textarea rows={2} {...form.register('publication_notes')} />
                </Field>
              </Section>
            </fieldset>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-card px-5 py-3">
              <p className="text-xs text-muted-foreground">
                {item
                  ? `Updated ${formatTimestamp(item.updated_at, timezone)}${item.updated_by ? ` by ${lookups.personName(item.updated_by)}` : ''}`
                  : 'Not saved yet'}
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={onClose}>
                  {isDirty ? 'Cancel' : 'Close'}
                </Button>
                {editable && (
                  <Button type="submit" disabled={isSubmitting || (!!item && !isDirty)}>
                    {isSubmitting && <Spinner className="[&_svg]:text-current" />}
                    {item ? 'Save changes' : 'Create content'}
                  </Button>
                )}
              </div>
            </div>
          </form>
        </TabsContent>

        <TabsContent value="files" className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {item && <AssetsPanel item={item} canEdit={editable} />}
        </TabsContent>
        <TabsContent value="activity" className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {item && <ActivityList contentId={item.id} />}
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={confirm === 'archive'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Archive this content?"
        description="It will be hidden from calendars, the board and summaries. You can restore it from the Content Library."
        confirmLabel="Archive"
        onConfirm={() => archive(false)}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Delete permanently?"
        description="This removes the content item and its attachments records. Activity history keeps the title. This cannot be undone."
        confirmLabel="Delete permanently"
        destructive
        onConfirm={async () => {
          try {
            await deleteMutation.mutateAsync(item!.id)
            toast.success('Content deleted.')
            onClose()
          } catch (error) {
            toast.error(friendlyError(error))
          }
        }}
      />
    </>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="border-b py-5 last:border-b-0">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  )
}
