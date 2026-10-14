import type { ContentItem } from '@/types/database'
import type { Lookups } from '@/hooks/useWorkspaceData'

/** Timed posts first; unscheduled times follow, with stable title/id ordering. */
export function comparePostingTime(a: ContentItem, b: ContentItem): number {
  return (
    (a.scheduled_time ?? '99:99').localeCompare(b.scheduled_time ?? '99:99') ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id)
  )
}

export function groupPostsByBrand(items: ContentItem[], lookups: Lookups) {
  const groups = new Map<string, ContentItem[]>()
  for (const item of items) groups.set(item.brand_id, [...(groups.get(item.brand_id) ?? []), item])
  return [...groups]
    .map(([id, posts]) => ({
      id,
      name: lookups.brandById.get(id)?.name ?? 'Unknown brand',
      posts: [...posts].sort(comparePostingTime),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}
