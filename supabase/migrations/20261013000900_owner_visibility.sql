-- =============================================================================
-- Owner-based visibility and brand editors.
--
--   * Editors see and edit only content assigned to them.
--   * Editors are assigned to brands (brand_editors). They can create content
--     only in those brands, and can only be assigned content of those brands.
--   * Every post has an owner: new content defaults to its creator, and the
--     owner can be changed (never cleared) by administrators only.
--   * Administrators and viewers keep seeing everything.
--   * Activity, attachments and stored files follow the post's visibility.
--   * Editors see and manage monthly plans only for their brands.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- brand_editors
-- ---------------------------------------------------------------------------
create table public.brand_editors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid not null,
  user_id uuid not null,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (brand_id, user_id),
  foreign key (workspace_id, brand_id) references public.brands (workspace_id, id) on delete cascade,
  foreign key (workspace_id, user_id) references public.workspace_members (workspace_id, user_id) on delete cascade
);
create index brand_editors_user_idx on public.brand_editors (workspace_id, user_id);

create function public.brand_editors_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = new.workspace_id and m.user_id = new.user_id and m.role = 'editor'
  ) then
    raise exception using errcode = 'P0001', message = 'Only editors can be assigned to brands.';
  end if;
  return new;
end;
$$;

create trigger brand_editors_validate before insert on public.brand_editors
  for each row execute function public.brand_editors_before_insert();
create trigger audit_brand_editors after insert or delete on public.brand_editors
  for each row execute function public.workspace_audit_trigger('brand_editor');

alter table public.brand_editors enable row level security;
-- Drop Supabase's default grants; grant back only what is needed.
revoke all on public.brand_editors from anon, authenticated;
grant select, delete on public.brand_editors to authenticated;
grant insert (workspace_id, brand_id, user_id) on public.brand_editors to authenticated;

create policy brand_editors_select on public.brand_editors
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy brand_editors_insert on public.brand_editors
  for insert to authenticated
  with check (public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]));
create policy brand_editors_delete on public.brand_editors
  for delete to authenticated
  using (public.has_workspace_role(workspace_id, array['admin']::public.workspace_role[]));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function public.is_brand_editor(p_workspace uuid, p_brand uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.brand_editors be
    where be.workspace_id = p_workspace and be.brand_id = p_brand and be.user_id = p_user
  );
$$;

-- Admins and viewers see everything; editors see only content they own.
create function public.can_view_content(p_workspace uuid, p_assigned_to uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case public.current_member_role(p_workspace)
      when 'admin' then true
      when 'viewer' then true
      when 'editor' then p_assigned_to = auth.uid()
      else false
    end,
    false
  );
$$;

-- Admins edit everything; editors edit only content they own.
-- (The workspace setting editors_can_edit_all is no longer used.)
create or replace function public.can_edit_content(p_workspace uuid, p_created_by uuid, p_assigned_to uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case public.current_member_role(p_workspace)
      when 'admin' then true
      when 'editor' then p_assigned_to = auth.uid()
      else false
    end,
    false
  );
$$;

-- Brand-scoped access for monthly plans.
create function public.can_access_brand(p_workspace uuid, p_brand uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case public.current_member_role(p_workspace)
      when 'admin' then true
      when 'viewer' then true
      when 'editor' then public.is_brand_editor(p_workspace, p_brand, auth.uid())
      else false
    end,
    false
  );
$$;

