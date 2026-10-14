import { TestDb, createWorkspace, expectDbError, insertContent, postgres, user, type WorkspaceFixture } from './harness'

interface PreviewRow {
  source_item_id: string
  title: string
  source_date: string | null
  target_date: string | null
  outcome: string
  is_weekend: boolean
  key_dates: string | null
  target_plan_id: string | null
  new_item_id: string | null
}

describe('monthly plan duplication', () => {
  let db: TestDb
  let ws: WorkspaceFixture
  let planId: string
  let sourceIds: string[]

  beforeAll(async () => {
    db = await TestDb.create()
    ws = await createWorkspace(db, 'dup', true)
    const plan = await db.one<{ id: string }>(
      user(ws.editorId),
      `insert into public.monthly_plans (workspace_id, brand_id, year, month, title) values ($1, $2, 2027, 1, 'January') returning id`,
      [ws.workspaceId, ws.brandId],
    )
    planId = plan.id
    const a = await insertContent(db, user(ws.adminId), ws, { scheduled_date: '2027-01-05', title: 'Kickoff', assigned_to: ws.editorId })
    const b = await insertContent(db, user(ws.editorId), ws, { scheduled_date: '2027-01-30', title: 'Month end' })
    const c = await insertContent(db, user(ws.editorId), ws, { scheduled_date: '2027-01-31', title: 'Last day' })
    const cancelled = await insertContent(db, user(ws.editorId), ws, { scheduled_date: '2027-01-12', title: 'Dropped', status: 'cancelled' })
    await db.run(
      user(ws.editorId),
      `update public.content_items set caption = 'Full caption', hashtags = '{#joyno}', status = 'in_production' where id = $1`,
      [a],
    )
    await db.run(user(ws.editorId), `update public.content_items set status = 'for_review' where id = $1`, [a])
    await db.run(user(ws.editorId), `update public.content_items set status = 'approved' where id = $1`, [a])
    await db.run(user(ws.editorId), `update public.content_items set status = 'published', published_url = 'https://fb.com/p/1' where id = $1`, [a])
    const idea = await insertContent(db, user(ws.editorId), ws, { scheduled_date: null, title: 'Parked idea' })
    await db.run(user(ws.editorId), `update public.content_items set monthly_plan_id = $2 where id = $1`, [idea, planId])
    await db.run(user(ws.adminId), `insert into public.key_dates (workspace_id, date, name) values ($1, '2027-02-25', 'EDSA Anniversary')`, [
      ws.workspaceId,
    ])
    sourceIds = [a, b, c, cancelled, idea]
  })
  afterAll(() => db.close())

  const duplicate = (actor: string, opts: Partial<{ mode: string; unscheduled: boolean; strategy: string; dry: boolean; month: number }>) =>
    db.run<PreviewRow>(
      user(actor),
      `select * from public.duplicate_monthly_plan($1, $2, 2027, $3, $4, $5, $6, $7)`,
      [planId, ws.brandId, opts.month ?? 2, opts.mode ?? 'full', opts.unscheduled ?? false, opts.strategy ?? 'last_day', opts.dry ?? true],
    )

  async function snapshot() {
    return db.run(postgres, `select * from public.content_items where id = any($1) order by id`, [sourceIds])
  }

  it('previews target dates without writing anything', async () => {
    const before = await db.one<{ n: number }>(postgres, `select count(*)::int as n from public.content_items`)
    const rows = await duplicate(ws.editorId, { unscheduled: true })
    expect(rows.map((r) => [r.title, r.target_date, r.outcome])).toEqual([
      ['Kickoff', '2027-02-05', 'copy'],
      ['Month end', '2027-02-28', 'moved_to_last_day'],
      ['Last day', '2027-02-28', 'moved_to_last_day'],
      ['Parked idea', null, 'copy_unscheduled'],
    ])
    expect(rows.find((r) => r.title === 'Month end')?.is_weekend).toBe(true) // 28 Feb 2027 is a Sunday
    const after = await db.one<{ n: number }>(postgres, `select count(*)::int as n from public.content_items`)
    expect(after.n).toBe(before.n)
    expect(await db.run(postgres, `select 1 from public.monthly_plans where year = 2027 and month = 2`)).toHaveLength(0)
  })

  it('supports skip and unscheduled strategies for missing dates', async () => {
    const skip = await duplicate(ws.editorId, { strategy: 'skip' })
    expect(skip.filter((r) => r.outcome === 'skipped_missing_date').map((r) => r.title)).toEqual(['Month end', 'Last day'])
    const unscheduled = await duplicate(ws.editorId, { strategy: 'unscheduled' })
    expect(unscheduled.filter((r) => r.outcome === 'moved_to_unscheduled')).toHaveLength(2)
  })

  it('flags key dates in the target month', async () => {
    const rows = await db.run<PreviewRow>(
      user(ws.editorId),
      `select * from public.duplicate_monthly_plan($1, $2, 2027, 2, 'full', false, 'last_day', true)`,
      [planId, ws.brandId],
    )
    expect(rows.every((r) => r.key_dates === null)).toBe(true)
    await insertContent(db, user(ws.editorId), ws, { scheduled_date: '2027-01-25', title: 'Late Jan' })
    const withKey = await duplicate(ws.editorId, {})
    expect(withKey.find((r) => r.title === 'Late Jan')?.key_dates).toBe('EDSA Anniversary')
    await db.run(postgres, `delete from public.content_items where title = 'Late Jan'`)
  })

  it('copies into a new plan with fresh IDs, reset statuses and cleared publication data', async () => {
    const before = await snapshot()
    const rows = await duplicate(ws.editorId, { dry: false, unscheduled: true })
    const created = rows.filter((r) => r.new_item_id)
    expect(created).toHaveLength(4)

    const copies = await db.run<{
      id: string
      title: string
      status: string
      caption: string | null
      published_url: string | null
      published_at: string | null
      approved_by: string | null
      monthly_plan_id: string
      source_item_id: string
      assigned_to: string | null
    }>(postgres, `select * from public.content_items where id = any($1)`, [created.map((r) => r.new_item_id)])

    const targetPlan = rows[0].target_plan_id
    for (const copy of copies) {
      expect(sourceIds).not.toContain(copy.id)
      expect(copy.status).toBe('planned')
      expect(copy.published_url).toBeNull()
      expect(copy.published_at).toBeNull()
      expect(copy.approved_by).toBeNull()
      expect(copy.monthly_plan_id).toBe(targetPlan)
    }
    const kickoff = copies.find((c) => c.title === 'Kickoff')!
    expect(kickoff.caption).toBe('Full caption')
    // Every copy needs an owner; an editor's copies belong to that editor.
    expect(kickoff.assigned_to).toBe(ws.editorId)

    // Source untouched.
    expect(await snapshot()).toEqual(before)

    // History is not copied — only a "duplicated" event exists.
    const activity = await db.run<{ action: string }>(
      postgres,
      `select action from public.content_activity where content_id = $1`,
      [kickoff.id],
    )
    expect(activity.map((a) => a.action)).toEqual(['duplicated'])
  })

  it('keeps owners when an administrator duplicates with full content', async () => {
    const rows = await duplicate(ws.adminId, { dry: false, month: 6 })
    const copy = await db.one<{ assigned_to: string | null }>(
      postgres,
      `select assigned_to from public.content_items where id = $1`,
      [rows.find((r) => r.title === 'Kickoff')!.new_item_id],
    )
    expect(copy.assigned_to).toBe(ws.editorId)
  })

  it('structure-only mode drops copy and assignment', async () => {
    const rows = await duplicate(ws.editorId, { dry: false, month: 3, mode: 'structure' })
    const copy = await db.one<{ caption: string | null; hashtags: string[]; assigned_to: string | null }>(
      postgres,
      `select caption, hashtags, assigned_to from public.content_items where id = $1`,
      [rows.find((r) => r.title === 'Kickoff')!.new_item_id],
    )
    expect(copy).toEqual({ caption: null, hashtags: [], assigned_to: ws.editorId })
  })

  it('appends into an existing target plan without touching its posts', async () => {
    const existingPlan = await db.one<{ id: string }>(postgres, `select id from public.monthly_plans where year = 2027 and month = 3`)
    const existing = await db.run(postgres, `select * from public.content_items where monthly_plan_id = $1 order by id`, [existingPlan.id])
    const rows = await duplicate(ws.editorId, { dry: false, month: 3 })
    expect(rows[0].target_plan_id).toBe(existingPlan.id)
    const stillThere = await db.run(postgres, `select * from public.content_items where id = any($1) order by id`, [
      existing.map((e) => (e as { id: string }).id),
    ])
    expect(stillThere).toEqual(existing)
  })

  it('rolls back completely when any insert fails', async () => {
    await db.run(
      postgres,
      `create function public.fail_second_copy() returns trigger language plpgsql as $$
       begin
         if new.source_item_id is not null and new.title = 'Month end' then
           raise exception 'simulated failure';
         end if;
         return new;
       end $$;
       `,
    )
    await db.run(postgres, `create trigger fail_second_copy before insert on public.content_items for each row execute function public.fail_second_copy()`)
    const plansBefore = await db.one<{ n: number }>(postgres, `select count(*)::int as n from public.monthly_plans`)
    const itemsBefore = await db.one<{ n: number }>(postgres, `select count(*)::int as n from public.content_items`)

    await expectDbError(duplicate(ws.editorId, { dry: false, month: 4 }), /simulated failure/)

    const plansAfter = await db.one<{ n: number }>(postgres, `select count(*)::int as n from public.monthly_plans`)
    const itemsAfter = await db.one<{ n: number }>(postgres, `select count(*)::int as n from public.content_items`)
    expect(plansAfter.n).toBe(plansBefore.n)
    expect(itemsAfter.n).toBe(itemsBefore.n)
    await db.run(postgres, `drop trigger fail_second_copy on public.content_items`)
  })

  it('is denied to viewers and to editors when the workspace disallows it', async () => {
    await expectDbError(duplicate(ws.viewerId, {}), /permission to duplicate/)
    await db.run(user(ws.adminId), `update public.workspaces set editors_can_duplicate_plans = false where id = $1`, [ws.workspaceId])
    await expectDbError(duplicate(ws.editorId, {}), /permission to duplicate/)
    await duplicate(ws.adminId, {})
    await db.run(user(ws.adminId), `update public.workspaces set editors_can_duplicate_plans = true where id = $1`, [ws.workspaceId])
  })

  it('refuses to copy onto the same brand and month', async () => {
    await expectDbError(duplicate(ws.editorId, { month: 1 }), /different brand or month/)
  })
})

