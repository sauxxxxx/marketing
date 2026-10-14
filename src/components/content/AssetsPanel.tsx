import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ExternalLink, FileText, Film, Image as ImageIcon, Link2, Paperclip, Shapes, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState, ErrorState, Spinner } from '@/components/common/states'
import { useActiveWorkspace } from '@/features/workspace/WorkspaceProvider'
import { contentKey } from '@/hooks/useContent'
import { requireSupabase } from '@/lib/supabase'
import { friendlyError } from '@/lib/errors'
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, STORAGE_BUCKET } from '@/lib/constants'
import type { AssetKind, ContentAsset, ContentItem } from '@/types/database'

const KIND_ICON: Record<AssetKind, typeof ImageIcon> = {
  image: ImageIcon,
  video: Film,
  design: Shapes,
  document: FileText,
  link: Link2,
}

const KIND_LABEL: Record<AssetKind, string> = {
  image: 'Image',
  video: 'Video',
  design: 'Design export',
  document: 'Reference document',
  link: 'External link',
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Returns an error message, or null when the file can be uploaded. */
export function validateUpload(file: Pick<File, 'type' | 'size' | 'name'>): string | null {
  if (!ALLOWED_UPLOAD_TYPES[file.type]) return `${file.name}: this file type isn’t allowed.`
  if (file.size > MAX_UPLOAD_BYTES) return `${file.name}: files must be 50 MB or smaller.`
  if (file.size === 0) return `${file.name}: the file is empty.`
  return null
}

export function storageSafeName(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|-$/g, '')
  return (cleaned || 'file').slice(-120)
}

