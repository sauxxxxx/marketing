-- =============================================================================
-- Row Level Security and privileges.
--
-- Supabase grants broad default privileges on the public schema to the anon
-- and authenticated roles. We revoke them and grant back only what each
-- table needs, then layer RLS on top. Column-level grants stop clients from
-- writing columns owned by triggers (approval stamps, created_by, …) and
-- stop anyone from writing membership roles directly.
-- =============================================================================

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
-- Function EXECUTE privileges are set in 20261013000600_function_privileges.sql.

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.system_state enable row level security;
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.invitations enable row level security;
alter table public.brands enable row level security;
alter table public.content_formats enable row level security;
alter table public.content_pillars enable row level security;
alter table public.monthly_plans enable row level security;
alter table public.content_items enable row level security;
alter table public.content_assets enable row level security;
alter table public.content_activity enable row level security;
alter table public.workspace_audit enable row level security;
alter table public.key_dates enable row level security;

-- system_state: no API access at all (read through get_setup_status()).

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
grant select on public.profiles to authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.shares_workspace_with(id));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- workspaces
-- ---------------------------------------------------------------------------
grant select on public.workspaces to authenticated;
grant update (
  name, logo_path, timezone, default_calendar_view, default_platforms,
  editors_can_edit_all, editors_can_duplicate_plans
) on public.workspaces to authenticated;

create policy workspaces_select on public.workspaces
  for select to authenticated
  using (public.is_workspace_member(id));

create policy workspaces_update_admin on public.workspaces
  for update to authenticated
  using (public.has_workspace_role(id, array['admin']::public.workspace_role[]))
  with check (public.has_workspace_role(id, array['admin']::public.workspace_role[]));

-- ---------------------------------------------------------------------------
-- workspace_members — read for members; writes only through RPCs.
-- ---------------------------------------------------------------------------
grant select on public.workspace_members to authenticated;

create policy workspace_members_select on public.workspace_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- invitations — administrators only; writes through RPCs.
-- token_hash is not granted, so it is never readable through the API.
-- ---------------------------------------------------------------------------
grant select (
  id, workspace_id, email, role, status, invited_by, expires_at,
  accepted_at, accepted_by, revoked_at, revoked_by, created_at, updated_at
) on public.invitations to authenticated;

create policy invitations_select_admin on public.invitations
  for select to authenticated
  using (public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]));

-- ---------------------------------------------------------------------------
-- brands, formats, pillars, key dates — read for members, write for admins
-- ---------------------------------------------------------------------------
grant select, delete on public.brands to authenticated;
grant insert (workspace_id, name, description, notes, logo_path, is_active) on public.brands to authenticated;
grant update (name, description, notes, logo_path, is_active) on public.brands to authenticated;

create policy brands_select on public.brands
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy brands_insert on public.brands
  for insert to authenticated
  with check (public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]));
create policy brands_update on public.brands
  for update to authenticated
  using (public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]))
  with check (public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]));
create policy brands_delete on public.brands
  for delete to authenticated
  using (public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]));

grant select, delete on public.content_formats, public.content_pillars to authenticated;
grant insert (workspace_id, name, color, sort_order, is_active) on public.content_formats, public.content_pillars to authenticated;
grant update (name, color, sort_order, is_active) on public.content_formats, public.content_pillars to authenticated;

create policy content_formats_select on public.content_formats
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy content_formats_insert on public.content_formats
  for insert to authenticated
  with check (public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]));
create policy content_formats_update on public.content_formats
  for update to authenticated
  using (public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]))
  with check (public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]));
-- Referenced formats cannot be deleted: the content_items foreign key restricts it.
create policy content_formats_delete on public.content_formats
  for delete to authenticated
  using (public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]));

create policy content_pillars_select on public.content_pillars
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy content_pillars_insert on public.content_pillars
  for insert to authenticated
  with check (public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]));
create policy content_pillars_update on public.content_pillars
  for update to authenticated
  using (public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]))
  with check (public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]));
create policy content_pillars_delete on public.content_pillars
  for delete to authenticated
  using (public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]));

grant select, delete on public.key_dates to authenticated;
grant insert (workspace_id, date, name, kind, region, notes) on public.key_dates to authenticated;
grant update (date, name, kind, region, notes) on public.key_dates to authenticated;

