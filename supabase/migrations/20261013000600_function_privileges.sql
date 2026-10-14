-- =============================================================================
-- Function EXECUTE privileges.
--
-- PostgreSQL grants EXECUTE on new functions to PUBLIC, and Supabase adds
-- default grants to anon/authenticated. Start from zero and grant back only
-- what each role needs. Any function added by a later migration must be
-- granted explicitly in that migration.
-- =============================================================================

revoke execute on all functions in schema public from public, anon, authenticated;

-- Public: the setup page only needs to know whether setup has happened.
grant execute on function public.get_setup_status() to anon, authenticated;

-- Helpers evaluated inside RLS policies and CHECK constraints.
grant execute on function
  public.current_member_role(uuid),
  public.is_workspace_member(uuid),
  public.has_workspace_role(uuid, public.workspace_role[]),
  public.can_edit_content(uuid, uuid, uuid),
  public.can_duplicate_plans(uuid),
  public.can_write_storage_path(text),
  public.shares_workspace_with(uuid),
  public.try_uuid(text),
  public.is_http_url(text),
  public.all_http_urls(text[]),
  public.is_hex_color(text),
  public.allowed_platforms(),
  public.is_status_transition_allowed(public.content_status, public.content_status, public.workspace_role),
  public.status_label(public.content_status)
to authenticated;

-- Application RPCs (each re-checks authority internally).
grant execute on function
  public.create_invitation(uuid, text, public.workspace_role),
  public.revoke_invitation(uuid),
  public.get_invitation(text),
  public.accept_invitation(text),
  public.update_member_role(uuid, public.workspace_role),
  public.set_member_status(uuid, public.member_status),
  public.duplicate_monthly_plan(uuid, uuid, integer, integer, text, boolean, text, boolean, text)
to authenticated;

-- Bootstrap steps: only the Edge Function (service role) may call these.
-- _provision_first_admin, bootstrap_existing_user and seed_workspace_defaults
-- stay owner-only (postgres / SQL editor).
grant execute on function
  public.bootstrap_acquire_lock(),
  public.bootstrap_complete(uuid, uuid, text, text),
  public.bootstrap_release_lock(uuid)
to service_role;
