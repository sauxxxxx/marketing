-- =============================================================================
-- DEVELOPMENT / DEMO SEED — never run against production.
--
-- Creates a separate workspace named "Joyno Media (Demo)" flagged is_demo,
-- with sample brands, a monthly plan for the current month and content in
-- every status. It is idempotent (fixed IDs + ON CONFLICT DO NOTHING) and
-- never modifies rows it did not create.
--
-- No users or passwords are created here. To sign in to the demo workspace,
-- run `npm run seed:users` (see scripts/seed-dev-users.mjs), which creates
-- admin@ / editor@ / viewer@demo.joyno.local with a password YOU supply and
-- adds them to this workspace. Re-running this file also attaches any such
-- users that already exist, makes the demo editor a brand editor and assigns
-- post owners.
-- =============================================================================

do $$
declare
  v_ws constant uuid := '0d3e0000-0000-4000-8000-000000000001';
  v_brand_joyno constant uuid := '0d3e0000-0000-4000-8000-0000000000b1';
  v_brand_cafe constant uuid := '0d3e0000-0000-4000-8000-0000000000b2';
  v_brand_clinic constant uuid := '0d3e0000-0000-4000-8000-0000000000b3';
  v_plan constant uuid := '0d3e0000-0000-4000-8000-0000000000c1';
  v_month_start date := date_trunc('month', current_date)::date;
  v_year int := extract(year from current_date)::int;
  v_fmt jsonb;
  v_pil jsonb;
