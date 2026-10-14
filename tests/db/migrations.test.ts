import { TestDb, anon, postgres, migrationFiles } from './harness'

describe('migrations', () => {
  let db: TestDb
  beforeAll(async () => {
    db = await TestDb.create()
  })
  afterAll(() => db.close())

  it('apply cleanly in order', () => {
    expect(migrationFiles().length).toBeGreaterThanOrEqual(6)
  })

  it('enable RLS on every public table', async () => {
    const rows = await db.run<{ relname: string }>(
      postgres,
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    )
    expect(rows.map((r) => r.relname)).toEqual([])
  })

  it('give anon no table privileges in public', async () => {
    const rows = await db.run<{ table_name: string; privilege_type: string }>(
      postgres,
      `select table_name, privilege_type from information_schema.role_table_grants
       where grantee = 'anon' and table_schema = 'public'`,
    )
    expect(rows).toEqual([])
  })

  it('let anon execute only get_setup_status', async () => {
    const rows = await db.run<{ proname: string }>(
      postgres,
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`,
    )
    expect(rows.map((r) => r.proname)).toEqual(['get_setup_status'])
  })

  it('pin search_path on every SECURITY DEFINER function', async () => {
    const rows = await db.run<{ proname: string }>(
      postgres,
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef
         and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
    )
    expect(rows).toEqual([])
  })

  it('report the workspace as not initialised before setup', async () => {
    const row = await db.one<{ s: { initialized: boolean } }>(anon, `select public.get_setup_status() as s`)
    expect(row.s.initialized).toBe(false)
  })

  it('create a private storage bucket', async () => {
    const row = await db.one<{ public: boolean; file_size_limit: number }>(
      postgres,
      `select public, file_size_limit from storage.buckets where id = 'workspace-files'`,
    )
    expect(row.public).toBe(false)
    expect(Number(row.file_size_limit)).toBe(52428800)
  })
})
