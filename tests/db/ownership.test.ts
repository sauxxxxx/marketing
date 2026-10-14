import { TestDb, createWorkspace, expectDbError, insertContent, postgres, user, type WorkspaceFixture } from './harness'

describe('owner-based visibility and brand editors', () => {
  let db: TestDb
  let ws: WorkspaceFixture
  let editor2: string
  let brand2: string

  beforeAll(async () => {
    db = await TestDb.create()
    ws = await createWorkspace(db, 'own', true)
    editor2 = await db.createAuthUser('editor2.own@example.test', 'Second Editor')
    await db.run(postgres, `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'editor')`, [ws.workspaceId, editor2])
    brand2 = (await db.one<{ id: string }>(postgres, `insert into public.brands (workspace_id, name) values ($1, 'Second Brand') returning id`, [ws.workspaceId])).id
    // editor2 co-edits the fixture brand and is the only editor of brand2.
    await db.run(user(ws.adminId), `insert into public.brand_editors (workspace_id, brand_id, user_id) values ($1, $2, $3), ($1, $4, $3)`, [
      ws.workspaceId,
      ws.brandId,
      editor2,
      brand2,
    ])
  })
  afterAll(() => db.close())

  const visibleIds = async (actor: string) =>
    (await db.run<{ id: string }>(user(actor), `select id from public.content_items order by created_at`)).map((r) => r.id)

  it('editors see only their own posts; admins and viewers see all', async () => {
    const mine = await insertContent(db, user(ws.editorId), ws, { title: 'Editor one post' })
    const theirs = await insertContent(db, user(editor2), ws, { title: 'Editor two post' })

    expect(await visibleIds(ws.editorId)).toContain(mine)
    expect(await visibleIds(ws.editorId)).not.toContain(theirs)
    expect(await visibleIds(editor2)).toContain(theirs)
    expect(await visibleIds(editor2)).not.toContain(mine)
    for (const actor of [ws.adminId, ws.viewerId]) {
      const ids = await visibleIds(actor)
      expect(ids).toEqual(expect.arrayContaining([mine, theirs]))
    }

    const write = await db.run(user(ws.editorId), `update public.content_items set title = 'hijack' where id = $1 returning id`, [theirs])
    expect(write).toHaveLength(0)
  })

  it('hides another editor’s activity, attachments and files', async () => {
    const theirs = await insertContent(db, user(editor2), ws, { title: 'Private draft' })
    const path = `${ws.workspaceId}/content/${theirs}/brief.pdf`
    await db.run(user(editor2), `insert into storage.objects (bucket_id, name) values ('workspace-files', $1)`, [path])
    await db.run(
      user(editor2),
      `insert into public.content_assets (workspace_id, content_id, kind, storage_path, file_name) values ($1, $2, 'document', $3, 'brief.pdf')`,
      [ws.workspaceId, theirs, path],
    )

    expect(await db.run(user(ws.editorId), `select id from public.content_activity where content_id = $1`, [theirs])).toHaveLength(0)
    expect(await db.run(user(ws.editorId), `select id from public.content_assets where content_id = $1`, [theirs])).toHaveLength(0)
    expect(await db.run(user(ws.editorId), `select id from storage.objects where name = $1`, [path])).toHaveLength(0)
    await expectDbError(
      db.run(user(ws.editorId), `insert into storage.objects (bucket_id, name) values ('workspace-files', $1)`, [`${ws.workspaceId}/content/${theirs}/x.pdf`]),
      /row-level security/,
    )

    expect(await db.run(user(editor2), `select id from public.content_activity where content_id = $1`, [theirs])).not.toHaveLength(0)
    expect(await db.run(user(ws.viewerId), `select id from public.content_assets where content_id = $1`, [theirs])).toHaveLength(1)
    expect(await db.run(user(ws.adminId), `select id from storage.objects where name = $1`, [path])).toHaveLength(1)
  })

  it('limits editors to the brands they are assigned to', async () => {
    await expectDbError(
      db.run(user(ws.editorId), `insert into public.content_items (workspace_id, brand_id, format_id, title) values ($1, $2, $3, 'x')`, [
        ws.workspaceId,
        brand2,
        ws.formatIds.Carousel,
      ]),
      /aren't assigned to this brand/,
    )
    const own = await insertContent(db, user(ws.editorId), ws)
    await expectDbError(
      db.run(user(ws.editorId), `update public.content_items set brand_id = $2 where id = $1`, [own, brand2]),
      /aren't assigned to this brand/,
    )
  })

  it('defaults owners to the creator, never allows unassigning, and checks the brand', async () => {
    const adminPost = await insertContent(db, user(ws.adminId), ws)
    const created = await db.one<{ assigned_to: string }>(postgres, `select assigned_to from public.content_items where id = $1`, [adminPost])
    expect(created.assigned_to).toBe(ws.adminId)

    await expectDbError(
      db.run(user(ws.adminId), `update public.content_items set assigned_to = null where id = $1`, [adminPost]),
      /Content must have an owner/,
    )

    const brand2Post = (
      await db.one<{ id: string }>(
        user(ws.adminId),
        `insert into public.content_items (workspace_id, brand_id, format_id, title) values ($1, $2, $3, 'Brand two') returning id`,
        [ws.workspaceId, brand2, ws.formatIds.Carousel],
      )
    ).id
    await expectDbError(
      db.run(user(ws.adminId), `update public.content_items set assigned_to = $2 where id = $1`, [brand2Post, ws.editorId]),
      /isn't assigned to this brand/,
    )
    await db.run(user(ws.adminId), `update public.content_items set assigned_to = $2 where id = $1`, [brand2Post, editor2])
    expect(await visibleIds(editor2)).toContain(brand2Post)
  })

  it('only administrators manage brand editors, and only editors can be added', async () => {
    await expectDbError(
      db.run(user(ws.editorId), `insert into public.brand_editors (workspace_id, brand_id, user_id) values ($1, $2, $3)`, [ws.workspaceId, brand2, ws.editorId]),
      /row-level security/,
    )
    await expectDbError(
      db.run(user(ws.adminId), `insert into public.brand_editors (workspace_id, brand_id, user_id) values ($1, $2, $3)`, [ws.workspaceId, brand2, ws.viewerId]),
      /Only editors can be assigned to brands/,
    )
    const removed = await db.run(user(ws.editorId), `delete from public.brand_editors where user_id = $1 returning id`, [editor2])
    expect(removed).toHaveLength(0)
  })

  it('scopes monthly plans to an editor’s brands', async () => {
    await db.run(user(ws.adminId), `insert into public.monthly_plans (workspace_id, brand_id, year, month, title) values ($1, $2, 2027, 2, 'Brand two Feb')`, [
      ws.workspaceId,
      brand2,
    ])
    const seen = await db.run<{ title: string }>(user(ws.editorId), `select title from public.monthly_plans`)
    expect(seen.map((p) => p.title)).not.toContain('Brand two Feb')
    expect((await db.run<{ title: string }>(user(editor2), `select title from public.monthly_plans`)).map((p) => p.title)).toContain('Brand two Feb')
    await expectDbError(
      db.run(user(ws.editorId), `insert into public.monthly_plans (workspace_id, brand_id, year, month, title) values ($1, $2, 2027, 3, 'Nope')`, [ws.workspaceId, brand2]),
      /row-level security/,
    )
  })

  it('lets an editor duplicate only their own posts, owned by them', async () => {
    const plan = await db.one<{ id: string }>(
      user(ws.adminId),
      `insert into public.monthly_plans (workspace_id, brand_id, year, month, title) values ($1, $2, 2027, 4, 'April') returning id`,
      [ws.workspaceId, ws.brandId],
    )
    await insertContent(db, user(ws.editorId), ws, { title: 'Mine in April', scheduled_date: '2027-04-10' })
    await insertContent(db, user(editor2), ws, { title: 'Theirs in April', scheduled_date: '2027-04-11' })

    const rows = await db.run<{ title: string; new_item_id: string }>(
      user(ws.editorId),
      `select * from public.duplicate_monthly_plan($1, $2, 2027, 5, 'full', false, 'last_day', false)`,
      [plan.id, ws.brandId],
    )
    expect(rows.map((r) => r.title)).toEqual(['Mine in April'])
    const copy = await db.one<{ assigned_to: string }>(postgres, `select assigned_to from public.content_items where id = $1`, [rows[0].new_item_id])
    expect(copy.assigned_to).toBe(ws.editorId)

    await expectDbError(
      db.run(user(ws.editorId), `select * from public.duplicate_monthly_plan($1, $2, 2027, 6, 'full', false, 'last_day', true)`, [plan.id, brand2]),
      /aren't assigned to the target brand/,
    )
  })
})

