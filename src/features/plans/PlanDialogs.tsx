import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowRight, CalendarHeart, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Field } from '@/components/common/Field'
import { Spinner } from '@/components/common/states'
import { useActiveWorkspace } from '@/features/workspace/WorkspaceProvider'
import { useLookups, usePlans, wsKey } from '@/hooks/useWorkspaceData'
import { contentKey } from '@/hooks/useContent'
import { friendlyError } from '@/lib/errors'
import { formatDate, formatMonth, monthKey, shiftMonth } from '@/lib/dates'
import type { DuplicatePreviewRow, MonthlyPlan } from '@/types/database'
import { cn } from '@/lib/utils'
import { runDuplicate, useSavePlan, type DuplicateInput } from './usePlans'

export function CreatePlanDialog({ open, onOpenChange, defaultBrandId, defaultMonth }: { open: boolean; onOpenChange: (o: boolean) => void; defaultBrandId?: string; defaultMonth?: string }) {
  const { today } = useActiveWorkspace()
  const lookups = useLookups()
  const plans = usePlans()
  const save = useSavePlan()
  const navigate = useNavigate()
  // Editors can only plan for brands they're assigned to.
  const activeBrands = lookups.brands.filter((b) => b.is_active && lookups.myBrandIds.has(b.id))
  const [brandId, setBrandId] = useState('')
  const [period, setPeriod] = useState(today.slice(0, 7))
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setBrandId(defaultBrandId ?? (activeBrands.length === 1 ? activeBrands[0].id : ''))
    setPeriod(defaultMonth ?? today.slice(0, 7))
    setTitleTouched(false)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const [year, month] = period.split('-').map(Number)
  const brand = lookups.brandById.get(brandId)
  useEffect(() => {
    if (!titleTouched && brand && year && month) setTitle(`${brand.name} — ${formatMonth(year, month)}`)
  }, [brand, year, month, titleTouched])

  const duplicate = (plans.data ?? []).find((p) => p.brand_id === brandId && p.year === year && p.month === month)

  const submit = async () => {
    setError(null)
    if (!brandId || !year || !month || !title.trim()) {
      setError('Choose a brand, a month and a title.')
      return
    }
    try {
      const plan = await save.mutateAsync({ brand_id: brandId, year, month, title: title.trim() })
      toast.success('Plan created.')
      onOpenChange(false)
      navigate(`/plans/${plan.id}`)
    } catch (e) {
      setError(friendlyError(e, 'The plan could not be created.'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New monthly plan</DialogTitle>
          <DialogDescription>One plan per brand per month. Content already scheduled for that brand and month is attached automatically.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {error && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <Field label="Brand" required>
            <Select value={brandId || undefined} onValueChange={setBrandId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a brand" />
              </SelectTrigger>
              <SelectContent>
                {activeBrands.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Month" required error={duplicate ? 'A plan already exists for this brand and month.' : undefined}>
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </Field>
          <Field label="Title" required>
            <Input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                setTitleTouched(true)
              }}
              maxLength={120}
            />
          </Field>
        </div>
        <DialogFooter>
          {duplicate ? (
            <Button
              onClick={() => {
                onOpenChange(false)
                navigate(`/plans/${duplicate.id}`)
              }}
            >
              Open existing plan
            </Button>
          ) : (
            <Button onClick={submit} disabled={save.isPending || activeBrands.length === 0}>
              {save.isPending && <Spinner className="[&_svg]:text-current" />}
              Create plan
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RenamePlanDialog({ plan, onOpenChange }: { plan: MonthlyPlan | null; onOpenChange: (o: boolean) => void }) {
  const save = useSavePlan()
  const [title, setTitle] = useState('')
  useEffect(() => {
    if (plan) setTitle(plan.title)
  }, [plan])
  return (
    <Dialog open={!!plan} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename plan</DialogTitle>
          <DialogDescription>The brand and month of a plan can’t change. Duplicate it to plan another month.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (!plan || !title.trim()) return
            try {
              await save.mutateAsync({ id: plan.id, title: title.trim() })
              toast.success('Plan renamed.')
              onOpenChange(false)
            } catch (error) {
              toast.error(friendlyError(error))
            }
          }}
        >
          <Field label="Title" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} autoFocus />
          </Field>
          <DialogFooter className="mt-4">
            <Button type="submit" disabled={save.isPending || !title.trim()}>
              {save.isPending && <Spinner className="[&_svg]:text-current" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const OUTCOME: Record<DuplicatePreviewRow['outcome'], { label: string; className: string }> = {
  copy: { label: 'Same day', className: 'text-emerald-800 bg-emerald-50 border-emerald-200' },
  copy_unscheduled: { label: 'Idea', className: 'text-slate-700 bg-slate-50 border-slate-200' },
  moved_to_last_day: { label: 'Moved to last day', className: 'text-amber-900 bg-amber-50 border-amber-200' },
  moved_to_unscheduled: { label: 'Becomes idea', className: 'text-amber-900 bg-amber-50 border-amber-200' },
  skipped_missing_date: { label: 'Skipped — date missing', className: 'text-zinc-600 bg-zinc-100 border-zinc-200' },
  skipped_inactive_format: { label: 'Skipped — inactive format', className: 'text-zinc-600 bg-zinc-100 border-zinc-200' },
}

export function DuplicatePlanDialog({ plan, onOpenChange }: { plan: MonthlyPlan | null; onOpenChange: (o: boolean) => void }) {
  const lookups = useLookups()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { workspace } = useActiveWorkspace()
  const [brandId, setBrandId] = useState('')
  const [period, setPeriod] = useState('')
  const [copyMode, setCopyMode] = useState<'full' | 'structure'>('full')
  const [includeUnscheduled, setIncludeUnscheduled] = useState(false)
  const [strategy, setStrategy] = useState<'last_day' | 'skip' | 'unscheduled'>('last_day')
  const [preview, setPreview] = useState<DuplicatePreviewRow[] | null>(null)
  const [busy, setBusy] = useState<null | 'preview' | 'commit'>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!plan) return
    const next = shiftMonth(plan.year, plan.month, 1)
    setBrandId(plan.brand_id)
    setPeriod(monthKey(next.year, next.month))
    setCopyMode('full')
    setIncludeUnscheduled(false)
    setStrategy('last_day')
    setPreview(null)
    setError(null)
  }, [plan])

  // Any option change invalidates the preview: what you see is what is committed.
  useEffect(() => setPreview(null), [brandId, period, copyMode, includeUnscheduled, strategy])

  const [year, month] = period.split('-').map(Number)
  const input: DuplicateInput | null = plan && brandId && year && month
    ? { sourcePlanId: plan.id, targetBrandId: brandId, targetYear: year, targetMonth: month, copyMode, includeUnscheduled, missingDateStrategy: strategy }
    : null

  const counts = useMemo(() => {
    const rows = preview ?? []
    return {
      copied: rows.filter((r) => !r.outcome.startsWith('skipped')).length,
      skipped: rows.filter((r) => r.outcome.startsWith('skipped')).length,
      flagged: rows.filter((r) => r.is_weekend || r.key_dates).length,
      existingPlan: rows.some((r) => r.target_plan_id),
    }
  }, [preview])

  const doPreview = async () => {
    if (!input) return
    setBusy('preview')
    setError(null)
    try {
      setPreview(await runDuplicate(input, true))
    } catch (e) {
      setError(friendlyError(e, 'The preview could not be generated.'))
    } finally {
      setBusy(null)
    }
  }

  const commit = async () => {
    if (!input) return
    setBusy('commit')
    setError(null)
    try {
      const rows = await runDuplicate(input, false)
      const target = rows.find((r) => r.target_plan_id)?.target_plan_id
      await queryClient.invalidateQueries({ queryKey: wsKey(workspace.id) })
      await queryClient.invalidateQueries({ queryKey: contentKey(workspace.id) })
      toast.success(`${rows.filter((r) => r.new_item_id).length} posts copied. The original plan is unchanged.`)
      onOpenChange(false)
      if (target) navigate(`/plans/${target}`)
    } catch (e) {
      setError(friendlyError(e, 'Duplication failed. Nothing was copied.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={!!plan} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Duplicate plan</DialogTitle>
          <DialogDescription>
            Copies {plan?.title} into a new month as new items. The original plan and its posts are never changed, and history isn’t copied.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Target brand" required>
            <Select value={brandId || undefined} onValueChange={setBrandId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a brand" />
              </SelectTrigger>
              <SelectContent>
                {lookups.brands
                  .filter((b) => b.is_active && lookups.myBrandIds.has(b.id))
                  .map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Target month" required>
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </Field>
          <fieldset className="sm:col-span-2">
            <legend className="mb-1.5 text-xs font-medium text-foreground/80">What to copy</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ['full', 'Full content', 'Titles, captions, hashtags, CTA and strategy; owners too when an administrator duplicates'],
                  ['structure', 'Schedule structure only', 'Titles, dates, formats, pillars and platforms'],
                ] as const
              ).map(([value, title, hint]) => (
                <label key={value} className="flex cursor-pointer flex-col gap-0.5 rounded-md border p-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                  <input type="radio" name="copy-mode" className="sr-only" checked={copyMode === value} onChange={() => setCopyMode(value)} />
                  <span className="font-medium">{title}</span>
                  <span className="text-xs text-muted-foreground">{hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Dates that don’t exist in the target month" hint="e.g. the 31st when copying into a 30-day month">
            <Select value={strategy} onValueChange={(v) => setStrategy(v as typeof strategy)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="last_day">Move to the last day of the month</SelectItem>
                <SelectItem value="unscheduled">Copy as unscheduled ideas</SelectItem>
                <SelectItem value="skip">Don’t copy them</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="flex items-center gap-2 sm:pt-6">
            <Checkbox id="dup-ideas" checked={includeUnscheduled} onCheckedChange={(v) => setIncludeUnscheduled(v === true)} />
            <Label htmlFor="dup-ideas" className="font-normal">
              Include unscheduled ideas in this plan
            </Label>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Copies start as Planned with no approval, publication date or live URL. Cancelled posts aren’t copied. Weekends and key dates are flagged below — nothing is moved
          automatically.
        </p>

        {error && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {preview && (
          <div className="rounded-md border">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-muted/50 px-3 py-2 text-xs">
              <span>
                <strong className="tabular">{counts.copied}</strong> will be copied
              </span>
              {counts.skipped > 0 && (
                <span>
                  <strong className="tabular">{counts.skipped}</strong> skipped
                </span>
              )}
              {counts.flagged > 0 && (
                <span className="text-amber-900">
                  <strong className="tabular">{counts.flagged}</strong> land on a weekend or key date
                </span>
              )}
              <span className="ml-auto text-muted-foreground">{counts.existingPlan ? 'Adds to the existing plan for that month' : 'Creates a new plan'}</span>
            </div>
            {preview.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">This plan has no posts to copy with these options.</p>
            ) : (
              <ul className="max-h-72 divide-y overflow-y-auto">
                {preview.map((row) => (
                  <li key={row.source_item_id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{row.title}</div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        {row.source_date ? formatDate(row.source_date, 'EEE d MMM') : 'Idea'}
                        <ArrowRight className="size-3" aria-label="to" />
                        <span className={cn(row.target_date && (row.is_weekend || row.key_dates) && 'font-medium text-amber-900')}>
                          {row.target_date ? formatDate(row.target_date, 'EEE d MMM') : row.outcome.startsWith('skipped') ? '—' : 'Idea'}
                        </span>
                        {row.is_weekend && <span className="text-amber-900">· weekend</span>}
                        {row.key_dates && (
                          <span className="inline-flex items-center gap-0.5 text-rose-800">
                            · <CalendarHeart className="size-3" aria-hidden /> {row.key_dates}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className={cn('rounded-sm border px-1.5 text-[11px] font-medium whitespace-nowrap', OUTCOME[row.outcome].className)}>{OUTCOME[row.outcome].label}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={doPreview} disabled={!input || !!busy}>
            {busy === 'preview' ? <Spinner /> : <Eye />}
            {preview ? 'Refresh preview' : 'Preview'}
          </Button>
          <Button onClick={commit} disabled={!preview || counts.copied === 0 || !!busy}>
            {busy === 'commit' && <Spinner className="[&_svg]:text-current" />}
            Duplicate {preview ? `${counts.copied} ${counts.copied === 1 ? 'post' : 'posts'}` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