create function public.can_write_brand(p_workspace uuid, p_brand uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case public.current_member_role(p_workspace)
      when 'admin' then true
      when 'editor' then public.is_brand_editor(p_workspace, p_brand, auth.uid())
      else false
    end,
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- Ownership rules (replaces the admin-only assignment guard from migration 800;
-- the trigger itself already exists and runs before content_items_validate).
-- ---------------------------------------------------------------------------
create or replace function public.content_items_assignment_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.workspace_role;
  v_owner_role public.workspace_role;
begin
  if v_uid is null then
    return new;
  end if;
  v_role := public.current_member_role(new.workspace_id);

  if tg_op = 'INSERT' then
    if v_role is null or v_role = 'viewer' then
      raise exception using errcode = '42501', message = 'You don''t have permission to create content.';
    end if;
    if new.assigned_to is null then
      new.assigned_to := v_uid;
    end if;
    if v_role is distinct from 'admin' and new.assigned_to <> v_uid then
      raise exception using errcode = '42501', message = 'Editors can only create content assigned to themselves.';
    end if;
  else
    if new.assigned_to is null then
      raise exception using errcode = 'P0001', message = 'Content must have an owner.';
    end if;
    if new.assigned_to is distinct from old.assigned_to and v_role is distinct from 'admin' then
      raise exception using errcode = '42501', message = 'Only administrators can assign content.';
    end if;
  end if;

  if v_role = 'editor'
     and (tg_op = 'INSERT' or new.brand_id is distinct from old.brand_id)
     and not public.is_brand_editor(new.workspace_id, new.brand_id, v_uid) then
    raise exception using errcode = '42501', message = 'You aren''t assigned to this brand.';
  end if;

  if tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to or new.brand_id is distinct from old.brand_id then
    select m.role into v_owner_role
    from public.workspace_members m
    where m.workspace_id = new.workspace_id and m.user_id = new.assigned_to and m.status = 'active';
    if v_owner_role = 'editor' and not public.is_brand_editor(new.workspace_id, new.brand_id, new.assigned_to) then
      raise exception using errcode = 'P0001', message = 'That editor isn''t assigned to this brand.';
    end if;
    -- Viewers, inactive members and outsiders are rejected by content_items_validate.
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Visibility policies
-- ---------------------------------------------------------------------------
drop policy content_items_select on public.content_items;
create policy content_items_select on public.content_items
  for select to authenticated using (public.can_view_content(workspace_id, assigned_to));

drop policy content_activity_select on public.content_activity;
create policy content_activity_select on public.content_activity
  for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (content_id is null or exists (select 1 from public.content_items c where c.id = content_activity.content_id))
  );

drop policy content_assets_select on public.content_assets;
create policy content_assets_select on public.content_assets
  for select to authenticated
  using (exists (select 1 from public.content_items c where c.id = content_assets.content_id and c.workspace_id = content_assets.workspace_id));

