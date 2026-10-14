#!/usr/bin/env node
// Creates three DEVELOPMENT users and adds them to the demo workspace created
// by supabase/seed.sql:
//   admin@demo.joyno.local   (Administrator)
//   editor@demo.joyno.local  (Editor)
//   viewer@demo.joyno.local  (Viewer)
//
// Safety rails:
//   * The password must come from DEV_SEED_PASSWORD (no default) and meet the
//     app's password policy.
//   * Refuses to run against a non-local Supabase URL unless
//     ALLOW_REMOTE_SEED=1 is set explicitly (e.g. a disposable staging project).
//   * Idempotent: existing users are reused, memberships are upserted, and
//     nothing outside the demo workspace is touched.
//
// Usage (local):
//   npx supabase db reset            # applies migrations + seed.sql
//   SUPABASE_URL=http://127.0.0.1:54321 \
//   SUPABASE_SERVICE_ROLE_KEY=<from `npx supabase status`> \
//   DEV_SEED_PASSWORD='Choose-A-Strong-Passw0rd' npm run seed:users
import { createClient } from '@supabase/supabase-js'

const DEMO_WORKSPACE_ID = '0d3e0000-0000-4000-8000-000000000001'
const USERS = [
  { email: 'admin@demo.joyno.local', name: 'Demo Admin', role: 'admin' },
  { email: 'editor@demo.joyno.local', name: 'Demo Editor', role: 'editor' },
  { email: 'viewer@demo.joyno.local', name: 'Demo Viewer', role: 'viewer' },
]

function fail(message) {
  console.error(`✖ ${message}`)
  process.exit(1)
}

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = process.env.DEV_SEED_PASSWORD

if (!url || !serviceKey) fail('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see `npx supabase status`).')
if (!password) fail('Set DEV_SEED_PASSWORD. There is deliberately no default password.')
if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
  fail('DEV_SEED_PASSWORD must be at least 12 characters with upper- and lower-case letters and a number.')
}
const host = new URL(url).hostname
if (!['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(host) && process.env.ALLOW_REMOTE_SEED !== '1') {
  fail(`Refusing to seed ${host}. Set ALLOW_REMOTE_SEED=1 only for a disposable non-production project.`)
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

const { data: workspace, error: wsError } = await admin.from('workspaces').select('id, name, is_demo').eq('id', DEMO_WORKSPACE_ID).maybeSingle()
if (wsError) fail(`Could not read workspaces: ${wsError.message}`)
if (!workspace) fail('Demo workspace not found. Run supabase/seed.sql first (`npx supabase db reset` locally).')
if (!workspace.is_demo) fail('Workspace with the demo ID is not flagged is_demo; aborting.')

const existing = new Map()
for (let page = 1; ; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
  if (error) fail(`Could not list users: ${error.message}`)
  for (const u of data.users) existing.set(u.email?.toLowerCase(), u)
  if (data.users.length < 200) break
}

for (const spec of USERS) {
  let user = existing.get(spec.email)
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email: spec.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: spec.name },
    })
    if (error) fail(`Could not create ${spec.email}: ${error.message}`)
    user = data.user
    console.log(`✔ created ${spec.email}`)
  } else {
    console.log(`• ${spec.email} already exists (password unchanged)`)
  }
  const { error: memberError } = await admin
    .from('workspace_members')
    .upsert({ workspace_id: DEMO_WORKSPACE_ID, user_id: user.id, role: spec.role, status: 'active' }, { onConflict: 'workspace_id,user_id' })
  if (memberError) fail(`Could not add ${spec.email} to the demo workspace: ${memberError.message}`)
  console.log(`  → ${spec.role} in "${workspace.name}"`)
}

// Demo editor works on two brands and owns their posts; the admin owns the rest.
const ids = {}
for (let page = 1; ; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
  if (error) fail(`Could not list users: ${error.message}`)
  for (const u of data.users) {
    const spec = USERS.find((x) => x.email === u.email?.toLowerCase())
    if (spec) ids[spec.role] = u.id
  }
  if (data.users.length < 200) break
}
const EDITOR_BRANDS = ['0d3e0000-0000-4000-8000-0000000000b1', '0d3e0000-0000-4000-8000-0000000000b2']
const { error: beError } = await admin
  .from('brand_editors')
  .upsert(EDITOR_BRANDS.map((brand_id) => ({ workspace_id: DEMO_WORKSPACE_ID, brand_id, user_id: ids.editor })), { onConflict: 'brand_id,user_id' })
if (beError) fail(`Could not assign the demo editor to brands: ${beError.message}`)
for (const [userId, brands] of [[ids.editor, EDITOR_BRANDS], [ids.admin, null]]) {
  let query = admin.from('content_items').update({ assigned_to: userId }).eq('workspace_id', DEMO_WORKSPACE_ID).is('assigned_to', null)
  if (brands) query = query.in('brand_id', brands)
  const { error } = await query
  if (error) fail(`Could not assign demo posts: ${error.message}`)
}
console.log('✔ demo editor assigned to Joyno Media and Kape Kultura Café; every demo post has an owner')

console.log('\nDone. Sign in at http://localhost:5173 with any of the demo emails and your DEV_SEED_PASSWORD.')
