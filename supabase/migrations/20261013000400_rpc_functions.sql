-- =============================================================================
-- Remote procedures (RPC) for operations that need elevated or atomic logic.
-- Every function re-checks the caller's authority inside the database; none
-- trusts a role or workspace claim from the client.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Setup status (public): lets the login page decide whether to show /setup.
-- Reveals nothing beyond a boolean.
-- ---------------------------------------------------------------------------
create function public.get_setup_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'initialized',
    coalesce((select s.initialized_at is not null from public.system_state s where s.id), false)
      or exists (select 1 from public.workspace_members m where m.role = 'admin')
  );
$$;

-- ---------------------------------------------------------------------------
-- First-administrator provisioning
-- ---------------------------------------------------------------------------

-- Internal: creates the workspace, admin membership and default configuration
-- in the caller's transaction. Not executable by any API role.
create function public._provision_first_admin(p_user_id uuid, p_full_name text, p_workspace_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.system_state;
  v_email text;
  v_workspace uuid;
begin
  select * into v_state from public.system_state where id for update;
  if v_state.initialized_at is not null or exists (select 1 from public.workspace_members where role = 'admin') then
    raise exception using errcode = 'P0001', message = 'already_initialized';
  end if;

  if length(btrim(coalesce(p_full_name, ''))) not between 1 and 120 then
    raise exception using errcode = 'P0001', message = 'invalid_full_name';
  end if;
  if length(btrim(coalesce(p_workspace_name, ''))) not between 1 and 80 then
    raise exception using errcode = 'P0001', message = 'invalid_workspace_name';
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = p_user_id;
  if v_email is null then
    raise exception using errcode = 'P0001', message = 'user_not_found';
  end if;

  insert into public.profiles (id, email, full_name)
  values (p_user_id, v_email, btrim(p_full_name))
  on conflict (id) do update set full_name = excluded.full_name;

  insert into public.workspaces (name, created_by)
  values (btrim(p_workspace_name), p_user_id)
  returning id into v_workspace;

  insert into public.workspace_members (workspace_id, user_id, role, status)
  values (v_workspace, p_user_id, 'admin', 'active');

  perform public.seed_workspace_defaults(v_workspace);

  update public.system_state
     set initialized_at = now(),
         first_admin_id = p_user_id,
         bootstrap_lock_token = null,
         bootstrap_locked_at = null
   where id;

  return v_workspace;
end;
$$;

-- Step 1 (Edge Function, service role): claim the single bootstrap slot.
-- The row lock on system_state serialises concurrent callers; a second caller
-- sees the active lease and fails. A crashed attempt's lease expires after
-- five minutes.
create function public.bootstrap_acquire_lock()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.system_state;
  v_token uuid := gen_random_uuid();
begin
  select * into v_state from public.system_state where id for update;
  if v_state.initialized_at is not null or exists (select 1 from public.workspace_members where role = 'admin') then
    raise exception using errcode = 'P0001', message = 'already_initialized';
  end if;
  if v_state.bootstrap_lock_token is not null and v_state.bootstrap_locked_at > now() - interval '5 minutes' then
    raise exception using errcode = 'P0001', message = 'bootstrap_in_progress';
  end if;
  update public.system_state
     set bootstrap_lock_token = v_token, bootstrap_locked_at = now()
   where id;
  return v_token;
end;
$$;

-- Step 2 (Edge Function, service role): after creating the auth user,
-- provision everything atomically. Fails if the lease was lost.
create function public.bootstrap_complete(p_lock uuid, p_user_id uuid, p_full_name text, p_workspace_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.system_state;
begin
  select * into v_state from public.system_state where id for update;
  if v_state.bootstrap_lock_token is distinct from p_lock
     or v_state.bootstrap_locked_at < now() - interval '5 minutes' then
    raise exception using errcode = 'P0001', message = 'bootstrap_lock_lost';
  end if;
  return public._provision_first_admin(p_user_id, p_full_name, p_workspace_name);
end;
$$;

-- Step 3 (on failure): release the lease so the installer can retry.
create function public.bootstrap_release_lock(p_lock uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.system_state
     set bootstrap_lock_token = null, bootstrap_locked_at = null
   where id and bootstrap_lock_token = p_lock;
$$;

-- Manual fallback (documented in README): run from the Supabase SQL editor as
-- the postgres role after creating the user under Authentication → Users.
create function public.bootstrap_existing_user(p_email text, p_full_name text, p_workspace_name text default 'Joyno Media')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  select u.id into v_user from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_user is null then
    raise exception 'No auth user exists with email %. Create the user first.', p_email;
  end if;
  return public._provision_first_admin(v_user, p_full_name, p_workspace_name);
end;
$$;

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------
create function public.hash_invitation_token(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

-- Creates a pending invitation and returns the raw token exactly once.
-- Any earlier pending invitation for the same email is revoked, so only the
-- newest link works.
create function public.create_invitation(p_workspace_id uuid, p_email text, p_role public.workspace_role)
returns table (invitation_id uuid, token text, expires_at timestamptz, email text, user_exists boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_token text;
  v_id uuid;
  v_expires timestamptz := now() + interval '7 days';
begin
  if v_uid is null or not public.has_workspace_role(p_workspace_id, array['admin']::public.workspace_role[]) then
    raise exception using errcode = '42501', message = 'Only administrators can invite team members.';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception using errcode = 'P0001', message = 'Enter a valid email address.';
  end if;
  if p_role is null or p_role not in ('editor', 'viewer') then
    raise exception using errcode = 'P0001', message = 'Invitations can grant the Editor or Viewer role.';
  end if;
  if (select count(*) from public.invitations i where i.invited_by = v_uid and i.created_at > now() - interval '1 hour') >= 30 then
    raise exception using errcode = 'P0001', message = 'Too many invitations in the last hour. Please try again later.';
  end if;
  if exists (
    select 1 from public.workspace_members m
    join public.profiles p on p.id = m.user_id
    where m.workspace_id = p_workspace_id and m.status = 'active' and p.email = v_email
  ) then
    raise exception using errcode = 'P0001', message = 'This person is already an active member of the workspace.';
  end if;

  update public.invitations i
     set status = 'revoked', revoked_at = now(), revoked_by = v_uid
   where i.workspace_id = p_workspace_id and i.email = v_email and i.status = 'pending';

  -- 2 × gen_random_uuid() = 244 bits from the server's strong RNG.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into public.invitations (workspace_id, email, role, token_hash, invited_by, expires_at)
  values (p_workspace_id, v_email, p_role, public.hash_invitation_token(v_token), v_uid, v_expires)
  returning id into v_id;

  return query select v_id, v_token, v_expires, v_email,
    exists (select 1 from auth.users u where lower(u.email) = v_email);
end;
$$;

create function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations;
begin
  select * into v_inv from public.invitations where id = p_invitation_id for update;
  if not found or not public.has_workspace_role(v_inv.workspace_id, array['admin']::public.workspace_role[]) then
    raise exception using errcode = '42501', message = 'Only administrators can revoke invitations.';
  end if;
  if v_inv.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'Only pending invitations can be revoked.';
  end if;
  update public.invitations
     set status = 'revoked', revoked_at = now(), revoked_by = auth.uid()
   where id = p_invitation_id;
end;
$$;

-- Lets the accept page explain the state of a link to the signed-in user.
create function public.get_invitation(p_token text)
returns table (state text, workspace_name text, role public.workspace_role, expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_inv public.invitations;
  v_email text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Sign in to view this invitation.';
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = auth.uid();
  select * into v_inv from public.invitations i where i.token_hash = public.hash_invitation_token(coalesce(p_token, ''));
  if not found then
    return query select 'invalid'::text, null::text, null::public.workspace_role, null::timestamptz;
    return;
  end if;
  if v_inv.email <> v_email then
    return query select 'email_mismatch'::text, null::text, null::public.workspace_role, null::timestamptz;
    return;
  end if;
  return query
    select case
             when v_inv.status = 'accepted' then 'accepted'
             when v_inv.status = 'revoked' then 'revoked'
             when v_inv.expires_at < now() then 'expired'
             else 'valid'
           end,
           w.name, v_inv.role, v_inv.expires_at
    from public.workspaces w where w.id = v_inv.workspace_id;
end;
$$;

-- Single-use acceptance. Matches the signed-in user's verified email.
create function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmed timestamptz;
  v_inv public.invitations;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'Sign in to accept this invitation.';
  end if;
  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = v_uid;

  select * into v_inv from public.invitations i
  where i.token_hash = public.hash_invitation_token(coalesce(p_token, ''))
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'This invitation link is invalid.';
  end if;
  if v_inv.status = 'accepted' then
    if v_inv.accepted_by = v_uid then
      return v_inv.workspace_id;
    end if;
    raise exception using errcode = 'P0001', message = 'This invitation has already been used.';
  end if;
  if v_inv.status = 'revoked' then
    raise exception using errcode = 'P0001', message = 'This invitation has been revoked.';
  end if;
  if v_inv.expires_at < now() then
    raise exception using errcode = 'P0001', message = 'This invitation has expired. Ask an administrator to send a new one.';
  end if;
  if v_inv.email <> v_email then
    raise exception using errcode = 'P0001', message = 'This invitation was sent to a different email address.';
  end if;
  if v_confirmed is null then
    raise exception using errcode = 'P0001', message = 'Confirm your email address before accepting the invitation.';
  end if;

  insert into public.profiles (id, email) values (v_uid, v_email) on conflict (id) do nothing;

  insert into public.workspace_members (workspace_id, user_id, role, status, invited_by)
  values (v_inv.workspace_id, v_uid, v_inv.role, 'active', v_inv.invited_by)
  on conflict (workspace_id, user_id) do update
     set role = case when public.workspace_members.status = 'active' then public.workspace_members.role else excluded.role end,
         status = 'active',
         invited_by = excluded.invited_by,
         joined_at = case when public.workspace_members.status = 'active' then public.workspace_members.joined_at else now() end,
         deactivated_at = null,
         deactivated_by = null;

  update public.invitations
     set status = 'accepted', accepted_at = now(), accepted_by = v_uid
   where id = v_inv.id;

  return v_inv.workspace_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Member management (administrators only, last-admin protected)
-- ---------------------------------------------------------------------------
create function public.update_member_role(p_member_id uuid, p_role public.workspace_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.workspace_members;
begin
  select * into v_member from public.workspace_members where id = p_member_id for update;
  if not found or not public.has_workspace_role(v_member.workspace_id, array['admin']::public.workspace_role[]) then
    raise exception using errcode = '42501', message = 'Only administrators can change roles.';
  end if;
  if p_role is null then
    raise exception using errcode = 'P0001', message = 'Choose a role.';
  end if;
  if v_member.role = 'admin' and p_role <> 'admin' and v_member.status = 'active' then
    perform 1 from public.workspace_members
     where workspace_id = v_member.workspace_id and role = 'admin' and status = 'active'
     for update;
    if (select count(*) from public.workspace_members
         where workspace_id = v_member.workspace_id and role = 'admin' and status = 'active') <= 1 then
      raise exception using errcode = 'P0001', message = 'The workspace must keep at least one active administrator.';
    end if;
  end if;
  update public.workspace_members set role = p_role where id = p_member_id;
end;
$$;

create function public.set_member_status(p_member_id uuid, p_status public.member_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.workspace_members;
begin
  select * into v_member from public.workspace_members where id = p_member_id for update;
  if not found or not public.has_workspace_role(v_member.workspace_id, array['admin']::public.workspace_role[]) then
    raise exception using errcode = '42501', message = 'Only administrators can change membership status.';
  end if;
  if p_status is null or p_status = v_member.status then
    return;
  end if;
  if p_status = 'deactivated' and v_member.role = 'admin' then
    perform 1 from public.workspace_members
     where workspace_id = v_member.workspace_id and role = 'admin' and status = 'active'
     for update;
    if (select count(*) from public.workspace_members
         where workspace_id = v_member.workspace_id and role = 'admin' and status = 'active') <= 1 then
      raise exception using errcode = 'P0001', message = 'The workspace must keep at least one active administrator.';
    end if;
  end if;
  update public.workspace_members
     set status = p_status,
         deactivated_at = case when p_status = 'deactivated' then now() end,
         deactivated_by = case when p_status = 'deactivated' then auth.uid() end
   where id = p_member_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Monthly plan duplication.
-- SECURITY INVOKER: every read and write runs under the caller's RLS. The
-- whole call is one transaction, so a failure leaves no partial copy.
-- With p_dry_run = true it only returns the preview rows.
--
-- outcome values:
--   copy                    same day of month
--   copy_unscheduled        unscheduled idea copied as an idea
--   moved_to_last_day       day does not exist in target month → last day
--   moved_to_unscheduled    day does not exist → copied as unscheduled idea
--   skipped_missing_date    day does not exist → not copied
--   skipped_inactive_format format has been deactivated → not copied
-- Weekends and key dates are reported, never silently moved.
-- ---------------------------------------------------------------------------
create function public.duplicate_monthly_plan(
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
        case when v_full then (
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