create policy key_dates_select on public.key_dates
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy key_dates_insert on public.key_dates
  for insert to authenticated
  with check (public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]));
create policy key_dates_update on public.key_dates
  for update to authenticated
  using (public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]))
  with check (public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]));
create policy key_dates_delete on public.key_dates
  for delete to authenticated
  using (public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]));

-- ---------------------------------------------------------------------------
-- monthly_plans — members read; admins and editors create and update.
-- Plans are archived, never deleted.
-- ---------------------------------------------------------------------------
grant select on public.monthly_plans to authenticated;
grant insert (workspace_id, brand_id, year, month, title, status, notes) on public.monthly_plans to authenticated;
grant update (title, status, notes) on public.monthly_plans to authenticated;

create policy monthly_plans_select on public.monthly_plans
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy monthly_plans_insert on public.monthly_plans
  for insert to authenticated
  with check (public.has_workspace_role(workspace_id, array['admin', 'editor']::public.workspace_role[]));
create policy monthly_plans_update on public.monthly_plans
  for update to authenticated
  using (public.has_workspace_role(workspace_id, array['admin', 'editor']::public.workspace_role[]))
  with check (public.has_workspace_role(workspace_id, array['admin', 'editor']::public.workspace_role[]));

-- ---------------------------------------------------------------------------
-- content_items
-- ---------------------------------------------------------------------------
grant select, delete on public.content_items to authenticated;
grant insert (
  id, workspace_id, monthly_plan_id, brand_id, title, platforms, format_id, pillar_id,
  caption, hashtags, call_to_action, purpose, target_audience, creative_brief, reference_urls,
  scheduled_date, scheduled_time, deadline_date, status, assigned_to, internal_notes,
  published_at, published_url, publication_notes, source_item_id
) on public.content_items to authenticated;
grant update (
  monthly_plan_id, brand_id, title, platforms, format_id, pillar_id,
  caption, hashtags, call_to_action, purpose, target_audience, creative_brief, reference_urls,
  scheduled_date, scheduled_time, deadline_date, status, assigned_to, internal_notes,
  published_at, published_url, publication_notes, deleted_at
) on public.content_items to authenticated;

create policy content_items_select on public.content_items
  for select to authenticated using (public.is_workspace_member(workspace_id));

create policy content_items_insert on public.content_items
  for insert to authenticated
  with check (
    public.has_workspace_role(workspace_id, array['admin', 'editor']::public.workspace_role[])
    and created_by = auth.uid()
  );

create policy content_items_update on public.content_items
  for update to authenticated
  using (public.can_edit_content(workspace_id, created_by, assigned_to))
  with check (public.can_edit_content(workspace_id, created_by, assigned_to));

-- Permanent deletion is reserved for administrators (archive is the norm).
create policy content_items_delete on public.content_items
  for delete to authenticated
  using (public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]));

-- ---------------------------------------------------------------------------
-- content_assets — follow the parent content's edit rights
-- ---------------------------------------------------------------------------
grant select, delete on public.content_assets to authenticated;
grant insert (
  workspace_id, content_id, kind, label, storage_path, external_url, file_name, mime_type, size_bytes
) on public.content_assets to authenticated;

create policy content_assets_select on public.content_assets
  for select to authenticated using (public.is_workspace_member(workspace_id));

create policy content_assets_insert on public.content_assets
  for insert to authenticated
  with check (exists (
    select 1 from public.content_items c
    where c.id = content_id
      and c.workspace_id = content_assets.workspace_id
      and public.can_edit_content(c.workspace_id, c.created_by, c.assigned_to)
  ));

create policy content_assets_delete on public.content_assets
  for delete to authenticated
  using (exists (
    select 1 from public.content_items c
    where c.id = content_id
      and c.workspace_id = content_assets.workspace_id
      and public.can_edit_content(c.workspace_id, c.created_by, c.assigned_to)
  ));

-- ---------------------------------------------------------------------------
-- Activity and audit — read only; written by triggers.
-- ---------------------------------------------------------------------------
grant select on public.content_activity to authenticated;
create policy content_activity_select on public.content_activity
  for select to authenticated using (public.is_workspace_member(workspace_id));

grant select on public.workspace_audit to authenticated;
create policy workspace_audit_select_admin on public.workspace_audit
  for select to authenticated
  using (public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]));