export function AssetsPanel({ item, canEdit }: { item: ContentItem; canEdit: boolean }) {
  const { workspace } = useActiveWorkspace()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkLabel, setLinkLabel] = useState('')
  const [uploadKind, setUploadKind] = useState<'auto' | 'design'>('auto')
  const [toDelete, setToDelete] = useState<ContentAsset | null>(null)
  const key = [...contentKey(workspace.id), 'assets', item.id]

  const assets = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('content_assets')
        .select('*')
        .eq('content_id', item.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as ContentAsset[]
    },
  })

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const client = requireSupabase()
      for (const file of files) {
        const problem = validateUpload(file)
        if (problem) throw new Error(problem)
        const path = `${workspace.id}/content/${item.id}/${crypto.randomUUID()}-${storageSafeName(file.name)}`
        const { error: uploadError } = await client.storage.from(STORAGE_BUCKET).upload(path, file, {
          contentType: file.type,
          upsert: false,
        })
        if (uploadError) throw uploadError
        const kind = uploadKind === 'design' ? 'design' : ALLOWED_UPLOAD_TYPES[file.type]
        const { error: rowError } = await client.from('content_assets').insert({
          workspace_id: workspace.id,
          content_id: item.id,
          kind,
          storage_path: path,
          file_name: file.name.slice(0, 255),
          mime_type: file.type,
          size_bytes: file.size,
        })
        if (rowError) {
          // Don't leave an orphaned object behind.
          await client.storage.from(STORAGE_BUCKET).remove([path])
          throw rowError
        }
      }
    },
    onSuccess: () => toast.success('Files uploaded.'),
    onError: (error) => toast.error(error instanceof Error && error.message.includes(':') ? error.message : friendlyError(error, 'Upload failed.')),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })

  const addLink = useMutation({
    mutationFn: async () => {
      const url = linkUrl.trim()
      if (!/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(url)) throw new Error('Enter a full URL starting with http:// or https://')
      const { error } = await requireSupabase()
        .from('content_assets')
        .insert({ workspace_id: workspace.id, content_id: item.id, kind: 'link', external_url: url, label: linkLabel.trim() || null })
      if (error) throw error
    },
    onSuccess: () => {
      setLinkUrl('')
      setLinkLabel('')
      toast.success('Link added.')
    },
    onError: (error) => toast.error(error instanceof Error && error.message.startsWith('Enter') ? error.message : friendlyError(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })

  const remove = async (asset: ContentAsset) => {
    const client = requireSupabase()
    const { data, error } = await client.from('content_assets').delete().eq('id', asset.id).select('id')
    if (error || !data?.length) {
      toast.error(friendlyError(error ?? { code: 'PGRST116' }))
      return
    }
    if (asset.storage_path) await client.storage.from(STORAGE_BUCKET).remove([asset.storage_path])
    toast.success('Attachment removed.')
    await queryClient.invalidateQueries({ queryKey: key })
  }

  const open = async (asset: ContentAsset) => {
    if (asset.external_url) {
      window.open(asset.external_url, '_blank', 'noopener,noreferrer')
      return
    }
    // Short-lived URL, only issued if storage RLS allows this user to read it.
    const { data, error } = await requireSupabase().storage.from(STORAGE_BUCKET).createSignedUrl(asset.storage_path!, 300)
    if (error || !data) {
      toast.error(friendlyError(error, 'The file could not be opened.'))
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="flex flex-col gap-5">
      {canEdit && (
        <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              accept={Object.keys(ALLOWED_UPLOAD_TYPES).join(',')}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                e.target.value = ''
                const problems = files.map(validateUpload).filter(Boolean)
                if (problems.length) {
                  toast.error(problems[0]!)
                  return
                }
                if (files.length) upload.mutate(files)
              }}
            />
            <Button type="button" size="sm" onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? <Spinner className="[&_svg]:text-current" /> : <Upload />}
              Upload files
            </Button>
            <Select value={uploadKind} onValueChange={(v) => setUploadKind(v as 'auto' | 'design')}>
              <SelectTrigger size="sm" className="w-44" aria-label="Upload as">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Detect type</SelectItem>
                <SelectItem value="design">Mark as design export</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">Images, videos, PDFs, Office files, PSD/AI, ZIP · up to 50 MB</span>
          </div>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              addLink.mutate()
            }}
          >
            <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://drive.google.com/…" className="h-8 min-w-48 flex-1" aria-label="External asset link" />
            <Input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="Label (optional)" className="h-8 w-40" aria-label="Link label" />
            <Button type="submit" size="sm" variant="outline" disabled={!linkUrl || addLink.isPending}>
              <Link2 /> Add link
            </Button>
          </form>
        </div>
      )}

      {assets.isPending ? (
        <div className="py-6 text-center">
          <Spinner />
        </div>
      ) : assets.isError ? (
        <ErrorState error={assets.error} onRetry={() => assets.refetch()} />
      ) : assets.data.length === 0 ? (
        <EmptyState icon={<Paperclip />} title="No attachments" description={canEdit ? 'Upload designs, videos and references or add links.' : undefined} />
      ) : (
        <ul className="divide-y rounded-md border">
          {assets.data.map((asset) => {
            const Icon = KIND_ICON[asset.kind]
            return (
              <li key={asset.id} className="flex items-center gap-3 px-3 py-2">
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => open(asset)} className="block max-w-full truncate text-left text-sm font-medium hover:underline">
                    {asset.label || asset.file_name || asset.external_url}
                  </button>
                  <div className="text-xs text-muted-foreground">
                    {KIND_LABEL[asset.kind]}
                    {asset.size_bytes ? ` · ${formatBytes(asset.size_bytes)}` : ''}
                  </div>
                </div>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Open" onClick={() => open(asset)}>
                  <ExternalLink />
                </Button>
                {canEdit && (
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove attachment" onClick={() => setToDelete(asset)}>
                    <Trash2 />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Remove attachment?"
        description={toDelete?.storage_path ? 'The file will be deleted from storage.' : 'The link will be removed.'}
        confirmLabel="Remove"
        destructive
        onConfirm={() => toDelete && remove(toDelete)}
      />
    </div>
  )
}
