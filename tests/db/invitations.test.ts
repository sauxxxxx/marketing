import { TestDb, createWorkspace, expectDbError, postgres, user, type WorkspaceFixture } from './harness'

describe('invitations', () => {
  let db: TestDb
  let ws: WorkspaceFixture

  beforeAll(async () => {
    db = await TestDb.create()
    ws = await createWorkspace(db, 'inv', true)
  })
  afterAll(() => db.close())

  const invite = (email: string, role = 'editor') =>
    db.one<{ invitation_id: string; token: string; user_exists: boolean }>(
      user(ws.adminId),
      `select * from public.create_invitation($1, $2, $3::public.workspace_role)`,
      [ws.workspaceId, email, role],
    )

  it('stores only a hash of a high-entropy token', async () => {
    const inv = await invite('New.Person@Example.test')
    expect(inv.token).toMatch(/^[0-9a-f]{64}$/)
    const row = await db.one<{ token_hash: string; email: string }>(
      postgres,
      `select token_hash, email from public.invitations where id = $1`,
      [inv.invitation_id],
    )
    expect(row.email).toBe('new.person@example.test')
    expect(row.token_hash).not.toContain(inv.token)
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('cannot grant the administrator role', async () => {
    await expectDbError(invite('boss@example.test', 'admin'), /Editor or Viewer/)
  })

  it('activates membership for the invited email exactly once', async () => {
    const inv = await invite('joiner@example.test', 'viewer')
    const joiner = await db.createAuthUser('joiner@example.test', 'Jo Iner')

    const preview = await db.one<{ state: string; workspace_name: string; role: string }>(
      user(joiner),
      `select * from public.get_invitation($1)`,
      [inv.token],
    )
    expect(preview).toMatchObject({ state: 'valid', workspace_name: 'Workspace inv', role: 'viewer' })

    const accepted = await db.one<{ ws: string }>(user(joiner), `select public.accept_invitation($1) as ws`, [inv.token])
    expect(accepted.ws).toBe(ws.workspaceId)
    const member = await db.one<{ role: string; status: string }>(
      postgres,
      `select role, status from public.workspace_members where workspace_id = $1 and user_id = $2`,
      [ws.workspaceId, joiner],
    )
    expect(member).toEqual({ role: 'viewer', status: 'active' })

    // Idempotent for the same user, rejected for anyone else.
    await db.run(user(joiner), `select public.accept_invitation($1)`, [inv.token])
    const other = await db.createAuthUser('other@example.test')
    await expectDbError(db.run(user(other), `select public.accept_invitation($1)`, [inv.token]), /already been used|different email/)
  })

  it('rejects a user whose email does not match', async () => {
    const inv = await invite('intended@example.test')
    const wrong = await db.createAuthUser('wrong@example.test')
    const preview = await db.one<{ state: string; workspace_name: string | null }>(
      user(wrong),
      `select * from public.get_invitation($1)`,
      [inv.token],
    )
    expect(preview).toEqual({ state: 'email_mismatch', workspace_name: null, role: null, expires_at: null })
    await expectDbError(db.run(user(wrong), `select public.accept_invitation($1)`, [inv.token]), /different email/)
  })

  it('rejects unconfirmed emails, expired, revoked and guessed tokens', async () => {
    const unconfirmedInv = await invite('unconfirmed@example.test')
    const unconfirmed = await db.createAuthUser('unconfirmed@example.test', '', false)
    await expectDbError(
      db.run(user(unconfirmed), `select public.accept_invitation($1)`, [unconfirmedInv.token]),
      /Confirm your email/,
    )

    const expiredInv = await invite('late@example.test')
    const late = await db.createAuthUser('late@example.test')
    await db.run(postgres, `update public.invitations set expires_at = now() - interval '1 minute' where id = $1`, [
      expiredInv.invitation_id,
    ])
    await expectDbError(db.run(user(late), `select public.accept_invitation($1)`, [expiredInv.token]), /expired/)

    const revokedInv = await invite('revoked@example.test')
    const revoked = await db.createAuthUser('revoked@example.test')
    await db.run(user(ws.adminId), `select public.revoke_invitation($1)`, [revokedInv.invitation_id])
    await expectDbError(db.run(user(revoked), `select public.accept_invitation($1)`, [revokedInv.token]), /revoked/)

    await expectDbError(db.run(user(revoked), `select public.accept_invitation($1)`, ['0'.repeat(64)]), /invalid/)
  })

  it('re-inviting replaces the earlier pending link', async () => {
    const first = await invite('twice@example.test')
    const second = await invite('twice@example.test')
    const twice = await db.createAuthUser('twice@example.test')
    await expectDbError(db.run(user(twice), `select public.accept_invitation($1)`, [first.token]), /revoked/)
    await db.run(user(twice), `select public.accept_invitation($1)`, [second.token])
  })

  it('refuses to invite someone who is already an active member', async () => {
    await expectDbError(invite('editor.inv@example.test'), /already an active member/)
  })

  it('reactivates a previously deactivated member with the invited role', async () => {
    const member = await db.one<{ id: string }>(
      postgres,
      `select id from public.workspace_members where workspace_id = $1 and user_id = $2`,
      [ws.workspaceId, ws.viewerId],
    )
    await db.run(user(ws.adminId), `select public.set_member_status($1, 'deactivated')`, [member.id])
    const inv = await invite('viewer.inv@example.test', 'editor')
    await db.run(user(ws.viewerId), `select public.accept_invitation($1)`, [inv.token])
    const row = await db.one<{ role: string; status: string }>(
      postgres,
      `select role, status from public.workspace_members where id = $1`,
      [member.id],
    )
    expect(row).toEqual({ role: 'editor', status: 'active' })
  })

  it('records membership changes in the audit log', async () => {
    const actions = await db.run<{ action: string }>(
      user(ws.adminId),
      `select distinct action from public.workspace_audit where workspace_id = $1 order by action`,
      [ws.workspaceId],
    )
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'invitation_created',
        'invitation_accepted',
        'invitation_revoked',
        'member_joined',
        'member_deactivated',
        'member_reactivated',
      ]),
    )
  })

  it('rate-limits invitation creation per administrator', async () => {
    await db.run(
      postgres,
      `insert into public.invitations (workspace_id, email, role, token_hash, invited_by, expires_at, status)
       select $1, 'bulk' || g || '@example.test', 'viewer', encode(sha256(convert_to(g::text, 'UTF8')), 'hex'), $2, now() + interval '1 day', 'revoked'
       from generate_series(1, 30) g`,
      [ws.workspaceId, ws.adminId],
    )
    await expectDbError(invite('one.more@example.test'), /Too many invitations/)
  })
})
