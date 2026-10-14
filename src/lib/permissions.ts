/**
 * UI permission checks. These only decide what to show — the database
 * (RLS, column grants and SECURITY DEFINER functions) is the real boundary.
 * Keep in sync with supabase/migrations/20261013000300_rls_policies.sql.
 */
import type { ContentItem, Workspace, WorkspaceRole } from '@/types/database'

export type Permission =
  | 'content.create'
  | 'content.changeStatus'
  | 'content.assign'
  | 'content.deletePermanently'
  | 'content.reuse'
  | 'plans.manage'
  | 'brands.manage'
  | 'config.manage'
  | 'team.manage'
  | 'settings.manage'
  | 'audit.view'
  | 'export'

const MATRIX: Record<Permission, readonly WorkspaceRole[]> = {
  'content.create': ['admin', 'editor'],
  'content.changeStatus': ['admin', 'editor'],
  // Mirrors the content_items_assignment_guard trigger (migrations 800/900).
  'content.assign': ['admin'],
  'content.deletePermanently': ['admin'],
  'content.reuse': ['admin', 'editor'],
  'plans.manage': ['admin', 'editor'],
  'brands.manage': ['admin'],
  'config.manage': ['admin'],
  'team.manage': ['admin'],
  'settings.manage': ['admin'],
  'audit.view': ['admin'],
  export: ['admin', 'editor', 'viewer'],
}

export function can(role: WorkspaceRole | null | undefined, permission: Permission): boolean {
  return !!role && MATRIX[permission].includes(role)
}

/**
 * Mirrors public.can_edit_content (migration 900): administrators edit
 * everything; editors edit only content assigned to them.
 * The workspace argument is kept for call-site compatibility and unused.
 */
export function canEditContent(
  role: WorkspaceRole | null | undefined,
  _workspace: Pick<Workspace, 'editors_can_edit_all'> | null | undefined,
  item: Pick<ContentItem, 'created_by' | 'assigned_to'> | null | undefined,
  userId: string | null | undefined,
): boolean {
  if (role === 'admin') return true
  if (role !== 'editor') return false
  if (!item) return true
  return !!userId && item.assigned_to === userId
}

export function canDuplicatePlans(
  role: WorkspaceRole | null | undefined,
  workspace: Pick<Workspace, 'editors_can_duplicate_plans'> | null | undefined,
): boolean {
  if (role === 'admin') return true
  return role === 'editor' && !!workspace?.editors_can_duplicate_plans
}

export const ROLE_LABEL: Record<WorkspaceRole, string> = {
  admin: 'Administrator',
  editor: 'Editor',
  viewer: 'Viewer',
}
