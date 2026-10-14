import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { ErrorState, PageLoader } from '@/components/common/states'
import { useActiveWorkspace } from '@/features/workspace/WorkspaceProvider'
import { useFormats, usePillars, wsKey } from '@/hooks/useWorkspaceData'
import { requireSupabase } from '@/lib/supabase'
import { friendlyError } from '@/lib/errors'
import { hexColorSchema } from '@/lib/validation'
import type { ConfigItem } from '@/types/database'
import { SettingsSection } from './SettingsSection'

type Table = 'content_formats' | 'content_pillars'

function ConfigRow({ item, table, first, last, onMove, onDelete }: { item: ConfigItem; table: Table; first: boolean; last: boolean; onMove: (dir: -1 | 1) => void; onDelete: () => void }) {
  const { workspace } = useActiveWorkspace()
  const queryClient = useQueryClient()
  const [name, setName] = useState(item.name)
  const [color, setColor] = useState(item.color)

  const save = async (patch: Partial<Pick<ConfigItem, 'name' | 'color' | 'is_active'>>) => {
    if (patch.name !== undefined && !patch.name.trim()) {
      setName(item.name)
      return
    }
    if (patch.color !== undefined && !hexColorSchema.safeParse(patch.color).success) {
      toast.error('Use a hex colour like #0f5257.')
      setColor(item.color)
      return
    }
    const { error } = await requireSupabase().from(table).update(patch).eq('id', item.id)
    if (error) {
      toast.error(friendlyError(error))
      setName(item.name)
      setColor(item.color)
    }
    await queryClient.invalidateQueries({ queryKey: [...wsKey(workspace.id), table] })
  }

  const label = table === 'content_formats' ? 'format' : 'pillar'
  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <div className="flex flex-col">
        <Button variant="ghost" size="icon-xs" aria-label={`Move ${item.name} up`} disabled={first} onClick={() => onMove(-1)}>
          <ArrowUp />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label={`Move ${item.name} down`} disabled={last} onClick={() => onMove(1)}>
          <ArrowDown />
        </Button>
      </div>
      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        onBlur={() => color !== item.color && save({ color })}
        className="h-8 w-9 cursor-pointer rounded border bg-card p-0.5"
        aria-label={`Colour for ${item.name}`}
      />
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() !== item.name && save({ name: name.trim() })}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="h-8 max-w-56 flex-1"
        maxLength={40}
        aria-label={`Name of ${label}`}
      />
      <code className="hidden text-xs text-muted-foreground sm:inline">{color}</code>
      <div className="ml-auto flex items-center gap-2">
        <Switch checked={item.is_active} onCheckedChange={(is_active) => save({ is_active })} aria-label={`${item.name} active`} />
        <span className="w-14 text-xs text-muted-foreground">{item.is_active ? 'Active' : 'Inactive'}</span>
        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${item.name}`} onClick={onDelete}>
          <Trash2 />
        </Button>
      </div>
    </li>
  )
}

function ConfigList({ table, title, description }: { table: Table; title: string; description: string }) {
  const { workspace } = useActiveWorkspace()
  const queryClient = useQueryClient()
  const formats = useFormats()
  const pillars = usePillars()
  const query = table === 'content_formats' ? formats : pillars
  const [newName, setNewName] = useState('')
  const [deleting, setDeleting] = useState<ConfigItem | null>(null)
  const invalidate = () => queryClient.invalidateQueries({ queryKey: [...wsKey(workspace.id), table] })

  const add = async () => {
    const name = newName.trim()
    if (!name) return
    const items = query.data ?? []
    const palette = ['#0e7490', '#c2410c', '#7c3aed', '#15803d', '#be185d', '#1e40af', '#a16207', '#475569']
    const { error } = await requireSupabase()
      .from(table)
      .insert({ workspace_id: workspace.id, name, color: palette[items.length % palette.length], sort_order: (items.at(-1)?.sort_order ?? 0) + 10 })
    if (error) toast.error(friendlyError(error))
    else setNewName('')
    invalidate()
  }

  const move = async (index: number, dir: -1 | 1) => {
    const items = query.data ?? []
    const a = items[index]
    const b = items[index + dir]
    if (!a || !b) return
    const client = requireSupabase()
    // Normalise ordering to distinct values, then swap the two neighbours.
    const reordered = [...items]
    reordered[index] = b
    reordered[index + dir] = a
    const results = await Promise.all(reordered.map((item, i) => (item.sort_order !== (i + 1) * 10 ? client.from(table).update({ sort_order: (i + 1) * 10 }).eq('id', item.id) : null)))
    const failed = results.find((r) => r?.error)
    if (failed?.error) toast.error(friendlyError(failed.error))
    invalidate()
  }

  return (
    <SettingsSection title={title} description={description}>
      {query.isPending ? (
        <PageLoader />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <>
          <ul className="divide-y">
            {query.data.map((item, i) => (
              <ConfigRow key={`${item.id}-${item.updated_at}`} item={item} table={table} first={i === 0} last={i === query.data.length - 1} onMove={(dir) => move(i, dir)} onDelete={() => setDeleting(item)} />
            ))}
          </ul>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              add()
            }}
          >
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={`New ${table === 'content_formats' ? 'format' : 'pillar'} name`} className="h-8 max-w-64" maxLength={40} aria-label="New item name" />
            <Button type="submit" size="sm" variant="outline" disabled={!newName.trim()}>
              <Plus /> Add
            </Button>
          </form>
        </>
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.name}”?`}
        description="Items used by any content can’t be deleted — deactivate them instead so history stays intact."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          const { data, error } = await requireSupabase().from(table).delete().eq('id', deleting!.id).select('id')
          if (error) toast.error(friendlyError(error))
          else if (!data?.length) toast.error('This item could not be deleted.')
          else toast.success('Deleted.')
          invalidate()
        }}
      />
    </SettingsSection>
  )
}

export function ConfigSettings() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ConfigList table="content_formats" title="Content formats" description="Shown as a solid colour bar on calendar cards, the board, the editor and PDFs." />
      <ConfigList table="content_pillars" title="Content pillars" description="Shown as outlined tags — filtered separately from formats." />
    </div>
  )
}
