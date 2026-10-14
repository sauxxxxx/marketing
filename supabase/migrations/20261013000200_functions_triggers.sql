-- =============================================================================
-- Helper functions, validation triggers, status workflow and audit logging.
--
-- All SECURITY DEFINER functions pin search_path to '' and fully qualify
-- every object, so they cannot be hijacked through a malicious search_path.
-- Errors raised for users use SQLSTATE P0001 (validation) or 42501
-- (permission) with messages that are safe to show in the interface.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create function public.try_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_value::uuid;
exception when others then
  return null;
end;
$$;

create function public.allowed_platforms()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'Facebook', 'Instagram', 'TikTok', 'LinkedIn', 'YouTube', 'X', 'Threads',
    'Pinterest', 'Google Business Profile', 'Website', 'Email', 'Other'
  ]::text[];
$$;

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Role helpers used by RLS policies. They read membership as the definer so
-- policies on workspace_members itself do not recurse.
-- ---------------------------------------------------------------------------
create function public.current_member_role(p_workspace uuid)
returns public.workspace_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.workspace_members m
  where m.workspace_id = p_workspace
    and m.user_id = auth.uid()
    and m.status = 'active';
$$;

create function public.is_workspace_member(p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_member_role(p_workspace) is not null;
$$;

create function public.has_workspace_role(p_workspace uuid, p_roles public.workspace_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_member_role(p_workspace) = any (p_roles), false);
$$;

-- Workspace editing rule: admins edit everything; editors edit everything when
-- editors_can_edit_all is on, otherwise only content they created or own.
create function public.can_edit_content(p_workspace uuid, p_created_by uuid, p_assigned_to uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case public.current_member_role(p_workspace)
      when 'admin' then true
      when 'editor' then (
        (select w.editors_can_edit_all from public.workspaces w where w.id = p_workspace)
        or p_created_by = auth.uid()
        or p_assigned_to = auth.uid()
      )
      else false
    end,
    false
  );
$$;

create function public.can_duplicate_plans(p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case public.current_member_role(p_workspace)
      when 'admin' then true
      when 'editor' then (select w.editors_can_duplicate_plans from public.workspaces w where w.id = p_workspace)
      else false
    end,
    false
  );
$$;

create function public.shares_workspace_with(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members mine
    join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
    where mine.user_id = auth.uid()
      and mine.status = 'active'
      and theirs.user_id = p_user
  );
$$;

-- ---------------------------------------------------------------------------
-- Status transition policy (mirrored in src/lib/status.ts and tested to match)
--
--   planned        → in_production, cancelled
--   in_production  → for_review, planned, cancelled
--   for_review     → approved, needs_revision, in_production, cancelled
--   needs_revision → in_production, for_review, cancelled
--   approved       → published, needs_revision, cancelled
--   published      → approved            (reopen — administrators only)
--   cancelled      → planned             (reopen — administrators and editors)
--
-- Viewers can never change status.
-- ---------------------------------------------------------------------------
create function public.is_status_transition_allowed(
  p_from public.content_status,
  p_to public.content_status,
  p_role public.workspace_role
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_role is null or p_role = 'viewer' then false
    when p_from = p_to then true
    when p_from = 'published' and p_to = 'approved' then p_role = 'admin'
    when p_from = 'cancelled' and p_to = 'planned' then true
    when (p_from::text, p_to::text) in (
      ('planned', 'in_production'), ('planned', 'cancelled'),
      ('in_production', 'for_review'), ('in_production', 'planned'), ('in_production', 'cancelled'),
      ('for_review', 'approved'), ('for_review', 'needs_revision'), ('for_review', 'in_production'), ('for_review', 'cancelled'),
      ('needs_revision', 'in_production'), ('needs_revision', 'for_review'), ('needs_revision', 'cancelled'),
      ('approved', 'published'), ('approved', 'needs_revision'), ('approved', 'cancelled')
    ) then true
    else false
  end;
$$;

create function public.status_label(p_status public.content_status)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'planned' then 'Planned'
    when 'in_production' then 'In Production'
    when 'for_review' then 'For Review'
    when 'needs_revision' then 'Needs Revision'
    when 'approved' then 'Approved'
    when 'published' then 'Published'
    when 'cancelled' then 'Cancelled'
  end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles are created from auth.users; email is kept in sync.
-- ---------------------------------------------------------------------------
create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create function public.handle_auth_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = lower(coalesce(new.email, '')) where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_auth_user_email_change();

-- Email sync runs as the definer and must be allowed through; only block email
-- changes coming from API roles (column grants also exclude email).
create function public.profiles_guard_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.email := old.email;
  end if;
  new.id := old.id;
  new.created_at := old.created_at;
  new.full_name := btrim(new.full_name);
  return new;
end;
$$;

create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard_email();
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Workspaces
-- ---------------------------------------------------------------------------
create function public.workspaces_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception using errcode = 'P0001', message = 'Choose a valid timezone.';
  end if;
  if not (new.default_platforms <@ public.allowed_platforms()) then
    raise exception using errcode = 'P0001', message = 'One or more default platforms are not supported.';
  end if;
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.is_demo := old.is_demo;
  end if;
  return new;
end;
$$;

create trigger workspaces_validate
  before insert or update on public.workspaces
  for each row execute function public.workspaces_before_write();
create trigger workspaces_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

create trigger workspace_members_updated_at
  before update on public.workspace_members
  for each row execute function public.set_updated_at();
create trigger invitations_updated_at
  before update on public.invitations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Brands, formats, pillars, key dates
-- ---------------------------------------------------------------------------
create function public.stamp_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.workspace_id := old.workspace_id;
  end if;
  return new;
end;
$$;

create function public.config_item_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  new.color := lower(new.color);
  if tg_op = 'UPDATE' then
    new.workspace_id := old.workspace_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger brands_stamp before insert or update on public.brands
  for each row execute function public.stamp_created_by();
create trigger brands_updated_at before update on public.brands
  for each row execute function public.set_updated_at();

create trigger content_formats_validate before insert or update on public.content_formats
  for each row execute function public.config_item_before_write();
create trigger content_formats_updated_at before update on public.content_formats
  for each row execute function public.set_updated_at();

create trigger content_pillars_validate before insert or update on public.content_pillars
  for each row execute function public.config_item_before_write();
create trigger content_pillars_updated_at before update on public.content_pillars
  for each row execute function public.set_updated_at();

create trigger key_dates_stamp before insert or update on public.key_dates
  for each row execute function public.stamp_created_by();
create trigger key_dates_updated_at before update on public.key_dates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Monthly plans
-- ---------------------------------------------------------------------------
create function public.monthly_plans_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.title := btrim(new.title);
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
    if not exists (
      select 1 from public.brands b
      where b.id = new.brand_id and b.workspace_id = new.workspace_id and b.is_active
    ) then
      raise exception using errcode = 'P0001', message = 'Plans can only be created for an active brand.';
    end if;
  else
    if new.brand_id <> old.brand_id or new.year <> old.year or new.month <> old.month
       or new.workspace_id <> old.workspace_id then
      raise exception using errcode = 'P0001',
        message = 'A plan''s brand and month cannot be changed. Duplicate the plan instead.';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger monthly_plans_validate before insert or update on public.monthly_plans
  for each row execute function public.monthly_plans_before_write();
create trigger monthly_plans_updated_at before update on public.monthly_plans
  for each row execute function public.set_updated_at();

-- Attach already-scheduled content for the brand/month to a newly created plan.
create function public.monthly_plans_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.content_items c
     set monthly_plan_id = new.id
   where c.workspace_id = new.workspace_id
     and c.brand_id = new.brand_id
     and c.monthly_plan_id is null
     and c.scheduled_date >= make_date(new.year, new.month, 1)
     and c.scheduled_date < (make_date(new.year, new.month, 1) + interval '1 month')::date;
  return null;
end;
$$;

create trigger monthly_plans_attach_content after insert on public.monthly_plans
  for each row execute function public.monthly_plans_after_insert();

-- ---------------------------------------------------------------------------
-- Content items: integrity, workflow stamping, plan linkage
-- ---------------------------------------------------------------------------
create function public.content_items_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.workspace_role;
  v_plan_id uuid;
begin
  new.title := btrim(new.title);

  if tg_op = 'INSERT' then
    if v_uid is not null then
      new.created_by := v_uid;
    end if;
    new.updated_by := coalesce(v_uid, new.created_by);
    new.deleted_at := null;
    new.deleted_by := null;
    new.approved_at := null;
    new.approved_by := null;
    if new.status in ('approved', 'published') then
      new.approved_at := now();
      new.approved_by := v_uid;
    end if;
    if new.status = 'published' and new.published_at is null then
      new.published_at := now();
    end if;
  else
    if new.workspace_id <> old.workspace_id then
      raise exception using errcode = 'P0001', message = 'Content cannot be moved to another workspace.';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := coalesce(v_uid, new.updated_by);
    -- Approval stamps are owned by this trigger.
    new.approved_at := old.approved_at;
    new.approved_by := old.approved_by;

    if new.status is distinct from old.status then
      if v_uid is not null then
        v_role := public.current_member_role(new.workspace_id);
        if not public.is_status_transition_allowed(old.status, new.status, v_role) then
          raise exception using errcode = 'P0001', message = format(
            'Status cannot change from %s to %s.',
            public.status_label(old.status), public.status_label(new.status)
          );
        end if;
      end if;

      if new.status = 'approved' and old.status <> 'published' then
        new.approved_at := now();
        new.approved_by := v_uid;
      elsif new.status not in ('approved', 'published') then
        new.approved_at := null;
        new.approved_by := null;
      end if;

      if new.status = 'published' and new.published_at is null then
        new.published_at := now();
      end if;
    end if;

    -- Archive / restore stamps
    if new.deleted_at is not null and old.deleted_at is null then
      new.deleted_at := now();
      new.deleted_by := v_uid;
    elsif new.deleted_at is null then
      new.deleted_by := null;
    else
      new.deleted_at := old.deleted_at;
      new.deleted_by := old.deleted_by;
    end if;
  end if;

  -- Referenced configuration must be active when newly chosen.
  if tg_op = 'INSERT' or new.brand_id is distinct from old.brand_id then
    if not exists (select 1 from public.brands b where b.id = new.brand_id and b.workspace_id = new.workspace_id and b.is_active) then
      raise exception using errcode = 'P0001', message = 'Choose an active brand.';
    end if;
  end if;
  if tg_op = 'INSERT' or new.format_id is distinct from old.format_id then
    if not exists (select 1 from public.content_formats f where f.id = new.format_id and f.workspace_id = new.workspace_id and f.is_active) then
      raise exception using errcode = 'P0001', message = 'Choose an active content format.';
    end if;
  end if;
  if new.pillar_id is not null and (tg_op = 'INSERT' or new.pillar_id is distinct from old.pillar_id) then
    if not exists (select 1 from public.content_pillars p where p.id = new.pillar_id and p.workspace_id = new.workspace_id and p.is_active) then
      raise exception using errcode = 'P0001', message = 'Choose an active content pillar.';
    end if;
  end if;

  -- Assignees must be active administrators or editors of this workspace.
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    if not exists (
      select 1 from public.workspace_members m
      where m.workspace_id = new.workspace_id
        and m.user_id = new.assigned_to
        and m.status = 'active'
        and m.role in ('admin', 'editor')
    ) then
      raise exception using errcode = 'P0001', message = 'Content can only be assigned to an active administrator or editor.';
    end if;
  end if;

  -- Scheduled content belongs to the plan for its brand and month (if any).
  -- Unscheduled ideas may stay parked in a plan of the same brand.
  if new.scheduled_date is not null then
    select p.id into v_plan_id
    from public.monthly_plans p
    where p.workspace_id = new.workspace_id
      and p.brand_id = new.brand_id
      and p.year = extract(year from new.scheduled_date)::int
      and p.month = extract(month from new.scheduled_date)::int;
    new.monthly_plan_id := v_plan_id;
  elsif new.monthly_plan_id is not null then
    if not exists (
      select 1 from public.monthly_plans p
      where p.id = new.monthly_plan_id and p.workspace_id = new.workspace_id and p.brand_id = new.brand_id
    ) then
      new.monthly_plan_id := null;
    end if;
  end if;

  return new;
end;
$$;

create trigger content_items_validate before insert or update on public.content_items
  for each row execute function public.content_items_before_write();
create trigger content_items_updated_at before update on public.content_items
  for each row execute function public.set_updated_at();

-- Activity history for content.
create function public.content_items_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_changed text[];
begin
  if tg_op = 'INSERT' then
    insert into public.content_activity (workspace_id, content_id, content_title, actor_id, action, details)
    values (
      new.workspace_id, new.id, new.title, v_uid,
      case when new.source_item_id is not null then 'duplicated' else 'created' end,
      jsonb_strip_nulls(jsonb_build_object(
        'status', new.status,
        'scheduled_date', new.scheduled_date,
        'source_item_id', new.source_item_id
      ))
    );
    return null;
  end if;

  if new.status is distinct from old.status then
    insert into public.content_activity (workspace_id, content_id, content_title, actor_id, action, details)
    values (new.workspace_id, new.id, new.title, v_uid,
      case
        when new.status = 'approved' and old.status <> 'published' then 'approved'
        when new.status = 'published' then 'published'
        when (old.status = 'published' and new.status = 'approved')
          or (old.status = 'cancelled' and new.status = 'planned') then 'reopened'
        else 'status_changed'
      end,
      jsonb_build_object('from', old.status, 'to', new.status));
  end if;

  if new.scheduled_date is distinct from old.scheduled_date or new.scheduled_time is distinct from old.scheduled_time then
    insert into public.content_activity (workspace_id, content_id, content_title, actor_id, action, details)
    values (new.workspace_id, new.id, new.title, v_uid, 'rescheduled',
      jsonb_build_object(
        'from_date', old.scheduled_date, 'to_date', new.scheduled_date,
        'from_time', old.scheduled_time, 'to_time', new.scheduled_time));
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    insert into public.content_activity (workspace_id, content_id, content_title, actor_id, action, details)
    values (new.workspace_id, new.id, new.title, v_uid, 'assigned',
      jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to));
  end if;

  if new.deleted_at is not null and old.deleted_at is null then
    insert into public.content_activity (workspace_id, content_id, content_title, actor_id, action)
    values (new.workspace_id, new.id, new.title, v_uid, 'archived');
  elsif new.deleted_at is null and old.deleted_at is not null then
    insert into public.content_activity (workspace_id, content_id, content_title, actor_id, action)
    values (new.workspace_id, new.id, new.title, v_uid, 'restored');
  end if;

  select array_agg(n.key order by n.key) into v_changed
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o on o.key = n.key
  where n.value is distinct from o.value
    and n.key not in (
      'id', 'workspace_id', 'status', 'scheduled_date', 'scheduled_time', 'assigned_to',
      'deleted_at', 'deleted_by', 'updated_at', 'updated_by', 'approved_at', 'approved_by',
      'monthly_plan_id', 'created_at', 'created_by'
    )
    -- published_at is stamped automatically when the status becomes Published.
    and not (n.key = 'published_at' and new.status is distinct from old.status);

  if v_changed is not null then
    insert into public.content_activity (workspace_id, content_id, content_title, actor_id, action, details)
    values (new.workspace_id, new.id, new.title, v_uid, 'updated', jsonb_build_object('fields', to_jsonb(v_changed)));
  end if;

  return null;
end;
$$;

create trigger content_items_activity after insert or update on public.content_items
  for each row execute function public.content_items_after_write();

-- ---------------------------------------------------------------------------
-- Content assets
-- ---------------------------------------------------------------------------
create function public.content_assets_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  if new.storage_path is not null
     and left(new.storage_path, length(new.workspace_id::text || '/content/' || new.content_id::text || '/'))
         <> new.workspace_id::text || '/content/' || new.content_id::text || '/' then
    raise exception using errcode = 'P0001', message = 'The file path does not belong to this content item.';
  end if;
  return new;
end;
$$;

create trigger content_assets_validate before insert on public.content_assets
  for each row execute function public.content_assets_before_insert();

create function public.content_assets_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.content_assets;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  -- Skip when the parent content is being deleted (cascade).
  if not exists (select 1 from public.content_items c where c.id = v_row.content_id) then
    return null;
  end if;
  insert into public.content_activity (workspace_id, content_id, actor_id, action, details)
  values (
    v_row.workspace_id, v_row.content_id, auth.uid(),
    case when tg_op = 'DELETE' then 'asset_removed' else 'asset_added' end,
    jsonb_strip_nulls(jsonb_build_object('kind', v_row.kind, 'name', coalesce(v_row.label, v_row.file_name, v_row.external_url)))
  );
  return null;
end;
$$;

create trigger content_assets_log after insert or delete on public.content_assets
  for each row execute function public.content_assets_activity();

-- ---------------------------------------------------------------------------
-- Workspace audit trail (membership, invitations, configuration, plans)
-- ---------------------------------------------------------------------------
create function public.workspace_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity text := tg_argv[0];
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_action text;
  v_details jsonb := '{}'::jsonb;
  v_changed text[];
  v_workspace uuid;
begin
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into v_changed
    from jsonb_each(v_new) n join jsonb_each(v_old) o on o.key = n.key
    where n.value is distinct from o.value and n.key not in ('updated_at');
    if v_changed is null then
      return null;
    end if;
    v_details := jsonb_build_object('fields', to_jsonb(v_changed));
  end if;

  v_action := v_entity || '_' || lower(case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end);

  if v_entity = 'member' then
    if tg_op = 'INSERT' then
      v_action := 'member_joined';
      v_details := jsonb_build_object('user_id', v_row ->> 'user_id', 'role', v_row ->> 'role');
    elsif (v_old ->> 'status') <> (v_new ->> 'status') then
      v_action := case when v_new ->> 'status' = 'deactivated' then 'member_deactivated' else 'member_reactivated' end;
      v_details := jsonb_build_object('user_id', v_row ->> 'user_id', 'role', v_new ->> 'role');
    elsif (v_old ->> 'role') <> (v_new ->> 'role') then
      v_action := 'member_role_changed';
      v_details := jsonb_build_object('user_id', v_row ->> 'user_id', 'from', v_old ->> 'role', 'to', v_new ->> 'role');
    end if;
  elsif v_entity = 'invitation' then
    v_details := jsonb_build_object('email', v_row ->> 'email', 'role', v_row ->> 'role');
    if tg_op = 'UPDATE' then
      if (v_old ->> 'status') = (v_new ->> 'status') then
        return null;
      end if;
      v_action := 'invitation_' || (v_new ->> 'status');
    end if;
  elsif v_entity in ('brand', 'format', 'pillar', 'plan', 'key_date') then
    v_details := v_details || jsonb_build_object('name', coalesce(v_row ->> 'name', v_row ->> 'title'));
  end if;

  v_workspace := case when v_entity = 'workspace' then (v_row ->> 'id')::uuid else (v_row ->> 'workspace_id')::uuid end;
  -- Nothing to record when the whole workspace is being deleted (cascade).
  if not exists (select 1 from public.workspaces w where w.id = v_workspace) then
    return null;
  end if;

  insert into public.workspace_audit (workspace_id, actor_id, entity_type, entity_id, action, details)
  values (v_workspace, auth.uid(), v_entity, (v_row ->> 'id')::uuid, v_action, v_details);
  return null;
end;
$$;

create trigger audit_workspace after update on public.workspaces
  for each row execute function public.workspace_audit_trigger('workspace');
create trigger audit_members after insert or update on public.workspace_members
  for each row execute function public.workspace_audit_trigger('member');
create trigger audit_invitations after insert or update on public.invitations
  for each row execute function public.workspace_audit_trigger('invitation');
create trigger audit_brands after insert or update or delete on public.brands
  for each row execute function public.workspace_audit_trigger('brand');
create trigger audit_formats after insert or update or delete on public.content_formats
  for each row execute function public.workspace_audit_trigger('format');
create trigger audit_pillars after insert or update or delete on public.content_pillars
  for each row execute function public.workspace_audit_trigger('pillar');
create trigger audit_plans after insert or update on public.monthly_plans
  for each row execute function public.workspace_audit_trigger('plan');
create trigger audit_key_dates after insert or update or delete on public.key_dates
  for each row execute function public.workspace_audit_trigger('key_date');

-- ---------------------------------------------------------------------------
-- Default configuration for a new workspace (formats + pillars)
-- ---------------------------------------------------------------------------
create function public.seed_workspace_defaults(p_workspace uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.content_formats (workspace_id, name, color, sort_order) values
    (p_workspace, 'Carousel', '#0e7490', 10),
    (p_workspace, 'Reel', '#c2410c', 20),
    (p_workspace, 'Static Post', '#7c3aed', 30),
    (p_workspace, 'Community Engagement', '#15803d', 40),
    (p_workspace, 'Other', '#64748b', 50)
  on conflict do nothing;

  insert into public.content_pillars (workspace_id, name, color, sort_order) values
    (p_workspace, 'Strategy', '#1e40af', 10),
    (p_workspace, 'Creative', '#be185d', 20),
    (p_workspace, 'Search', '#0369a1', 30),
    (p_workspace, 'Growth', '#3f6212', 40),
    (p_workspace, 'People', '#b45309', 50),
    (p_workspace, 'Web', '#4338ca', 60),
    (p_workspace, 'Community', '#0f766e', 70),
    (p_workspace, 'Paid Ads', '#b91c1c', 80),
    (p_workspace, 'Analytics', '#6d28d9', 90),
    (p_workspace, 'Leads', '#a16207', 100),
    (p_workspace, 'Planning', '#475569', 110)
  on conflict do nothing;
$$;
