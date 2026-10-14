import type { ContentItem, ContentStatus } from '@/types/database'
import { CONTENT_STATUSES } from './status'

export const UNASSIGNED = 'unassigned'

export interface ContentFilters {
  brandIds: string[]
  formatIds: string[]
  pillarIds: string[]
  statuses: ContentStatus[]
  /** User ids, or UNASSIGNED for items without an owner. */
  assigneeIds: string[]
}

export const EMPTY_FILTERS: ContentFilters = {
  brandIds: [],
  formatIds: [],
  pillarIds: [],
  statuses: [],
  assigneeIds: [],
}

type Filterable = Pick<ContentItem, 'brand_id' | 'format_id' | 'pillar_id' | 'status' | 'assigned_to'>

export function matchesFilters(item: Filterable, f: ContentFilters): boolean {
  if (f.brandIds.length && !f.brandIds.includes(item.brand_id)) return false
  if (f.formatIds.length && !f.formatIds.includes(item.format_id)) return false
  if (f.pillarIds.length && !(item.pillar_id && f.pillarIds.includes(item.pillar_id))) return false
  if (f.statuses.length && !f.statuses.includes(item.status)) return false
  if (f.assigneeIds.length) {
    const key = item.assigned_to ?? UNASSIGNED
    if (!f.assigneeIds.includes(key)) return false
  }
  return true
}

export function applyFilters<T extends Filterable>(items: readonly T[], f: ContentFilters): T[] {
  return items.filter((i) => matchesFilters(i, f))
}

export function activeFilterCount(f: ContentFilters): number {
  return f.brandIds.length + f.formatIds.length + f.pillarIds.length + f.statuses.length + f.assigneeIds.length
}

const PARAMS: Record<keyof ContentFilters, string> = {
  brandIds: 'brand',
  formatIds: 'format',
  pillarIds: 'pillar',
  statuses: 'status',
  assigneeIds: 'assignee',
}

const SAFE_ID = /^[0-9a-zA-Z_-]{1,64}$/

export function filtersFromParams(params: URLSearchParams): ContentFilters {
  const read = (key: string) =>
    (params.get(key) ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter((v) => SAFE_ID.test(v))
  return {
    brandIds: read(PARAMS.brandIds),
    formatIds: read(PARAMS.formatIds),
    pillarIds: read(PARAMS.pillarIds),
    statuses: read(PARAMS.statuses).filter((s): s is ContentStatus => (CONTENT_STATUSES as readonly string[]).includes(s)),
    assigneeIds: read(PARAMS.assigneeIds),
  }
}

/** Writes filters into a copy of `params`, leaving unrelated keys intact. */
export function filtersToParams(f: ContentFilters, params: URLSearchParams = new URLSearchParams()): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const [field, key] of Object.entries(PARAMS) as [keyof ContentFilters, string][]) {
    const values = f[field]
    if (values.length) next.set(key, values.join(','))
    else next.delete(key)
  }
  return next
}
