-- =============================================================================
-- Joyno Media Content Studio — core schema
--
-- Conventions
--   * Every private table carries workspace_id.
--   * Child rows reference parents through composite (workspace_id, id) foreign
--     keys, so a row can never point at a brand/format/plan/member that lives
--     in another workspace — even if a browser submits a foreign ID.
--   * Scheduling is stored as a local date (+ optional local time) in the
--     workspace timezone. This keeps date-only posts on the intended day
--     regardless of the viewer's device timezone.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
create type public.workspace_role as enum ('admin', 'editor', 'viewer');
create type public.member_status as enum ('active', 'deactivated');
create type public.invitation_status as enum ('pending', 'accepted', 'revoked');
create type public.content_status as enum (
  'planned', 'in_production', 'for_review', 'needs_revision', 'approved', 'published', 'cancelled'
);
create type public.plan_status as enum ('draft', 'in_review', 'approved', 'archived');
create type public.asset_kind as enum ('image', 'video', 'design', 'document', 'link');
create type public.calendar_view as enum ('month', 'week', 'two_week');
create type public.key_date_kind as enum ('holiday', 'observance', 'campaign', 'other');

-- ---------------------------------------------------------------------------
-- Small immutable validators used by CHECK constraints
-- ---------------------------------------------------------------------------
create function public.is_http_url(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_url is null
      or (p_url ~* '^https?://[^\s/$.?#][^\s]*$' and length(p_url) <= 2048);
$$;

create function public.all_http_urls(p_urls text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(public.is_http_url(u) and u is not null), true)
  from unnest(p_urls) as u;
$$;

create function public.is_hex_color(p_color text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_color ~ '^#[0-9a-fA-F]{6}$';
$$;

-- ---------------------------------------------------------------------------
-- Installation state (singleton). Not exposed to API roles.
-- ---------------------------------------------------------------------------
create table public.system_state (
  id boolean primary key default true check (id),
  initialized_at timestamptz,
  first_admin_id uuid,
  bootstrap_lock_token uuid,
  bootstrap_locked_at timestamptz
);
insert into public.system_state (id) values (true);

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users). No role information lives here.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '' check (length(full_name) <= 120),
  avatar_url text check (public.is_http_url(avatar_url)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Workspaces
-- ---------------------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  logo_path text,
  timezone text not null default 'Asia/Manila',
  default_calendar_view public.calendar_view not null default 'month',
  default_platforms text[] not null default array['Facebook', 'Instagram'],
  -- Editing rules: when false, editors may only edit content they created or
  -- that is assigned to them. Administrators can always edit.
  editors_can_edit_all boolean not null default true,
  editors_can_duplicate_plans boolean not null default true,
  is_demo boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Membership. Rows are only written through SECURITY DEFINER functions.
-- ---------------------------------------------------------------------------
create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.workspace_role not null,
  status public.member_status not null default 'active',
  invited_by uuid references public.profiles (id) on delete set null,
  joined_at timestamptz not null default now(),
  deactivated_at timestamptz,
  deactivated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id) where status = 'active';

-- ---------------------------------------------------------------------------
-- Invitations. Only a SHA-256 hash of the token is stored.
-- ---------------------------------------------------------------------------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.workspace_role not null check (role in ('editor', 'viewer')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status public.invitation_status not null default 'pending',
  invited_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index invitations_one_pending_per_email
  on public.invitations (workspace_id, email) where status = 'pending';
create index invitations_invited_by_created_idx on public.invitations (invited_by, created_at);

-- ---------------------------------------------------------------------------
-- Brands
-- ---------------------------------------------------------------------------
create table public.brands (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  description text check (length(description) <= 1000),
  notes text check (length(notes) <= 5000),
  logo_path text,
  is_active boolean not null default true,
  is_demo boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create unique index brands_unique_name on public.brands (workspace_id, lower(name));

-- ---------------------------------------------------------------------------
-- Configurable content formats and pillars (separate concepts)
-- ---------------------------------------------------------------------------
create table public.content_formats (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 40),
  color text not null check (public.is_hex_color(color)),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create unique index content_formats_unique_name on public.content_formats (workspace_id, lower(name));

create table public.content_pillars (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 40),
  color text not null check (public.is_hex_color(color)),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create unique index content_pillars_unique_name on public.content_pillars (workspace_id, lower(name));

-- ---------------------------------------------------------------------------
-- Monthly plans — one per brand per calendar month (first release).
-- Drop monthly_plans_one_per_brand_month to allow several plans later.
-- ---------------------------------------------------------------------------
create table public.monthly_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  brand_id uuid not null,
  year integer not null check (year between 2000 and 2100),
  month integer not null check (month between 1 and 12),
  title text not null check (length(btrim(title)) between 1 and 120),
  status public.plan_status not null default 'draft',
  notes text check (length(notes) <= 5000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  constraint monthly_plans_one_per_brand_month unique (brand_id, year, month),
  foreign key (workspace_id, brand_id) references public.brands (workspace_id, id)
);
create index monthly_plans_workspace_period_idx on public.monthly_plans (workspace_id, year, month);

-- ---------------------------------------------------------------------------
-- Content items — the single source for calendar, board, summaries and PDFs.
-- ---------------------------------------------------------------------------
create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  monthly_plan_id uuid,
  brand_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 200),
  platforms text[] not null default '{}' check (
    platforms <@ array[
      'Facebook', 'Instagram', 'TikTok', 'LinkedIn', 'YouTube', 'X', 'Threads',
      'Pinterest', 'Google Business Profile', 'Website', 'Email', 'Other'
    ]::text[]
  ),
  format_id uuid not null,
  pillar_id uuid,

  -- Copywriting
  caption text check (length(caption) <= 10000),
  hashtags text[] not null default '{}' check (cardinality(hashtags) <= 60),
  call_to_action text check (length(call_to_action) <= 500),

  -- Strategy
  purpose text check (length(purpose) <= 1000),
  target_audience text check (length(target_audience) <= 1000),
  creative_brief text check (length(creative_brief) <= 10000),
  reference_urls text[] not null default '{}' check (cardinality(reference_urls) <= 20 and public.all_http_urls(reference_urls)),

  -- Scheduling (local to workspace timezone)
  scheduled_date date,
  scheduled_time time,
  deadline_date date,

  -- Production
  status public.content_status not null default 'planned',
  assigned_to uuid,
  internal_notes text check (length(internal_notes) <= 10000),

  -- Approval (set by trigger, never by the client)
  approved_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null,

  -- Publishing
  published_at timestamptz,
  published_url text check (public.is_http_url(published_url)),
  publication_notes text check (length(publication_notes) <= 5000),

  -- Lineage for reuse / duplication
  source_item_id uuid references public.content_items (id) on delete set null,

  is_demo boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete set null,

  unique (workspace_id, id),
  constraint content_time_requires_date check (scheduled_time is null or scheduled_date is not null),
  foreign key (workspace_id, brand_id) references public.brands (workspace_id, id),
  foreign key (workspace_id, format_id) references public.content_formats (workspace_id, id),
  foreign key (workspace_id, pillar_id) references public.content_pillars (workspace_id, id),
  foreign key (workspace_id, monthly_plan_id) references public.monthly_plans (workspace_id, id),
  foreign key (workspace_id, assigned_to) references public.workspace_members (workspace_id, user_id)
    on delete set null (assigned_to)
);

create index content_items_calendar_idx
  on public.content_items (workspace_id, scheduled_date) where deleted_at is null;
create index content_items_brand_idx on public.content_items (workspace_id, brand_id, scheduled_date);
create index content_items_status_idx on public.content_items (workspace_id, status) where deleted_at is null;
create index content_items_assignee_idx on public.content_items (workspace_id, assigned_to) where deleted_at is null;
create index content_items_plan_idx on public.content_items (monthly_plan_id);
create index content_items_deadline_idx on public.content_items (workspace_id, deadline_date) where deleted_at is null;
create index content_items_updated_idx on public.content_items (workspace_id, updated_at desc);
create index content_items_format_idx on public.content_items (format_id);
create index content_items_pillar_idx on public.content_items (pillar_id);
create index content_items_source_idx on public.content_items (source_item_id);

-- ---------------------------------------------------------------------------
-- Assets (private storage objects or external links)
-- ---------------------------------------------------------------------------
create table public.content_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  content_id uuid not null,
  kind public.asset_kind not null,
  label text check (length(label) <= 200),
  storage_path text check (length(storage_path) <= 1024),
  external_url text check (public.is_http_url(external_url)),
  file_name text check (length(file_name) <= 255),
  mime_type text check (length(mime_type) <= 255),
  size_bytes bigint check (size_bytes between 0 and 52428800),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint content_assets_one_source check ((storage_path is null) <> (external_url is null)),
  constraint content_assets_link_kind check ((kind = 'link') = (external_url is not null)),
  foreign key (workspace_id, content_id) references public.content_items (workspace_id, id) on delete cascade
);
create index content_assets_content_idx on public.content_assets (content_id);
create unique index content_assets_storage_path_idx on public.content_assets (storage_path) where storage_path is not null;

-- ---------------------------------------------------------------------------
-- Activity / audit. Written only by triggers and privileged functions.
-- ---------------------------------------------------------------------------
create table public.content_activity (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  content_id uuid references public.content_items (id) on delete set null,
  content_title text,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index content_activity_content_idx on public.content_activity (content_id, created_at desc);
create index content_activity_workspace_idx on public.content_activity (workspace_id, created_at desc);

create table public.workspace_audit (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index workspace_audit_workspace_idx on public.workspace_audit (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Key dates / holidays (workspace-managed; nothing permanent is hard-coded)
-- ---------------------------------------------------------------------------
create table public.key_dates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  date date not null,
  name text not null check (length(btrim(name)) between 1 and 120),
  kind public.key_date_kind not null default 'holiday',
  region text check (length(region) <= 60),
  notes text check (length(notes) <= 1000),
  is_demo boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, date, name)
);
create index key_dates_workspace_date_idx on public.key_dates (workspace_id, date);
