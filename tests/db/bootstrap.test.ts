import { TestDb, anon, expectDbError, postgres, service, user } from './harness'

describe('first administrator bootstrap', () => {
  let db: TestDb
  beforeAll(async () => {
    db = await TestDb.create()
  })
  afterAll(() => db.close())

  it('cannot be started by anon or authenticated users', async () => {
    const someone = await db.createAuthUser('someone@example.test')
    await expectDbError(db.run(anon, `select public.bootstrap_acquire_lock()`), /permission denied/)
    await expectDbError(db.run(user(someone), `select public.bootstrap_acquire_lock()`), /permission denied/)
    await expectDbError(
      db.run(user(someone), `select public.bootstrap_complete(gen_random_uuid(), $1, 'X', 'Y')`, [someone]),
      /permission denied/,
    )
    await expectDbError(
      db.run(user(someone), `select public.bootstrap_existing_user('someone@example.test', 'X', 'Y')`),
      /permission denied/,
    )
  })

  it('a second concurrent attempt is rejected while the first holds the lease', async () => {
    const lock = await db.one<{ t: string }>(service, `select public.bootstrap_acquire_lock() as t`)
    await expectDbError(db.run(service, `select public.bootstrap_acquire_lock()`), /bootstrap_in_progress/)
    await db.run(service, `select public.bootstrap_release_lock($1)`, [lock.t])
  })

  it('rejects completion with a wrong or expired lease', async () => {
    const adminId = await db.createAuthUser('first.admin@example.test')
    const lock = await db.one<{ t: string }>(service, `select public.bootstrap_acquire_lock() as t`)
    await expectDbError(
      db.run(service, `select public.bootstrap_complete(gen_random_uuid(), $1, 'Ada', 'Joyno Media')`, [adminId]),
      /bootstrap_lock_lost/,
    )
    await db.run(postgres, `update public.system_state set bootstrap_locked_at = now() - interval '10 minutes'`)
    await expectDbError(
      db.run(service, `select public.bootstrap_complete($1, $2, 'Ada', 'Joyno Media')`, [lock.t, adminId]),
      /bootstrap_lock_lost/,
    )
    // An expired lease can be taken over by a fresh attempt.
    const fresh = await db.one<{ t: string }>(service, `select public.bootstrap_acquire_lock() as t`)
    await db.run(service, `select public.bootstrap_release_lock($1)`, [fresh.t])
  })

  it('validates input server-side', async () => {
    const adminId = await db.createAuthUser('first.admin2@example.test')
    const lock = await db.one<{ t: string }>(service, `select public.bootstrap_acquire_lock() as t`)
    await expectDbError(
      db.run(service, `select public.bootstrap_complete($1, $2, '   ', 'Joyno Media')`, [lock.t, adminId]),
      /invalid_full_name/,
    )
    await db.run(service, `select public.bootstrap_release_lock($1)`, [lock.t])
  })

  it('provisions exactly one administrator, then closes', async () => {
    const adminId = await db.createAuthUser('owner@example.test')
    const lock = await db.one<{ t: string }>(service, `select public.bootstrap_acquire_lock() as t`)
    const ws = await db.one<{ id: string }>(
      service,
      `select public.bootstrap_complete($1, $2, 'Olivia Owner', 'Joyno Media') as id`,
      [lock.t, adminId],
    )

    const member = await db.one<{ role: string; status: string }>(
      postgres,
      `select role, status from public.workspace_members where workspace_id = $1 and user_id = $2`,
      [ws.id, adminId],
    )
    expect(member).toEqual({ role: 'admin', status: 'active' })

    const counts = await db.one<{ formats: number; pillars: number; tz: string }>(
      postgres,
      `select (select count(*)::int from public.content_formats where workspace_id = $1) as formats,
              (select count(*)::int from public.content_pillars where workspace_id = $1) as pillars,
              (select timezone from public.workspaces where id = $1) as tz`,
      [ws.id],
    )
    expect(counts).toEqual({ formats: 5, pillars: 11, tz: 'Asia/Manila' })

    const status = await db.one<{ s: { initialized: boolean } }>(anon, `select public.get_setup_status() as s`)
    expect(status.s.initialized).toBe(true)

    // Every further attempt fails safely.
    await expectDbError(db.run(service, `select public.bootstrap_acquire_lock()`), /already_initialized/)
    const intruder = await db.createAuthUser('intruder@example.test')
    await expectDbError(
      db.run(postgres, `select public.bootstrap_existing_user('intruder@example.test', 'Eve', 'Evil Corp')`),
      /already_initialized/,
    )
    const admins = await db.one<{ n: number }>(
      postgres,
      `select count(*)::int as n from public.workspace_members where role = 'admin'`,
    )
    expect(admins.n).toBe(1)
    expect(intruder).toBeTruthy()
  })
})