create function public.can_read_storage_path(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_workspace uuid := public.try_uuid(v_parts[1]);
begin
  if v_workspace is null or auth.uid() is null then
    return false;
  end if;
  if v_parts[2] = 'branding' then
    return public.is_workspace_member(v_workspace);
  elsif v_parts[2] = 'content' and cardinality(v_parts) = 4 then
    return exists (
      select 1 from public.content_items c
      where c.id = public.try_uuid(v_parts[3])
        and c.workspace_id = v_workspace
        and public.can_view_content(c.workspace_id, c.assigned_to)
    );
  end if;
  return false;
end;
$$;

drop policy "workspace files: members can read" on storage.objects;
create policy "workspace files: members can read"
  on storage.objects for select to authenticated
  using (bucket_id = 'workspace-files' and public.can_read_storage_path(name));

drop policy monthly_plans_select on public.monthly_plans;
create policy monthly_plans_select on public.monthly_plans
  for select to authenticated using (public.can_access_brand(workspace_id, brand_id));
drop policy monthly_plans_insert on public.monthly_plans;
create policy monthly_plans_insert on public.monthly_plans
  for insert to authenticated with check (public.can_write_brand(workspace_id, brand_id));
drop policy monthly_plans_update on public.monthly_plans;
create policy monthly_plans_update on public.monthly_plans
  for update to authenticated
  using (public.can_write_brand(workspace_id, brand_id))
  with check (public.can_write_brand(workspace_id, brand_id));

-- ---------------------------------------------------------------------------
-- Plan duplication: owners are mandatory (see body).
-- ---------------------------------------------------------------------------

create or replace function public.duplicate_monthly_plan(
  p_source_plan_id uuid,
  p_target_brand_id uuid,
  p_target_year integer,
  p_target_month integer,
  p_copy_mode text default 'full',
  p_include_unscheduled boolean default false,
  p_missing_date_strategy text default 'last_day',
  p_dry_run boolean default true,
  p_target_title text default null
)
returns table (
  source_item_id uuid,
  title text,
  format_id uuid,
  source_date date,
  target_date date,
  outcome text,
  is_weekend boolean,
  key_dates text,
  target_plan_id uuid,
  new_item_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_src public.monthly_plans;
  v_brand public.brands;
  v_target_plan_id uuid;
  v_target_status public.plan_status;
  v_first date;
  v_last_day int;
  v_day int;
  v_item public.content_items;
  v_target date;
  v_outcome text;
  v_new_id uuid;
  v_full boolean := p_copy_mode = 'full';
begin
  if p_copy_mode not in ('full', 'structure') then
    raise exception using errcode = 'P0001', message = 'Choose a copy mode.';
  end if;
  if p_missing_date_strategy not in ('last_day', 'skip', 'unscheduled') then
    raise exception using errcode = 'P0001', message = 'Choose how to handle dates that do not exist in the target month.';
  end if;
  if p_target_year is null or p_target_month is null
     or p_target_year not between 2000 and 2100 or p_target_month not between 1 and 12 then
    raise exception using errcode = 'P0001', message = 'Choose a valid target month.';
  end if;

  select * into v_src from public.monthly_plans p where p.id = p_source_plan_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'The source plan was not found.';
  end if;
  if not public.can_duplicate_plans(v_src.workspace_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to duplicate plans.';
  end if;

  select * into v_brand from public.brands b where b.id = p_target_brand_id and b.workspace_id = v_src.workspace_id;
  if not found or not v_brand.is_active then
    raise exception using errcode = 'P0001', message = 'Choose an active target brand.';
  end if;
  if public.current_member_role(v_src.workspace_id) = 'editor'
     and not public.is_brand_editor(v_src.workspace_id, v_brand.id, auth.uid()) then
    raise exception using errcode = '42501', message = 'You aren''t assigned to the target brand.';
  end if;
  if v_brand.id = v_src.brand_id and p_target_year = v_src.year and p_target_month = v_src.month then
    raise exception using errcode = 'P0001', message = 'Choose a different brand or month than the source plan.';
  end if;

  select p.id, p.status into v_target_plan_id, v_target_status
  from public.monthly_plans p
  where p.brand_id = v_brand.id and p.year = p_target_year and p.month = p_target_month;
  if v_target_status = 'archived' then
    raise exception using errcode = 'P0001', message = 'The target plan is archived. Restore it before copying into it.';
  end if;

  v_first := make_date(p_target_year, p_target_month, 1);
  v_last_day := extract(day from (v_first + interval '1 month' - interval '1 day'))::int;

  if not p_dry_run and v_target_plan_id is null then
    insert into public.monthly_plans (workspace_id, brand_id, year, month, title, status)
    values (
      v_src.workspace_id, v_brand.id, p_target_year, p_target_month,
      coalesce(nullif(btrim(p_target_title), ''), v_brand.name || ' — ' || to_char(v_first, 'FMMonth YYYY')),
      'draft'
    )
    returning id into v_target_plan_id;
  end if;

  for v_item in
    select c.* from public.content_items c
    where c.monthly_plan_id = v_src.id
      and c.deleted_at is null
      and c.status <> 'cancelled'
      and (c.scheduled_date is not null or p_include_unscheduled)
    order by c.scheduled_date nulls last, c.scheduled_time nulls last, c.created_at
  loop
    v_new_id := null;
    if v_item.scheduled_date is null then
      v_target := null;
      v_outcome := 'copy_unscheduled';
    else
      v_day := extract(day from v_item.scheduled_date)::int;
      if v_day <= v_last_day then
        v_target := make_date(p_target_year, p_target_month, v_day);
        v_outcome := 'copy';
      elsif p_missing_date_strategy = 'last_day' then
        v_target := make_date(p_target_year, p_target_month, v_last_day);
        v_outcome := 'moved_to_last_day';
      elsif p_missing_date_strategy = 'unscheduled' then
        v_target := null;
        v_outcome := 'moved_to_unscheduled';
      else
        v_target := null;
        v_outcome := 'skipped_missing_date';
      end if;
    end if;

    if v_outcome <> 'skipped_missing_date' and not exists (
      select 1 from public.content_formats f where f.id = v_item.format_id and f.is_active
    ) then
      v_outcome := 'skipped_inactive_format';
    end if;

    if not p_dry_run and v_outcome not like 'skipped%' then
      insert into public.content_items (
        workspace_id, brand_id, monthly_plan_id, title, platforms, format_id, pillar_id,
        scheduled_date, scheduled_time, status, source_item_id,
        caption, hashtags, call_to_action, purpose, target_audience, creative_brief, reference_urls,
        assigned_to
      )
      values (
        v_src.workspace_id, v_brand.id, v_target_plan_id, v_item.title, v_item.platforms, v_item.format_id,
        (select pl.id from public.content_pillars pl where pl.id = v_item.pillar_id and pl.is_active),
        v_target, case when v_target is not null then v_item.scheduled_time end, 'planned', v_item.id,
        case when v_full then v_item.caption end,
        case when v_full then v_item.hashtags else '{}'::text[] end,
        case when v_full then v_item.call_to_action end,
        case when v_full then v_item.purpose end,
        case when v_full then v_item.target_audience end,
        case when v_full then v_item.creative_brief end,
        case when v_full then v_item.reference_urls else '{}'::text[] end,
        -- Every post needs an owner. Administrators copying full content keep
        -- the original owner when still allowed on the target brand; otherwise
        -- the person duplicating becomes the owner.
        coalesce(
          case when v_full and public.current_member_role(v_src.workspace_id) = 'admin' then (
            select m.user_id from public.workspace_members m
            where m.workspace_id = v_src.workspace_id and m.user_id = v_item.assigned_to and m.status = 'active'
              and (m.role = 'admin' or (m.role = 'editor' and public.is_brand_editor(v_src.workspace_id, v_brand.id, m.user_id)))
          ) end,
          auth.uid()
        )
      )
      returning id into v_new_id;
    end if;

    source_item_id := v_item.id;
    title := v_item.title;
    format_id := v_item.format_id;
    source_date := v_item.scheduled_date;
    target_date := v_target;
    outcome := v_outcome;
    is_weekend := v_target is not null and extract(isodow from v_target) in (6, 7);
    key_dates := (
      select string_agg(k.name, ', ' order by k.name)
      from public.key_dates k
      where k.workspace_id = v_src.workspace_id and k.date = v_target
    );
    target_plan_id := v_target_plan_id;
    new_item_id := v_new_id;
    return next;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill existing data (runs as the migration owner, so ownership rules for
-- signed-in users do not apply here).
-- ---------------------------------------------------------------------------

-- Editors become brand editors of brands they already work on.
insert into public.brand_editors (workspace_id, brand_id, user_id)
select distinct c.workspace_id, c.brand_id, u.user_id
from public.content_items c
cross join lateral (values (c.assigned_to), (c.created_by)) as u(user_id)
join public.workspace_members m
  on m.workspace_id = c.workspace_id and m.user_id = u.user_id and m.status = 'active' and m.role = 'editor'
on conflict (brand_id, user_id) do nothing;

-- Every post gets an owner: its creator if still an active admin/editor,
-- otherwise the workspace's longest-standing active administrator.
update public.content_items c
   set assigned_to = coalesce(
     (select m.user_id from public.workspace_members m
       where m.workspace_id = c.workspace_id and m.user_id = c.created_by
         and m.status = 'active' and m.role in ('admin', 'editor')),
     (select m.user_id from public.workspace_members m
       where m.workspace_id = c.workspace_id and m.status = 'active' and m.role = 'admin'
       order by m.joined_at limit 1)
   )
 where c.assigned_to is null;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function
  public.brand_editors_before_insert(),
  public.content_items_assignment_guard(),
  public.is_brand_editor(uuid, uuid, uuid),
  public.can_view_content(uuid, uuid),
  public.can_access_brand(uuid, uuid),
  public.can_write_brand(uuid, uuid),
  public.can_read_storage_path(text)
from public, anon, authenticated;

grant execute on function
  public.is_brand_editor(uuid, uuid, uuid),
  public.can_view_content(uuid, uuid),
  public.can_access_brand(uuid, uuid),
  public.can_write_brand(uuid, uuid),
  public.can_read_storage_path(text)
to authenticated;

revoke execute on function public.duplicate_monthly_plan(uuid, uuid, integer, integer, text, boolean, text, boolean, text) from public, anon;
grant execute on function public.duplicate_monthly_plan(uuid, uuid, integer, integer, text, boolean, text, boolean, text) to authenticated;
