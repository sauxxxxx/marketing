import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ImageUp, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/common/states'
import { useActiveWorkspace } from '@/features/workspace/WorkspaceProvider'
import { requireSupabase } from '@/lib/supabase'
import { friendlyError } from '@/lib/errors'
import { STORAGE_BUCKET } from '@/lib/constants'
import { storageSafeName } from '@/components/content/AssetsPanel'

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_LOGO_BYTES = 2 * 1024 * 1024

export function useSignedUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: ['signed-url', path],
    enabled: !!path,
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await requireSupabase().storage.from(STORAGE_BUCKET).createSignedUrl(path!, 3600)
      if (error) throw error
      return data.signedUrl
    },
  })
}

/** Uploads a logo into the private branding folder (administrators only, enforced by storage RLS). */
export function LogoField({ value, onChange, disabled, label = 'Logo' }: { value: string | null; onChange: (path: string | null) => void; disabled?: boolean; label?: string }) {
  const { workspace } = useActiveWorkspace()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const preview = useSignedUrl(value)

  const upload = async (file: File) => {
    if (!LOGO_TYPES.includes(file.type)) {
      toast.error('Use a PNG, JPEG or WebP image.')
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error('Logos must be 2 MB or smaller.')
      return
    }
    setBusy(true)
    const path = `${workspace.id}/branding/${crypto.randomUUID()}-${storageSafeName(file.name)}`
    const { error } = await requireSupabase().storage.from(STORAGE_BUCKET).upload(path, file, { contentType: file.type, upsert: false })
    setBusy(false)
    if (error) {
      toast.error(friendlyError(error, 'The logo could not be uploaded.'))
      return
    }
    onChange(path)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-foreground/80">{label}</span>
      <div className="flex items-center gap-3">
        <div className="flex size-14 items-center justify-center overflow-hidden rounded-md border bg-muted">
          {preview.data ? <img src={preview.data} alt="" className="size-full object-contain" /> : <ImageUp className="size-5 text-muted-foreground" aria-hidden />}
        </div>
        <input
          ref={input}
          type="file"
          accept={LOGO_TYPES.join(',')}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) upload(file)
          }}
        />
        <Button type="button" variant="outline" size="sm" disabled={disabled || busy} onClick={() => input.current?.click()}>
          {busy && <Spinner />} {value ? 'Replace' : 'Upload'}
        </Button>
        {value && (
          <Button type="button" variant="ghost" size="sm" disabled={disabled || busy} onClick={() => onChange(null)}>
            <Trash2 /> Remove
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">PNG, JPEG or WebP, up to 2 MB. Stored privately.</p>
    </div>
  )
}
