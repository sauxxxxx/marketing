import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type { ContentItem } from '@/types/database'

type Cached = ContentItem[] | ContentItem | { rows: ContentItem[]; count: number } | null | undefined

function patchValue(value: Cached, id: string, patch: Partial<ContentItem>): Cached {
  if (!value) return value
  if (Array.isArray(value)) return value.map((item) => (item.id === id ? { ...item, ...patch } : item))
  if ('rows' in value) return { ...value, rows: value.rows.map((item) => (item.id === id ? { ...item, ...patch } : item)) }
  if ('id' in value && value.id === id) return { ...value, ...patch }
  return value
}

/**
 * Applies `patch` to every cached copy of a content item under `prefix` and
 * returns a function that restores the exact previous cache state. Used for
 * drag-and-drop rescheduling and status changes so a failed write snaps the
 * card back to where it was.
 */
export async function optimisticallyPatchContent(
  queryClient: QueryClient,
  prefix: QueryKey,
  id: string,
  patch: Partial<ContentItem>,
): Promise<() => void> {
  await queryClient.cancelQueries({ queryKey: prefix })
  const snapshots = queryClient.getQueriesData<Cached>({ queryKey: prefix })
  for (const [key, value] of snapshots) {
    queryClient.setQueryData<Cached>(key, patchValue(value, id, patch))
  }
  return () => {
    for (const [key, value] of snapshots) queryClient.setQueryData(key, value)
  }
}
