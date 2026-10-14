import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CalendarHeart, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Field } from '@/components/common/Field'
import { EmptyState, ErrorState, PageLoader, Spinner } from '@/components/common/states'
import { useActiveWorkspace } from '@/features/workspace/WorkspaceProvider'
import { useKeyDates, wsKey } from '@/hooks/useWorkspaceData'
import { requireSupabase } from '@/lib/supabase'
import { friendlyError } from '@/lib/errors'
import { formatDate } from '@/lib/dates'
import type { KeyDate, KeyDateKind } from '@/types/database'
import { SettingsSection } from './SettingsSection'

const KIND_LABEL: Record<KeyDateKind, string> = { holiday: 'Holiday', observance: 'Observance', campaign: 'Campaign', other: 'Other' }

function KeyDateDialog({ entry, open, onOpenChange, defaultYear }: { entry: KeyDate | null; open: boolean; onOpenChange: (o: boolean) => void; defaultYear: number }) {
  const { workspace } = useActiveWorkspace()
  const queryClient = useQueryClient()
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const [kind, setKind] = useState<KeyDateKind>('holiday')
  const [region, setRegion] = useState('PH')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [initialised, setInitialised] = useState<string | null>(null)

  const key = `${open}-${entry?.id ?? 'new'}`
  if (open && initialised !== key) {
    setInitialised(key)
    setDate(entry?.date ?? `${defaultYear}-01-01`)
    setName(entry?.name ?? '')
    setKind(entry?.kind ?? 'holiday')
    setRegion(entry?.region ?? 'PH')
    setNotes(entry?.notes ?? '')
    setError(null)
  }

  const save = async () => {
    if (!date || !name.trim()) {
      setError('Enter a date and a name.')
      return
    }
    setBusy(true)
    const payload = { date, name: name.trim(), kind, region: region.trim() || null, notes: notes.trim() || null }
    const client = requireSupabase()
    const { error: saveError } = entry ? await client.from('key_dates').update(payload).eq('id', entry.id) : await client.from('key_dates').insert({ ...payload, workspace_id: workspace.id })
    setBusy(false)
    if (saveError) {
      setError(friendlyError(saveError))
      return
    }
    await queryClient.invalidateQueries({ queryKey: [...wsKey(workspace.id), 'key_dates'] })
    toast.success(entry ? 'Key date updated.' : 'Key date added.')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{entry ? 'Edit key date' : 'Add key date'}</DialogTitle>
          <DialogDescription>Key dates appear on the calendar, in summaries, duplication previews and PDF exports.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
          className="grid gap-3 sm:grid-cols-2"
        >
          {error && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive sm:col-span-2">
              {error}
            </p>
          )}
          <Field label="Date" required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Type">
            <Select value={kind} onValueChange={(v) => setKind(v as KeyDateKind)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(KIND_LABEL) as KeyDateKind[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Name" required className="sm:col-span-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </Field>
          <Field label="Country / region">
            <Input value={region} onChange={(e) => setRegion(e.target.value)} maxLength={60} />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <Button type="submit" disabled={busy}>
              {busy && <Spinner className="[&_svg]:text-current" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function KeyDateSettings() {
  const { workspace, today } = useActiveWorkspace()
  const queryClient = useQueryClient()
  const [year, setYear] = useState(Number(today.slice(0, 4)))
  const keyDates = useKeyDates(`${year}-01-01`, `${year}-12-31`)
  const [editing, setEditing] = useState<KeyDate | null>(null)
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState<KeyDate | null>(null)

  return (
    <SettingsSection
      title="Key dates & holidays"
      description="Maintained per workspace — nothing is hard-coded, so add each year’s dates here."
      actions={
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" aria-label="Previous year" onClick={() => setYear(year - 1)}>
            <ChevronLeft />
          </Button>
          <span className="w-12 text-center text-sm font-semibold tabular">{year}</span>
          <Button variant="outline" size="icon-sm" aria-label="Next year" onClick={() => setYear(year + 1)}>
            <ChevronRight />
          </Button>
          <Button
            size="sm"
            className="ml-2"
            onClick={() => {
              setEditing(null)
              setOpen(true)
            }}
          >
            <Plus /> Add
          </Button>
        </div>
      }
    >
      {keyDates.isPending ? (
        <PageLoader />
      ) : keyDates.isError ? (
        <ErrorState error={keyDates.error} onRetry={() => keyDates.refetch()} />
      ) : keyDates.data.length === 0 ? (
        <EmptyState icon={<CalendarHeart />} title={`No key dates for ${year}`} description="Add holidays, observances and campaign dates." />
      ) : (
        <div className="-m-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-36">Date</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="w-28">Type</TableHead>
                <TableHead className="w-24">Region</TableHead>
                <TableHead className="w-20">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keyDates.data.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{formatDate(k.date, 'EEE, d MMM')}</TableCell>
                  <TableCell>
                    {k.name}
                    {k.notes && <div className="text-xs text-muted-foreground">{k.notes}</div>}
                  </TableCell>
                  <TableCell>{KIND_LABEL[k.kind]}</TableCell>
                  <TableCell>{k.region}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${k.name}`}
                      onClick={() => {
                        setEditing(k)
                        setOpen(true)
                      }}
                    >
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete ${k.name}`} onClick={() => setDeleting(k)}>
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <KeyDateDialog entry={editing} open={open} onOpenChange={setOpen} defaultYear={year} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.name}”?`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          const { error } = await requireSupabase().from('key_dates').delete().eq('id', deleting!.id)
          if (error) toast.error(friendlyError(error))
          else toast.success('Key date deleted.')
          await queryClient.invalidateQueries({ queryKey: [...wsKey(workspace.id), 'key_dates'] })
        }}
      />
    </SettingsSection>
  )
}