describe('private storage policies', () => {
  let db: TestDb
  let a: WorkspaceFixture
  let b: WorkspaceFixture
  let contentId: string

  beforeAll(async () => {
    db = await TestDb.create()
    a = await createWorkspace(db, 'sa', true)
    b = await createWorkspace(db, 'sb')
    contentId = await insertContent(db, user(a.editorId), a)
  })
  afterAll(() => db.close())

  const upload = (actor: string, name: string) =>
    db.run(user(actor), `insert into storage.objects (bucket_id, name) values ('workspace-files', $1) returning id`, [name])

  it('lets editors upload to content they can edit', async () => {
    await upload(a.editorId, `${a.workspaceId}/content/${contentId}/file-1.png`)
    await db.run(user(a.editorId), `insert into public.content_assets (workspace_id, content_id, kind, storage_path, file_name, mime_type, size_bytes)
      values ($1, $2, 'image', $3, 'file-1.png', 'image/png', 1024)`, [a.workspaceId, contentId, `${a.workspaceId}/content/${contentId}/file-1.png`])
  })

  it('blocks viewers and other workspaces from uploading', async () => {
    await expectDbError(upload(a.viewerId, `${a.workspaceId}/content/${contentId}/v.png`), /row-level security/)
    await expectDbError(upload(b.adminId, `${a.workspaceId}/content/${contentId}/x.png`), /row-level security/)
    await expectDbError(upload(a.editorId, `${a.workspaceId}/branding/logo.png`), /row-level security/)
    await expectDbError(upload(a.editorId, `${a.workspaceId}/content/${contentId}/nested/deep.png`), /row-level security/)
    await expectDbError(upload(a.editorId, `not-a-uuid/content/${contentId}/x.png`), /row-level security/)
  })

  it('lets only members read (and therefore sign URLs for) objects', async () => {
    const own = await db.run(user(a.viewerId), `select name from storage.objects`)
    expect(own).toHaveLength(1)
    const foreign = await db.run(user(b.adminId), `select name from storage.objects`)
    expect(foreign).toHaveLength(0)
    const foreignAssets = await db.run(user(b.adminId), `select * from public.content_assets`)
    expect(foreignAssets).toHaveLength(0)
  })

  it('rejects asset rows whose path points at another content item', async () => {
    const other = await insertContent(db, user(a.editorId), a)
    await expectDbError(
      db.run(user(a.editorId), `insert into public.content_assets (workspace_id, content_id, kind, storage_path) values ($1, $2, 'image', $3)`, [
        a.workspaceId,
        other,
        `${a.workspaceId}/content/${contentId}/file-1.png`,
      ]),
      /does not belong/,
    )
  })

  it('allows administrators to upload branding', async () => {
    await upload(a.adminId, `${a.workspaceId}/branding/logo.png`)
  })

  it('blocks deletion by viewers', async () => {
    const rows = await db.run(user(a.viewerId), `delete from storage.objects returning id`)
    expect(rows).toHaveLength(0)
  })
})