describe('ownership backfill (migration 900 on existing data)', () => {
  it('gives every post an owner and makes working editors brand editors', async () => {
    const db = await TestDb.create({ stopBefore: '20261013000900' })
    try {
      const adminId = await db.createAuthUser('admin.bf@example.test')
      const editorId = await db.createAuthUser('editor.bf@example.test')
      const goneId = await db.createAuthUser('gone.bf@example.test')
      const ws = await db.one<{ id: string }>(postgres, `select public.bootstrap_existing_user('admin.bf@example.test', 'Admin', 'Backfill') as id`)
      await db.run(postgres, `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'editor'), ($1, $3, 'editor')`, [ws.id, editorId, goneId])
      const brand = await db.one<{ id: string }>(postgres, `insert into public.brands (workspace_id, name) values ($1, 'B') returning id`, [ws.id])
      const format = await db.one<{ id: string }>(postgres, `select id from public.content_formats where workspace_id = $1 limit 1`, [ws.id])
      const insert = (title: string, createdBy: string) =>
        db.one<{ id: string }>(
          postgres,
          `insert into public.content_items (workspace_id, brand_id, format_id, title, created_by) values ($1, $2, $3, $4, $5) returning id`,
          [ws.id, brand.id, format.id, title, createdBy],
        )
      const byEditor = await insert('By editor', editorId)
      const byGone = await insert('By departed editor', goneId)
      await db.run(postgres, `update public.workspace_members set status = 'deactivated' where user_id = $1`, [goneId])

      await db.applyRemainingMigrations('20261013000900')

      const owners = await db.run<{ id: string; assigned_to: string }>(postgres, `select id, assigned_to from public.content_items`)
      const byId = Object.fromEntries(owners.map((o) => [o.id, o.assigned_to]))
      expect(byId[byEditor.id]).toBe(editorId)
      expect(byId[byGone.id]).toBe(adminId)
      const editors = await db.run<{ user_id: string }>(postgres, `select user_id from public.brand_editors where brand_id = $1`, [brand.id])
      expect(editors.map((e) => e.user_id)).toEqual([editorId])
    } finally {
      await db.close()
    }
  })
})
