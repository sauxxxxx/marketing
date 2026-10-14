-- =============================================================================
-- Library search: a lower-cased text column covering title, caption,
-- hashtags, purpose and call to action. Maintained by trigger (not a
-- generated column, because array_to_string is only STABLE) and never
-- writable by clients.
-- =============================================================================

alter table public.content_items add column search_text text not null default '';

create function public.content_items_search_text()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.search_text := lower(concat_ws(' ',
    new.title, new.caption, array_to_string(new.hashtags, ' '), new.purpose, new.call_to_action
  ));
  return new;
end;
$$;

create trigger content_items_search before insert or update on public.content_items
  for each row execute function public.content_items_search_text();

-- Backfill existing rows without touching updated_at semantics for users.
update public.content_items set search_text = lower(concat_ws(' ',
  title, caption, array_to_string(hashtags, ' '), purpose, call_to_action
));

-- Exclude the derived column from the activity "updated" field list.
create or replace function public.content_items_after_write()
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
      'monthly_plan_id', 'created_at', 'created_by', 'search_text'
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

-- Re-assert privileges: functions created above default to PUBLIC execute.
revoke execute on function public.content_items_search_text() from public, anon, authenticated;
revoke execute on function public.content_items_after_write() from public, anon, authenticated;