begin
  insert into public.workspaces (id, name, timezone, is_demo)
  values (v_ws, 'Joyno Media (Demo)', 'Asia/Manila', true)
  on conflict (id) do nothing;

  perform public.seed_workspace_defaults(v_ws);

  select jsonb_object_agg(name, id) into v_fmt from public.content_formats where workspace_id = v_ws;
  select jsonb_object_agg(name, id) into v_pil from public.content_pillars where workspace_id = v_ws;

  insert into public.brands (id, workspace_id, name, description, notes, is_demo) values
    (v_brand_joyno, v_ws, 'Joyno Media', 'Our own agency channels.', 'Tone: confident, practical, friendly. Avoid jargon.', true),
    (v_brand_cafe, v_ws, 'Kape Kultura Café', 'Specialty coffee shop client (demo).', 'Post food shots before 11:00.', true),
    (v_brand_clinic, v_ws, 'Bright Smile Dental', 'Family dental clinic client (demo).', 'Medical claims need client approval.', true)
  on conflict (id) do nothing;

  insert into public.monthly_plans (id, workspace_id, brand_id, year, month, title, status)
  values (
    v_plan, v_ws, v_brand_joyno, v_year, extract(month from current_date)::int,
    'Joyno Media — ' || to_char(current_date, 'FMMonth YYYY'), 'in_review'
  )
  on conflict do nothing;

  -- Fixed-date Philippine holidays for the current and next year (demo data;
  -- real key dates are managed in Settings → Key dates).
  insert into public.key_dates (workspace_id, date, name, kind, region, is_demo)
  select v_ws, make_date(y, m, d), n, k::public.key_date_kind, 'PH', true
  from generate_series(v_year, v_year + 1) y
  cross join (values
    (1, 1, 'New Year''s Day', 'holiday'),
    (2, 14, 'Valentine''s Day', 'observance'),
    (4, 9, 'Araw ng Kagitingan', 'holiday'),
    (5, 1, 'Labor Day', 'holiday'),
    (6, 12, 'Independence Day', 'holiday'),
    (8, 21, 'Ninoy Aquino Day', 'holiday'),
    (11, 1, 'All Saints'' Day', 'holiday'),
    (11, 2, 'All Souls'' Day', 'holiday'),
    (11, 30, 'Bonifacio Day', 'holiday'),
    (12, 8, 'Feast of the Immaculate Conception', 'holiday'),
    (12, 24, 'Christmas Eve', 'holiday'),
    (12, 25, 'Christmas Day', 'holiday'),
    (12, 30, 'Rizal Day', 'holiday'),
    (12, 31, 'New Year''s Eve', 'holiday')
  ) as h(m, d, n, k)
  on conflict do nothing;

  -- Content for the current month across formats, pillars and statuses.
  insert into public.content_items (
    id, workspace_id, brand_id, title, platforms, format_id, pillar_id, caption, hashtags,
    call_to_action, purpose, scheduled_date, scheduled_time, deadline_date, status, is_demo
  )
  select
    md5('joyno-demo-content-' || s.n)::uuid, v_ws, s.brand, s.title, s.platforms,
    (v_fmt ->> s.fmt)::uuid, (v_pil ->> s.pillar)::uuid, s.caption, s.tags, s.cta, s.purpose,
    case when s.day is null then null else v_month_start + (s.day - 1) end,
    s.at::time,
    case when s.day is null then null else v_month_start + greatest(s.day - 4, 0) end,
    s.status::public.content_status, true
  from (values
    (1, v_brand_joyno, 'How we plan a month of content in one afternoon', array['Facebook','Instagram'], 'Carousel', 'Planning',
      'Planning a month of posts doesn''t need a week of meetings. Here''s our 5-step process, from goals to a finished calendar.', array['#ContentPlanning','#JoynoMedia'],
      'Save this for your next planning session.', 'Show our process and build trust', 2, '09:00', 'published'),
    (2, v_brand_joyno, 'Behind the scenes: a client shoot day', array['Instagram','TikTok'], 'Reel', 'People',
      null, array['#BTS'], null, 'Humanise the team', 3, '18:00', 'published'),
    (3, v_brand_joyno, '5 signs your brand needs a content refresh', array['Facebook','LinkedIn'], 'Carousel', 'Strategy',
      'If your engagement has flattened, your visuals feel dated or your audience changed, it might be time for a refresh.', array['#BrandStrategy','#Marketing'],
      'Book a free content audit.', 'Lead generation', 5, '10:00', 'approved'),
    (4, v_brand_joyno, 'SEO myths we still hear every week', array['Facebook','LinkedIn'], 'Static Post', 'Search',
      'Myth: you need to post a blog every day to rank. Reality: consistency and relevance beat volume.', array['#SEO'],
      'Comment your biggest SEO question.', 'Education', 8, '11:00', 'for_review'),
    (5, v_brand_joyno, 'Client spotlight: growing a café''s foot traffic', array['Facebook','Instagram'], 'Carousel', 'Growth',
      null, array['#CaseStudy'], 'Message us to start your growth plan.', 'Social proof', 10, null, 'in_production'),
    (6, v_brand_joyno, 'Meet the team: our lead designer', array['Instagram'], 'Static Post', 'People',
      null, '{}'::text[], null, 'Culture', 12, null, 'needs_revision'),
    (7, v_brand_joyno, 'Website speed checklist for small businesses', array['Facebook','LinkedIn'], 'Carousel', 'Web',
      null, array['#WebDesign'], 'Download the checklist.', 'Lead magnet', 15, '09:30', 'in_production'),
    (8, v_brand_joyno, 'Ask us anything: social media edition', array['Facebook','Instagram'], 'Community Engagement', 'Community',
      null, array['#AskJoyno'], 'Drop your questions below.', 'Engagement', 17, '19:00', 'planned'),
    (9, v_brand_joyno, 'Boosted post vs. ad campaign: what''s the difference?', array['Facebook'], 'Reel', 'Paid Ads',
      null, array['#MetaAds'], null, 'Education', 19, null, 'planned'),
    (10, v_brand_joyno, 'The three metrics that actually matter', array['LinkedIn','Facebook'], 'Static Post', 'Analytics',
      null, array['#Analytics'], null, 'Thought leadership', 22, null, 'planned'),
    (11, v_brand_joyno, 'Lead magnet ideas you can make this week', array['Facebook','Instagram'], 'Carousel', 'Leads',
      null, array['#LeadGeneration'], 'Save and share with your team.', 'Lead generation', 24, null, 'planned'),
    (12, v_brand_joyno, 'Holiday campaign planning starts now', array['Facebook','Instagram'], 'Reel', 'Creative',
      null, '{}'::text[], null, 'Seasonal', 26, null, 'planned'),
    (13, v_brand_joyno, 'Monthly wins recap', array['Facebook','Instagram'], 'Static Post', 'Growth',
      null, '{}'::text[], null, 'Community', 28, null, 'cancelled'),
    (14, v_brand_joyno, 'Idea: day-in-the-life of a social media manager', array['TikTok','Instagram'], 'Reel', 'People',
      null, '{}'::text[], null, 'Backlog idea', null, null, 'planned'),
    (15, v_brand_cafe, 'New seasonal latte launch', array['Instagram','Facebook'], 'Reel', 'Creative',
      null, array['#KapeKultura'], 'Visit us this weekend.', 'Product launch', 4, '08:00', 'approved'),
    (16, v_brand_cafe, 'Barista tips: brewing at home', array['Instagram'], 'Carousel', 'Community',
      null, '{}'::text[], null, 'Education', 11, null, 'in_production'),
    (17, v_brand_clinic, 'Why kids should see a dentist by age one', array['Facebook'], 'Static Post', 'Strategy',
      null, '{}'::text[], 'Book a check-up.', 'Awareness', 9, null, 'for_review'),
    (18, v_brand_clinic, 'Meet Dr. Reyes', array['Facebook','Instagram'], 'Reel', 'People',
      null, '{}'::text[], null, 'Trust', 20, null, 'planned')
  ) as s(n, brand, title, platforms, fmt, pillar, caption, tags, cta, purpose, day, at, status)
  on conflict (id) do nothing;

  -- Park the backlog idea inside the demo plan.
  update public.content_items
     set monthly_plan_id = v_plan
   where id = md5('joyno-demo-content-14')::uuid and monthly_plan_id is null;

  -- Attach dev users created by scripts/seed-dev-users.mjs, if they exist.
  insert into public.workspace_members (workspace_id, user_id, role)
  select v_ws, u.id,
    case split_part(u.email, '@', 1) when 'admin' then 'admin' when 'editor' then 'editor' else 'viewer' end::public.workspace_role
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.email in ('admin@demo.joyno.local', 'editor@demo.joyno.local', 'viewer@demo.joyno.local')
  on conflict (workspace_id, user_id) do nothing;

  -- The demo editor works on two brands and owns their posts; the demo admin
  -- owns everything else (every post needs an owner — see migration 900).
  insert into public.brand_editors (workspace_id, brand_id, user_id)
  select v_ws, b.id, u.id
  from auth.users u
  cross join (values (v_brand_joyno), (v_brand_cafe)) as b(id)
  where u.email = 'editor@demo.joyno.local'
  on conflict (brand_id, user_id) do nothing;

  update public.content_items c
     set assigned_to = u.id
    from auth.users u
   where u.email = 'editor@demo.joyno.local'
     and c.workspace_id = v_ws and c.assigned_to is null
     and c.brand_id in (v_brand_joyno, v_brand_cafe);

  update public.content_items c
     set assigned_to = u.id
    from auth.users u
   where u.email = 'admin@demo.joyno.local'
     and c.workspace_id = v_ws and c.assigned_to is null;
end
$$;
