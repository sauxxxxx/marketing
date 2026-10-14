-- =============================================================================
-- Only administrators can assign content.
--
-- A dedicated trigger rejects setting or changing content_items.assigned_to
-- unless the caller is an active administrator of the workspace. Server-side
-- writes without a user (seed, service role) are unaffected. Plan
-- duplication copies owners only when an administrator runs it, so editors
-- can still duplicate with "Full content".
-- =============================================================================

create function public.content_items_assignment_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.assigned_to is not null)
     or (tg_op = 'UPDATE' and new.assigned_to is distinct from old.assigned_to) then
    if public.current_member_role(new.workspace_id) is distinct from 'admin' then
      raise exception using errcode = '42501', message = 'Only administrators can assign content.';
    end if;
  end if;
  return new;
end;
$$;

create trigger content_items_assignment_guard before insert or update on public.content_items
  for each row execute function public.content_items_assignment_guard();

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
        -- Owners are copied only when an administrator duplicates (assignment is admin-only).
        case when v_full and public.current_member_role(v_src.workspace_id) = 'admin' then (
          select m.user_id from public.workspace_members m
          where m.workspace_id = v_src.workspace_id and m.user_id = v_item.assigned_to
            and m.status = 'active' and m.role in ('admin', 'editor')
        ) end
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

-- Privileges: trigger function is not callable by API roles; RPC stays granted.
revoke execute on function public.content_items_assignment_guard() from public, anon, authenticated;
revoke execute on function public.duplicate_monthly_plan(uuid, uuid, integer, integer, text, boolean, text, boolean, text) from public, anon;
grant execute on function public.duplicate_monthly_plan(uuid, uuid, integer, integer, text, boolean, text, boolean, text) to authenticated;
