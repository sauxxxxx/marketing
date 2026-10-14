import {
  TestDb,
  anon,
  createWorkspace,
  expectDbError,
  insertContent,
  postgres,
  user,
  type WorkspaceFixture,
} from './harness'

describe('role-based access control (RLS)', () => {
  let db: TestDb
  let a: WorkspaceFixture
  let b: WorkspaceFixture
  let outsider: string

  beforeAll(async () => {
    db = await TestDb.create()
    a = await createWorkspace(db, 'a', true)
    b = await createWorkspace(db, 'b')
    outsider = await db.createAuthUser('outsider@example.test', 'Out Sider')
  })
  afterAll(() => db.close())

  describe('viewers', () => {
    it('can read content but cannot create, edit or delete it', async () => {
      const id = await insertContent(db, user(a.editorId), a, { title: 'Viewer target' })
      const rows = await db.run(user(a.viewerId), `select id from public.content_items where id = $1`, [id])
      expect(rows).toHaveLength(1)

      await expectDbError(insertContent(db, user(a.viewerId), a), /row-level security|permission to create content/)

      const updated = await db.run(
        user(a.viewerId),
        `update public.content_items set title = 'hacked' where id = $1 returning id`,
        [id],
      )
      expect(updated).toHaveLength(0)
      const deleted = await db.run(user(a.viewerId), `delete from public.content_items where id = $1 returning id`, [id])
      expect(deleted).toHaveLength(0)
      const title = await db.one<{ title: string }>(postgres, `select title from public.content_items where id = $1`, [id])
      expect(title.title).toBe('Viewer target')
    })

    it('cannot change status', async () => {
      const id = await insertContent(db, user(a.adminId), a)
      const updated = await db.run(
        user(a.viewerId),
        `update public.content_items set status = 'in_production' where id = $1 returning id`,
        [id],
      )
      expect(updated).toHaveLength(0)
    })

    it('cannot manage brands, plans or configuration', async () => {
      await expectDbError(
        db.run(user(a.viewerId), `insert into public.brands (workspace_id, name) values ($1, 'Nope')`, [a.workspaceId]),
        /row-level security/,
      )
      await expectDbError(
        db.run(
          user(a.viewerId),
          `insert into public.monthly_plans (workspace_id, brand_id, year, month, title) values ($1, $2, 2026, 12, 'x')`,
          [a.workspaceId, a.brandId],
        ),
        /row-level security/,
      )
      const ws = await db.run(user(a.viewerId), `update public.workspaces set name = 'x' where id = $1 returning id`, [
        a.workspaceId,
      ])
      expect(ws).toHaveLength(0)
    })
  })

  describe('editors', () => {
    it('can create, edit and archive content', async () => {
      const id = await insertContent(db, user(a.editorId), a, { title: 'Draft' })
      await db.run(user(a.editorId), `update public.content_items set title = 'Edited' where id = $1`, [id])
      await db.run(user(a.editorId), `update public.content_items set deleted_at = now() where id = $1`, [id])
      const row = await db.one<{ title: string; deleted_by: string }>(
        postgres,
        `select title, deleted_by from public.content_items where id = $1`,
        [id],
      )
      expect(row).toEqual({ title: 'Edited', deleted_by: a.editorId })
    })

    it('own the content they create and cannot reassign or unassign it', async () => {
      await expectDbError(
        insertContent(db, user(a.editorId), a, { assigned_to: a.adminId }),
        /Editors can only create content assigned to themselves/,
      )
      const id = await insertContent(db, user(a.editorId), a, { title: 'Draft' })
      const created = await db.one<{ assigned_to: string }>(postgres, `select assigned_to from public.content_items where id = $1`, [id])
      expect(created.assigned_to).toBe(a.editorId)
      await expectDbError(
        db.run(user(a.editorId), `update public.content_items set assigned_to = $2 where id = $1`, [id, a.adminId]),
        /Only administrators can assign content/,
      )
      await expectDbError(
        db.run(user(a.editorId), `update public.content_items set assigned_to = null where id = $1`, [id]),
        /Content must have an owner/,
      )
      // Other edits and status changes on their own item still work.
      await db.run(user(a.editorId), `update public.content_items set title = 'Drafted', status = 'in_production' where id = $1`, [id])
      const row = await db.one<{ title: string; assigned_to: string }>(postgres, `select title, assigned_to from public.content_items where id = $1`, [id])
      expect(row).toEqual({ title: 'Drafted', assigned_to: a.editorId })
    })

    it('cannot permanently delete content', async () => {
      const id = await insertContent(db, user(a.editorId), a)
      const deleted = await db.run(user(a.editorId), `delete from public.content_items where id = $1 returning id`, [id])
      expect(deleted).toHaveLength(0)
    })

    it('cannot change roles, membership or invite anyone', async () => {
      const member = await db.one<{ id: string }>(
        postgres,
        `select id from public.workspace_members where workspace_id = $1 and user_id = $2`,
        [a.workspaceId, a.viewerId],
      )
      await expectDbError(
        db.run(user(a.editorId), `select public.update_member_role($1, 'admin')`, [member.id]),
        /Only administrators can change roles/,
      )
      await expectDbError(
        db.run(user(a.editorId), `select public.set_member_status($1, 'deactivated')`, [member.id]),
        /Only administrators/,
      )
      await expectDbError(
        db.run(user(a.editorId), `select * from public.create_invitation($1, 'new@example.test', 'viewer')`, [
          a.workspaceId,
        ]),
        /Only administrators can invite/,
      )
    })

    it('cannot promote themselves by writing membership directly', async () => {
      await expectDbError(
        db.run(user(a.editorId), `update public.workspace_members set role = 'admin' where user_id = $1`, [a.editorId]),
        /permission denied/,
      )
      await expectDbError(
        db.run(
          user(a.editorId),
          `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'admin')`,
          [b.workspaceId, a.editorId],
        ),
        /permission denied/,
      )
      const role = await db.one<{ role: string }>(
        postgres,
        `select role from public.workspace_members where workspace_id = $1 and user_id = $2`,
        [a.workspaceId, a.editorId],
      )
      expect(role.role).toBe('editor')
    })

    it('cannot forge approval stamps or authorship', async () => {
      const id = await insertContent(db, user(a.editorId), a)
      await expectDbError(
        db.run(user(a.editorId), `update public.content_items set approved_by = $2 where id = $1`, [id, a.adminId]),
        /permission denied/,
      )
      await expectDbError(
        db.run(user(a.editorId), `update public.content_items set created_by = $2 where id = $1`, [id, a.adminId]),
        /permission denied/,
      )
      await expectDbError(
        db.run(
          user(a.editorId),
          `insert into public.content_items (workspace_id, brand_id, format_id, title, created_by) values ($1, $2, $3, 'x', $4)`,
          [a.workspaceId, a.brandId, a.formatIds.Carousel, a.adminId],
        ),
        /permission denied/,
      )
    })

    it('follow the edit-own-content rule when the workspace enables it', async () => {
      const adminsPost = await insertContent(db, user(a.adminId), a, { title: 'Admin owned' })
      await db.run(user(a.adminId), `update public.workspaces set editors_can_edit_all = false where id = $1`, [
        a.workspaceId,
      ])
      const blocked = await db.run(
        user(a.editorId),
        `update public.content_items set title = 'changed' where id = $1 returning id`,
        [adminsPost],
      )
      expect(blocked).toHaveLength(0)

      await db.run(user(a.adminId), `update public.content_items set assigned_to = $2 where id = $1`, [
        adminsPost,
        a.editorId,
      ])
      const allowed = await db.run(
        user(a.editorId),
        `update public.content_items set title = 'changed' where id = $1 returning id`,
        [adminsPost],
      )
      expect(allowed).toHaveLength(1)
      await db.run(user(a.adminId), `update public.workspaces set editors_can_edit_all = true where id = $1`, [
        a.workspaceId,
      ])
    })
  })

  describe('administrators', () => {
    it('can change roles but never remove the last administrator', async () => {
      const adminMember = await db.one<{ id: string }>(
        postgres,
        `select id from public.workspace_members where workspace_id = $1 and user_id = $2`,
        [a.workspaceId, a.adminId],
      )
      await expectDbError(
        db.run(user(a.adminId), `select public.update_member_role($1, 'editor')`, [adminMember.id]),
        /at least one active administrator/,
      )
      await expectDbError(
        db.run(user(a.adminId), `select public.set_member_status($1, 'deactivated')`, [adminMember.id]),
        /at least one active administrator/,
      )
    })

    it('can grant and revoke administrator privileges', async () => {
      const editorMember = await db.one<{ id: string }>(
        postgres,
        `select id from public.workspace_members where workspace_id = $1 and user_id = $2`,
        [a.workspaceId, a.editorId],
      )
      await db.run(user(a.adminId), `select public.update_member_role($1, 'admin')`, [editorMember.id])
      await db.run(user(a.adminId), `select public.update_member_role($1, 'editor')`, [editorMember.id])
      const audit = await db.run<{ action: string }>(
        user(a.adminId),
        `select action from public.workspace_audit where workspace_id = $1 and action = 'member_role_changed'`,
        [a.workspaceId],
      )
      expect(audit.length).toBe(2)
    })

    it('cannot administer another workspace', async () => {
      const bMember = await db.one<{ id: string }>(
        postgres,
        `select id from public.workspace_members where workspace_id = $1 and user_id = $2`,
        [b.workspaceId, b.viewerId],
      )
      await expectDbError(
        db.run(user(a.adminId), `select public.update_member_role($1, 'admin')`, [bMember.id]),
        /Only administrators/,
      )
      await expectDbError(
        db.run(user(a.adminId), `select * from public.create_invitation($1, 'x@example.test', 'editor')`, [
          b.workspaceId,
        ]),
        /Only administrators/,
      )
    })
  })

  describe('workspace isolation', () => {
    it('non-members see nothing', async () => {
      await insertContent(db, user(a.adminId), a)
      for (const table of ['workspaces', 'brands', 'content_items', 'monthly_plans', 'content_formats', 'workspace_members']) {
        const rows = await db.run(user(outsider), `select * from public.${table}`)
        expect(rows, table).toHaveLength(0)
      }
      await expectDbError(db.run(anon, `select * from public.content_items`), /permission denied/)
    })

    it('members cannot read or write another workspace by ID', async () => {
      const bPost = await insertContent(db, user(b.adminId), b, { title: 'B secret' })
      const read = await db.run(user(a.adminId), `select * from public.content_items where id = $1`, [bPost])
      expect(read).toHaveLength(0)
      const write = await db.run(
        user(a.adminId),
        `update public.content_items set title = 'pwned' where id = $1 returning id`,
        [bPost],
      )
      expect(write).toHaveLength(0)
      await expectDbError(
        db.run(
          user(a.adminId),
          `insert into public.content_items (workspace_id, brand_id, format_id, title) values ($1, $2, $3, 'x')`,
          [b.workspaceId, b.brandId, b.formatIds.Carousel],
        ),
        /row-level security|permission to create content/,
      )
    })

    it('cannot attach foreign brands, formats or assignees to own content', async () => {
      await expectDbError(
        db.run(
          user(a.adminId),
          `insert into public.content_items (workspace_id, brand_id, format_id, title) values ($1, $2, $3, 'x')`,
          [a.workspaceId, b.brandId, a.formatIds.Carousel],
        ),
        /foreign key|Choose an active/,
      )
      await expectDbError(
        db.run(
          user(a.adminId),
          `insert into public.content_items (workspace_id, brand_id, format_id, title) values ($1, $2, $3, 'x')`,
          [a.workspaceId, a.brandId, b.formatIds.Carousel],
        ),
        /foreign key|Choose an active/,
      )
      await expectDbError(insertContent(db, user(a.adminId), a, { assigned_to: b.editorId }), /assigned/)
      await expectDbError(insertContent(db, user(a.adminId), a, { assigned_to: a.viewerId }), /assigned/)
    })

    it('only exposes profiles of people who share a workspace', async () => {
      const rows = await db.run<{ email: string }>(user(a.viewerId), `select email from public.profiles order by email`)
      expect(rows.map((r) => r.email)).toEqual([
        'admin.a@example.test',
        'editor.a@example.test',
        'viewer.a@example.test',
      ])
    })

    it('profiles cannot be used to change email or role', async () => {
      await expectDbError(
        db.run(user(a.viewerId), `update public.profiles set email = 'admin.a@example.test' where id = $1`, [a.viewerId]),
        /permission denied/,
      )
      await db.run(user(a.viewerId), `update public.profiles set full_name = '  New Name ' where id = $1`, [a.viewerId])
      const p = await db.one<{ full_name: string }>(postgres, `select full_name from public.profiles where id = $1`, [
        a.viewerId,
      ])
      expect(p.full_name).toBe('New Name')
    })

    it('hides invitation token hashes even from administrators', async () => {
      await db.run(user(a.adminId), `select * from public.create_invitation($1, 'hash.check@example.test', 'viewer')`, [
        a.workspaceId,
      ])
      await expectDbError(db.run(user(a.adminId), `select token_hash from public.invitations`), /permission denied/)
      const rows = await db.run(user(a.adminId), `select id, email from public.invitations`)
      expect(rows.length).toBeGreaterThan(0)
      expect(await db.run(user(a.editorId), `select id from public.invitations`)).toHaveLength(0)
    })
  })

  describe('deactivated members', () => {
    it('lose access immediately but keep their authored content', async () => {
      const ws = await createWorkspace(db, 'deact')
      const post = await insertContent(db, user(ws.editorId), ws, { title: 'Authored by editor' })
      const member = await db.one<{ id: string }>(
        postgres,
        `select id from public.workspace_members where workspace_id = $1 and user_id = $2`,
        [ws.workspaceId, ws.editorId],
      )
      await db.run(user(ws.adminId), `select public.set_member_status($1, 'deactivated')`, [member.id])

      expect(await db.run(user(ws.editorId), `select * from public.content_items`)).toHaveLength(0)
      expect(await db.run(user(ws.editorId), `select * from public.workspaces`)).toHaveLength(0)
      await expectDbError(insertContent(db, user(ws.editorId), ws), /row-level security|permission to create content/)

      const own = await db.run<{ status: string }>(
        user(ws.editorId),
        `select status from public.workspace_members where user_id = $1`,
        [ws.editorId],
      )
      expect(own).toEqual([{ status: 'deactivated' }])

      const kept = await db.one<{ created_by: string }>(
        postgres,
        `select created_by from public.content_items where id = $1`,
        [post],
      )
      expect(kept.created_by).toBe(ws.editorId)
    })
  })
})
