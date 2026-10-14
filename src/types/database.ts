/**
 * Database types for the Supabase client.
 *
 * Hand-maintained to match supabase/migrations. When connected to a project
 * you can regenerate with:
 *   npx supabase gen types typescript --linked > src/types/database.generated.ts
 * and compare.
 */

export type WorkspaceRole = 'admin' | 'editor' | 'viewer'
export type MemberStatus = 'active' | 'deactivated'
export type InvitationStatus = 'pending' | 'accepted' | 'revoked'
export type ContentStatus =
  | 'planned'
  | 'in_production'
  | 'for_review'
  | 'needs_revision'
  | 'approved'
  | 'published'
  | 'cancelled'
export type PlanStatus = 'draft' | 'in_review' | 'approved' | 'archived'
export type AssetKind = 'image' | 'video' | 'design' | 'document' | 'link'
export type CalendarView = 'month' | 'week' | 'two_week'
export type KeyDateKind = 'holiday' | 'observance' | 'campaign' | 'other'

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Profile = {
  id: string
  email: string
  full_name: string
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export type Workspace = {
  id: string
  name: string
  logo_path: string | null
  timezone: string
  default_calendar_view: CalendarView
  default_platforms: string[]
  editors_can_edit_all: boolean
  editors_can_duplicate_plans: boolean
  is_demo: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export type WorkspaceMember = {
  id: string
  workspace_id: string
  user_id: string
  role: WorkspaceRole
  status: MemberStatus
  invited_by: string | null
  joined_at: string
  deactivated_at: string | null
  deactivated_by: string | null
  created_at: string
  updated_at: string
}

export type Invitation = {
  id: string
  workspace_id: string
  email: string
  role: WorkspaceRole
  status: InvitationStatus
  invited_by: string | null
  expires_at: string
  accepted_at: string | null
  accepted_by: string | null
  revoked_at: string | null
  revoked_by: string | null
  created_at: string
  updated_at: string
}

export type Brand = {
  id: string
  workspace_id: string
  name: string
  description: string | null
  notes: string | null
  logo_path: string | null
  is_active: boolean
  is_demo: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export type ConfigItem = {
  id: string
  workspace_id: string
  name: string
  color: string
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}
export type ContentFormat = ConfigItem
export type ContentPillar = ConfigItem

export type MonthlyPlan = {
  id: string
  workspace_id: string
  brand_id: string
  year: number
  month: number
  title: string
  status: PlanStatus
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type ContentItem = {
  id: string
  workspace_id: string
  monthly_plan_id: string | null
  brand_id: string
  title: string
  platforms: string[]
  format_id: string
  pillar_id: string | null
  caption: string | null
  hashtags: string[]
  call_to_action: string | null
  purpose: string | null
  target_audience: string | null
  creative_brief: string | null
  reference_urls: string[]
  scheduled_date: string | null
  scheduled_time: string | null
  deadline_date: string | null
  status: ContentStatus
  assigned_to: string | null
  internal_notes: string | null
  approved_at: string | null
  approved_by: string | null
  published_at: string | null
  published_url: string | null
  publication_notes: string | null
  source_item_id: string | null
  search_text: string
  is_demo: boolean
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  deleted_by: string | null
}

export type ContentAsset = {
  id: string
  workspace_id: string
  content_id: string
  kind: AssetKind
  label: string | null
  storage_path: string | null
  external_url: string | null
  file_name: string | null
  mime_type: string | null
  size_bytes: number | null
  created_by: string | null
  created_at: string
}

export type ContentActivity = {
  id: number
  workspace_id: string
  content_id: string | null
  content_title: string | null
  actor_id: string | null
  action: string
  details: Record<string, unknown>
  created_at: string
}

export type WorkspaceAudit = {
  id: number
  workspace_id: string
  actor_id: string | null
  entity_type: string
  entity_id: string | null
  action: string
  details: Record<string, unknown>
  created_at: string
}

export type BrandEditor = {
  id: string
  workspace_id: string
  brand_id: string
  user_id: string
  created_by: string | null
  created_at: string
}

export type KeyDate = {
  id: string
  workspace_id: string
  date: string
  name: string
  kind: KeyDateKind
  region: string | null
  notes: string | null
  is_demo: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export type DuplicatePreviewRow = {
  source_item_id: string
  title: string
  format_id: string
  source_date: string | null
  target_date: string | null
  outcome:
    | 'copy'
    | 'copy_unscheduled'
    | 'moved_to_last_day'
    | 'moved_to_unscheduled'
    | 'skipped_missing_date'
    | 'skipped_inactive_format'
  is_weekend: boolean
  key_dates: string | null
  target_plan_id: string | null
  new_item_id: string | null
}

type ContentInsertKeys =
  | 'id'
  | 'workspace_id'
  | 'monthly_plan_id'
  | 'brand_id'
  | 'title'
  | 'platforms'
  | 'format_id'
  | 'pillar_id'
  | 'caption'
  | 'hashtags'
  | 'call_to_action'
  | 'purpose'
  | 'target_audience'
  | 'creative_brief'
  | 'reference_urls'
  | 'scheduled_date'
  | 'scheduled_time'
  | 'deadline_date'
  | 'status'
  | 'assigned_to'
  | 'internal_notes'
  | 'published_at'
  | 'published_url'
  | 'publication_notes'
  | 'source_item_id'

export type ContentInsert = Partial<Pick<ContentItem, ContentInsertKeys>> &
  Pick<ContentItem, 'workspace_id' | 'brand_id' | 'title' | 'format_id'>
export type ContentUpdate = Partial<Pick<ContentItem, Exclude<ContentInsertKeys, 'id' | 'workspace_id' | 'source_item_id'> | 'deleted_at'>>

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: {
    foreignKeyName: string
    columns: string[]
    isOneToOne?: boolean
    referencedRelation: string
    referencedColumns: string[]
  }[]
}

export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile, Partial<Profile>, Partial<Pick<Profile, 'full_name' | 'avatar_url'>>>
      workspaces: Table<Workspace>
      workspace_members: {
        Row: WorkspaceMember
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'workspace_members_workspace_id_fkey'
            columns: ['workspace_id']
            isOneToOne: false
            referencedRelation: 'workspaces'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workspace_members_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      invitations: Table<Invitation, never, never>
      brands: Table<Brand, Partial<Brand> & Pick<Brand, 'workspace_id' | 'name'>>
      content_formats: Table<ConfigItem, Partial<ConfigItem> & Pick<ConfigItem, 'workspace_id' | 'name' | 'color'>>
      content_pillars: Table<ConfigItem, Partial<ConfigItem> & Pick<ConfigItem, 'workspace_id' | 'name' | 'color'>>
      monthly_plans: Table<
        MonthlyPlan,
        Partial<MonthlyPlan> & Pick<MonthlyPlan, 'workspace_id' | 'brand_id' | 'year' | 'month' | 'title'>
      >
      content_items: Table<ContentItem, ContentInsert, ContentUpdate>
      content_assets: Table<
        ContentAsset,
        Partial<ContentAsset> & Pick<ContentAsset, 'workspace_id' | 'content_id' | 'kind'>,
        never
      >
      content_activity: Table<ContentActivity, never, never>
      workspace_audit: Table<WorkspaceAudit, never, never>
      key_dates: Table<KeyDate, Partial<KeyDate> & Pick<KeyDate, 'workspace_id' | 'date' | 'name'>>
      brand_editors: Table<BrandEditor, Pick<BrandEditor, 'workspace_id' | 'brand_id' | 'user_id'>, never>
    }
    Views: { [_ in never]: never }
    Functions: {
      get_setup_status: { Args: Record<string, never>; Returns: Json }
      create_invitation: {
        Args: { p_workspace_id: string; p_email: string; p_role: WorkspaceRole }
        Returns: { invitation_id: string; token: string; expires_at: string; email: string; user_exists: boolean }[]
      }
      revoke_invitation: { Args: { p_invitation_id: string }; Returns: undefined }
      get_invitation: {
        Args: { p_token: string }
        Returns: {
          state: 'valid' | 'invalid' | 'expired' | 'accepted' | 'revoked' | 'email_mismatch'
          workspace_name: string | null
          role: WorkspaceRole | null
          expires_at: string | null
        }[]
      }
      accept_invitation: { Args: { p_token: string }; Returns: string }
      update_member_role: { Args: { p_member_id: string; p_role: WorkspaceRole }; Returns: undefined }
      set_member_status: { Args: { p_member_id: string; p_status: MemberStatus }; Returns: undefined }
      duplicate_monthly_plan: {
        Args: {
          p_source_plan_id: string
          p_target_brand_id: string
          p_target_year: number
          p_target_month: number
          p_copy_mode: 'full' | 'structure'
          p_include_unscheduled: boolean
          p_missing_date_strategy: 'last_day' | 'skip' | 'unscheduled'
          p_dry_run: boolean
          p_target_title?: string | null
        }
        Returns: DuplicatePreviewRow[]
      }
    }
    Enums: {
      workspace_role: WorkspaceRole
      member_status: MemberStatus
      invitation_status: InvitationStatus
      content_status: ContentStatus
      plan_status: PlanStatus
      asset_kind: AssetKind
      calendar_view: CalendarView
      key_date_kind: KeyDateKind
    }
    CompositeTypes: { [_ in never]: never }
  }
}
