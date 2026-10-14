import { TestDb, createWorkspace, expectDbError, insertContent, postgres, user, type WorkspaceFixture } from './harness'
import { CONTENT_STATUSES, canTransition } from '../../src/lib/status'

describe('content workflow', () => {
  let db: TestDb
  let ws: WorkspaceFixture

  beforeAll(async () => {
    db = await TestDb.create()
    ws = await createWorkspace(db, 'wf', true)
  })
  afterAll(() => db.close())

  const setStatus = (actor: string, id: string, status: string) =>
    db.run(user(actor), `update public.content_items set status = $2::public.content_status where id = $1 returning status`, [
      id,
      status,
    ])

  it('follows the standard path and records approval separately from publication', async () => {
    const id = await insertContent(db, user(ws.editorId), ws)
    await setStatus(ws.editorId, id, 'in_production')
    await setStatus(ws.editorId, id, 'for_review')
    await setStatus(ws.adminId, id, 'approved')

    const approved = await db.one<{ status: string; approved_by: string; approved_at: string; published_at: string | null }>(
      postgres,
      `select status, approved_by, approved_at, published_at from public.content_items where id = $1`,
      [id],
    )
    expect(approved.status).toBe('approved')
    expect(approved.approved_by).toBe(ws.adminId)
    expect(approved.approved_at).toBeTruthy()
    expect(approved.published_at).toBeNull()

    await setStatus(ws.editorId, id, 'published')
    const published = await db.one<{ approved_by: string; published_at: string }>(
      postgres,
      `select approved_by, published_at from public.content_items where id = $1`,
      [id],
    )
    expect(published.approved_by).toBe(ws.adminId)
    expect(published.published_at).toBeTruthy()

    const actions = await db.run<{ action: string }>(
      user(ws.viewerId),
      `select action from public.content_activity where content_id = $1 order by id`,
      [id],
    )
    expect(actions.map((a) => a.action)).toEqual(['created', 'status_changed', 'status_changed', 'approved', 'published'])
  })

  it('supports the revision loop and clears approval when sent back', async () => {
    const id = await insertContent(db, user(ws.editorId), ws, { status: 'for_review' })
    await setStatus(ws.editorId, id, 'approved')
    await setStatus(ws.editorId, id, 'needs_revision')
    const row = await db.one<{ approved_by: string | null }>(
      postgres,
      `select approved_by from public.content_items where id = $1`,
      [id],
    )
    expect(row.approved_by).toBeNull()
    await setStatus(ws.editorId, id, 'in_production')
  })

  it('rejects transitions outside the policy', async () => {
    const id = await insertContent(db, user(ws.editorId), ws)
    await expectDbError(setStatus(ws.editorId, id, 'published'), /Status cannot change from Planned to Published/)
    await expectDbError(setStatus(ws.adminId, id, 'approved'), /Status cannot change from Planned to Approved/)
  })

  it('only lets administrators reopen published content; editors may restore cancelled content', async () => {
    const id = await insertContent(db, user(ws.editorId), ws, { status: 'approved' })
    await setStatus(ws.editorId, id, 'published')
    await expectDbError(setStatus(ws.editorId, id, 'approved'), /cannot change from Published to Approved/)
    await setStatus(ws.adminId, id, 'approved')

    await setStatus(ws.editorId, id, 'cancelled')
    await setStatus(ws.editorId, id, 'planned')
    const actions = await db.run<{ action: string }>(
      postgres,
      `select action from public.content_activity where content_id = $1 and action = 'reopened'`,
      [id],
    )
    expect(actions).toHaveLength(2)
  })

  it('matches the frontend transition table exactly', async () => {
    const rows = await db.run<{ f: string; t: string; role: string; ok: boolean }>(
      postgres,
      `select f::text as f, t::text as t, r::text as role, public.is_status_transition_allowed(f, t, r) as ok
       from unnest(enum_range(null::public.content_status)) f
       cross join unnest(enum_range(null::public.content_status)) t
       cross join unnest(enum_range(null::public.workspace_role)) r`,
    )
    expect(rows).toHaveLength(CONTENT_STATUSES.length ** 2 * 3)
    for (const row of rows) {
      expect(canTransition(row.f as never, row.t as never, row.role as never), `${row.f}→${row.t} as ${row.role}`).toBe(row.ok)
    }
  })

  it('logs rescheduling, assignment and field edits', async () => {
    // Created by an admin (so owned by the admin), then handed to the editor.
    const id = await insertContent(db, user(ws.adminId), ws, { scheduled_date: '2026-11-03' })
    await db.run(user(ws.adminId), `update public.content_items set scheduled_date = '2026-11-05' where id = $1`, [id])
    await db.run(user(ws.adminId), `update public.content_items set assigned_to = $2 where id = $1`, [id, ws.editorId])
    await db.run(user(ws.editorId), `update public.content_items set caption = 'Hello', hashtags = '{#a}' where id = $1`, [id])
    const rows = await db.run<{ action: string; details: Record<string, unknown> }>(
      postgres,
      `select action, details from public.content_activity where content_id = $1 order by id`,
      [id],
    )
    expect(rows.map((r) => r.action)).toEqual(['created', 'rescheduled', 'assigned', 'updated'])
    expect(rows[1].details).toMatchObject({ from_date: '2026-11-03', to_date: '2026-11-05' })
    expect(rows[3].details).toEqual({ fields: ['caption', 'hashtags'] })

    const editor = await db.one<{ updated_by: string }>(postgres, `select updated_by from public.content_items where id = $1`, [id])
    expect(editor.updated_by).toBe(ws.editorId)
  })

  it('allows unscheduled ideas and validates time/date and URLs', async () => {
    const idea = await insertContent(db, user(ws.editorId), ws, { scheduled_date: null, title: 'Idea' })
    expect(idea).toBeTruthy()
    await expectDbError(
      db.run(user(ws.editorId), `update public.content_items set scheduled_time = '10:00' where id = $1`, [idea]),
      /content_time_requires_date/,
    )
    await expectDbError(
      db.run(user(ws.editorId), `update public.content_items set published_url = 'javascript:alert(1)' where id = $1`, [idea]),
      /check constraint/,
    )
    await expectDbError(
      db.run(user(ws.editorId), `update public.content_items set reference_urls = '{"ftp://x"}' where id = $1`, [idea]),
      /check constraint/,
    )
  })

  it('links scheduled content to the brand/month plan automatically', async () => {
    const before = await insertContent(db, user(ws.editorId), ws, { scheduled_date: '2026-12-04' })
    const plan = await db.one<{ id: string }>(
      user(ws.editorId),
      `insert into public.monthly_plans (workspace_id, brand_id, year, month, title) values ($1, $2, 2026, 12, 'Dec') returning id`,
      [ws.workspaceId, ws.brandId],
    )
    const after = await insertContent(db, user(ws.editorId), ws, { scheduled_date: '2026-12-20' })
    const outside = await insertContent(db, user(ws.editorId), ws, { scheduled_date: '2027-01-02' })
    const rows = await db.run<{ id: string; monthly_plan_id: string | null }>(
      postgres,
      `select id, monthly_plan_id from public.content_items where id = any($1)`,
      [[before, after, outside]],
    )
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.monthly_plan_id]))
    expect(byId[before]).toBe(plan.id)
    expect(byId[after]).toBe(plan.id)
    expect(byId[outside]).toBeNull()

    // Rescheduling out of the month unlinks it.
    await db.run(user(ws.editorId), `update public.content_items set scheduled_date = '2027-01-15' where id = $1`, [after])
    const moved = await db.one<{ monthly_plan_id: string | null }>(
      postgres,
      `select monthly_plan_id from public.content_items where id = $1`,
      [after],
    )
    expect(moved.monthly_plan_id).toBeNull()
  })

  it('prevents duplicate plans for the same brand and month', async () => {
    await db.run(
      user(ws.adminId),
      `insert into public.monthly_plans (workspace_id, brand_id, year, month, title) values ($1, $2, 2027, 3, 'Mar')`,
      [ws.workspaceId, ws.brandId],
    )
    await expectDbError(
      db.run(
        user(ws.adminId),
        `insert into public.monthly_plans (workspace_id, brand_id, year, month, title) values ($1, $2, 2027, 3, 'Mar again')`,
        [ws.workspaceId, ws.brandId],
      ),
      /monthly_plans_one_per_brand_month/,
    )
  })

  it('protects referenced formats from deletion and blocks inactive ones for new content', async () => {
    await insertContent(db, user(ws.editorId), ws, { format: 'Reel' })
    await expectDbError(
      db.run(user(ws.adminId), `delete from public.content_formats where id = $1`, [ws.formatIds.Reel]),
      /foreign key/,
    )
    await db.run(user(ws.adminId), `update public.content_formats set is_active = false where id = $1`, [ws.formatIds.Other])
    await expectDbError(insertContent(db, user(ws.editorId), ws, { format: 'Other' }), /active content format/)
    await db.run(user(ws.adminId), `update public.content_formats set is_active = true where id = $1`, [ws.formatIds.Other])
  })

  it('rejects an invalid workspace timezone', async () => {
    await expectDbError(
      db.run(user(ws.adminId), `update public.workspaces set timezone = 'Mars/Olympus' where id = $1`, [ws.workspaceId]),
      /valid timezone/,
    )
  })

  it('maintains a search column that clients cannot write', async () => {
    const id = await insertContent(db, user(ws.editorId), ws, { title: 'Holiday Sale' })
    await db.run(user(ws.editorId), `update public.content_items set caption = 'Big Savings', hashtags = '{#PaskoNa}' where id = $1`, [id])
    const found = await db.run(user(ws.viewerId), `select id from public.content_items where search_text like '%paskona%'`)
    expect(found.map((r) => (r as { id: string }).id)).toContain(id)
    await expectDbError(
      db.run(user(ws.editorId), `update public.content_items set search_text = 'x' where id = $1`, [id]),
      /permission denied/,
    )
  })
})
