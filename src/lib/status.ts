import type { ContentStatus, WorkspaceRole } from '@/types/database'

export const CONTENT_STATUSES = [
  'planned',
  'in_production',
  'for_review',
  'needs_revision',
  'approved',
  'published',
  'cancelled',
] as const satisfies readonly ContentStatus[]

export const STATUS_LABEL: Record<ContentStatus, string> = {
  planned: 'Planned',
  in_production: 'In Production',
  for_review: 'For Review',
  needs_revision: 'Needs Revision',
  approved: 'Approved',
  published: 'Published',
  cancelled: 'Cancelled',
}

/**
 * Status transition policy. Must match public.is_status_transition_allowed in
 * supabase/migrations/20261013000200_functions_triggers.sql — a database test
 * compares the two tables cell by cell.
 */
const STANDARD_TRANSITIONS: Record<ContentStatus, readonly ContentStatus[]> = {
  planned: ['in_production', 'cancelled'],
  in_production: ['for_review', 'planned', 'cancelled'],
  for_review: ['approved', 'needs_revision', 'in_production', 'cancelled'],
  needs_revision: ['in_production', 'for_review', 'cancelled'],
  approved: ['published', 'needs_revision', 'cancelled'],
  published: [],
  cancelled: [],
}

/** Reopening moves content back out of a terminal state and is logged as such. */
const REOPEN_TRANSITIONS: Record<ContentStatus, { to: ContentStatus; roles: readonly WorkspaceRole[] } | undefined> = {
  published: { to: 'approved', roles: ['admin'] },
  cancelled: { to: 'planned', roles: ['admin', 'editor'] },
  planned: undefined,
  in_production: undefined,
  for_review: undefined,
  needs_revision: undefined,
  approved: undefined,
}

export function canTransition(from: ContentStatus, to: ContentStatus, role: WorkspaceRole | null | undefined): boolean {
  if (!role || role === 'viewer') return false
  if (from === to) return true
  const reopen = REOPEN_TRANSITIONS[from]
  if (reopen && reopen.to === to) return reopen.roles.includes(role)
  return STANDARD_TRANSITIONS[from].includes(to)
}

export function isReopen(from: ContentStatus, to: ContentStatus): boolean {
  return REOPEN_TRANSITIONS[from]?.to === to
}

/** Next statuses offered in menus, standard path first, reopen last. */
export function nextStatuses(from: ContentStatus, role: WorkspaceRole | null | undefined): ContentStatus[] {
  return CONTENT_STATUSES.filter((to) => to !== from && canTransition(from, to, role))
}

export function transitionError(from: ContentStatus, to: ContentStatus): string {
  return `Status cannot change from ${STATUS_LABEL[from]} to ${STATUS_LABEL[to]}.`
}

/** Statuses considered "active work" for overdue checks. */
export const OPEN_STATUSES: readonly ContentStatus[] = ['planned', 'in_production', 'for_review', 'needs_revision', 'approved']
