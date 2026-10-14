-- =============================================================================
-- Private storage for workspace files.
--
-- Object path layout (first folder is always the workspace id):
--   {workspace_id}/content/{content_id}/{uuid}-{file_name}   content assets
--   {workspace_id}/branding/{uuid}-{file_name}               workspace/brand logos
--
-- The bucket is private: files are only reachable through short-lived signed
-- URLs, which Storage issues only when the select policy below allows it.
-- SVG is deliberately excluded (it can carry script).
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workspace-files',
  'workspace-files',
  false,
  52428800, -- 50 MB
  array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic',
    'video/mp4', 'video/quicktime', 'video/webm',
    'application/pdf', 'application/zip', 'text/plain', 'text/csv',
    'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/vnd.adobe.photoshop', 'application/postscript'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Decides whether the current user may create or delete an object path.
create function public.can_write_storage_path(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_workspace uuid := public.try_uuid(v_parts[1]);
  v_content uuid;
begin
  if v_workspace is null or auth.uid() is null then
    return false;
  end if;
  if v_parts[2] = 'content' and cardinality(v_parts) = 4 then
    v_content := public.try_uuid(v_parts[3]);
    return exists (
      select 1 from public.content_items c
      where c.id = v_content
        and c.workspace_id = v_workspace
        and public.can_edit_content(c.workspace_id, c.created_by, c.assigned_to)
    );
  elsif v_parts[2] = 'branding' and cardinality(v_parts) = 3 then
    return public.has_workspace_role(v_workspace, array['admin']::public.workspace_role[]);
  end if;
  return false;
end;
$$;

create policy "workspace files: members can read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'workspace-files'
    and public.is_workspace_member(public.try_uuid((storage.foldername(name))[1]))
  );

create policy "workspace files: authorised members can upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'workspace-files' and public.can_write_storage_path(name));

create policy "workspace files: authorised members can delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'workspace-files' and public.can_write_storage_path(name));
