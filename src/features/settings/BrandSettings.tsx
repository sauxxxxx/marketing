import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Pencil, Plus, Tags } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Field } from '@/components/common/Field'
import { EmptyState, ErrorState, PageLoader, Spinner } from '@/components/common/states'
import { useActiveWorkspace } from '@/features/workspace/WorkspaceProvider'
import { useBrandEditors, useBrands, useMembers, wsKey } from '@/hooks/useWorkspaceData'
import { requireSupabase } from '@/lib/supabase'
import { friendlyError } from '@/lib/errors'
import { formatTimestamp } from '@/lib/dates'
import type { Brand } from '@/types/database'
import { LogoField } from './LogoField'
import { SettingsSection } from './SettingsSection'

type Draft = Pick<Brand, 'name' | 'description' | 'notes' | 'logo_path' | 'is_active'>
const EMPTY: Draft = { name: '', description: '', notes: '', logo_path: null, is_active: true }

function BrandDialog({ brand, open, onOpenChange }: { brand: Brand | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { workspace } = useActiveWorkspace()
  const queryClient = useQueryClient()
  const members = useMembers()
  const brandEditors = useBrandEditors()
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [editorIds, setEditorIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const currentEditorIds = (brandEditors.data ?? []).filter((be) => be.brand_id === brand?.id).map((be) => be.user_id)
  // Active editors can be added; anyone already assigned stays listed so they can be removed.
  const candidates = (members.data ?? []).filter(
    (m) => (m.role === 'editor' && m.status === 'active') || currentEditorIds.includes(m.user_id),
  )

  useEffect(() => {
    if (open) {
      setDraft(brand ? { name: brand.name, description: brand.description ?? '', notes: brand.notes ?? '', logo_path: brand.logo_path, is_active: brand.is_active } : EMPTY)
      setEditorIds(currentEditorIds)
      setError(null)
    }
    // currentEditorIds is derived from brandEditors; reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, brand])

  const save = async () => {
    if (!draft.name.trim()) {
      setError('Enter a brand name.')
      return
    }
    setBusy(true)
    const payload = {
      name: draft.name.trim(),
      description: draft.description?.trim() || null,
      notes: draft.notes?.trim() || null,
      logo_path: draft.logo_path,
      is_active: draft.is_active,
    }
    const client = requireSupabase()
    const saved = brand
      ? await client.from('brands').update(payload).eq('id', brand.id).select('id').single()
      : await client.from('brands').insert({ ...payload, workspace_id: workspace.id }).select('id').single()
    if (saved.error || !saved.data) {
      setBusy(false)
      setError(friendlyError(saved.error, 'The brand could not be saved.'))
      return
    }
    const brandId = (saved.data as { id: string }).id
    const toAdd = editorIds.filter((id) => !currentEditorIds.includes(id))
    const toRemove = currentEditorIds.filter((id) => !editorIds.includes(id))
    const added = toAdd.length
      ? await client.from('brand_editors').insert(toAdd.map((user_id) => ({ workspace_id: workspace.id, brand_id: brandId, user_id })))
      : { error: null }
    const removed = toRemove.length
      ? await client.from('brand_editors').delete().eq('brand_id', brandId).in('user_id', toRemove)
      : { error: null }
    setBusy(false)
    await queryClient.invalidateQueries({ queryKey: [...wsKey(workspace.id), 'brands'] })
    await queryClient.invalidateQueries({ queryKey: [...wsKey(workspace.id), 'brand_editors'] })
    if (added.error || removed.error) {
      setError(friendlyError(added.error ?? removed.error, 'The brand was saved, but its editors could not be updated.'))
      return
    }
    toast.success(brand ? 'Brand updated.' : 'Brand created.')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{brand ? 'Edit brand' : 'New brand'}</DialogTitle>
          <DialogDescription>Brands separate content, plans and exports. Deactivated brands keep their history but can’t receive new content.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
          className="flex flex-col gap-3"
        >
          {error && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <Field label="Name" required>
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={80} autoFocus />
          </Field>
          <Field label="Description">
            <Input value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={1000} />
          </Field>
          <Field label="Brand notes" hint="Tone of voice, approval contacts, posting rules…">
            <Textarea rows={3} value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} maxLength={5000} />
          </Field>
          <fieldset>
            <legend className="text-xs font-medium text-foreground/80">Editors</legend>
            <p className="text-xs text-muted-foreground">
              Editors can create content only in their brands and see only posts assigned to them. Administrators and viewers see every brand.
            </p>
            {candidates.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">No editors in the workspace yet. Invite them from the Team page.</p>
            ) : (
              <div className="mt-2 grid max-h-40 gap-1.5 overflow-y-auto sm:grid-cols-2">
                {candidates.map((m) => {
                  const id = `brand-editor-${m.user_id}`
                  const checked = editorIds.includes(m.user_id)
                  return (
                    <div key={m.user_id} className="flex items-center gap-2">
                      <Checkbox
                        id={id}
                        checked={checked}
                        onCheckedChange={(v) => setEditorIds(v === true ? [...editorIds, m.user_id] : editorIds.filter((x) => x !== m.user_id))}
                      />
                      <Label htmlFor={id} className="truncate font-normal">
                        {m.profile?.full_name || m.profile?.email}
                        {m.status !== 'active' && <span className="text-muted-foreground"> (inactive)</span>}
                      </Label>
                    </div>
                  )
                })}
              </div>
            )}
          </fieldset>
          <LogoField value={draft.logo_path} onChange={(logo_path) => setDraft({ ...draft, logo_path })} />
          <div className="flex items-center gap-2">
            <Switch id="brand-active" checked={draft.is_active} onCheckedChange={(is_active) => setDraft({ ...draft, is_active })} />
            <Label htmlFor="brand-active">Active</Label>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy && <Spinner className="[&_svg]:text-current" />}
              {brand ? 'Save brand' : 'Create brand'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function BrandSettings() {
  const { workspace } = useActiveWorkspace()
  const brands = useBrands()
  const brandEditors = useBrandEditors()
  const members = useMembers()
  const editorNames = (brandId: string) =>
    (brandEditors.data ?? [])
      .filter((be) => be.brand_id === brandId)
      .map((be) => members.data?.find((m) => m.user_id === be.user_id)?.profile?.full_name || 'Editor')
  const [editing, setEditing] = useState<Brand | null>(null)
  const [open, setOpen] = useState(false)

  return (
    <SettingsSection
      title="Brands"
      description="Every content item, plan and export belongs to a brand."
      actions={
        <Button
          size="sm"
          onClick={() => {
            setEditing(null)
            setOpen(true)
          }}
        >
          <Plus /> New brand
        </Button>
      }
    >
      {brands.isPending ? (
        <PageLoader />
      ) : brands.isError ? (
        <ErrorState error={brands.error} onRetry={() => brands.refetch()} />
      ) : brands.data.length === 0 ? (
        <EmptyState icon={<Tags />} title="No brands yet" description="Create your first brand to start planning content." />
      ) : (
        <div className="-m-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Brand</TableHead>
                <TableHead className="w-56">Editors</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-44">Updated</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {brands.data.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>
                    <div className="font-medium">
                      {b.name}
                      {b.is_demo && <span className="ml-2 rounded-sm bg-amber-100 px-1 text-[10px] font-medium text-amber-900">Demo</span>}
                    </div>
                    {b.description && <div className="text-xs text-muted-foreground">{b.description}</div>}
                  </TableCell>
                  <TableCell className="text-xs">
                    {editorNames(b.id).length ? editorNames(b.id).join(', ') : <span className="text-muted-foreground">No editors</span>}
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex h-5 items-center rounded-sm border px-1.5 text-[11px] font-medium ${b.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-zinc-200 bg-zinc-100 text-zinc-600'}`}>
                      {b.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs">{formatTimestamp(b.updated_at, workspace.timezone)}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${b.name}`}
                      onClick={() => {
                        setEditing(b)
                        setOpen(true)
                      }}
                    >
                      <Pencil />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <BrandDialog brand={editing} open={open} onOpenChange={setOpen} />
    </SettingsSection>
  )
}
