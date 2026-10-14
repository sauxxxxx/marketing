import { readFileSync } from 'node:fs'
import path from 'node:path'
import { TestDb, postgres } from './harness'

describe('development seed', () => {
  let db: TestDb
  beforeAll(async () => {
    db = await TestDb.create({ seed: true })
  })
  afterAll(() => db.close())

  it('creates a clearly flagged demo workspace with content in every status', async () => {
    const ws = await db.one<{ name: string; is_demo: boolean }>(postgres, `select name, is_demo from public.workspaces`)
    expect(ws).toEqual({ name: 'Joyno Media (Demo)', is_demo: true })
    const statuses = await db.run<{ status: string }>(
      postgres,
      `select distinct status::text from public.content_items order by 1`,
    )
    expect(statuses.map((s) => s.status)).toEqual([
      'approved', 'cancelled', 'for_review', 'in_production', 'needs_revision', 'planned', 'published',
    ])
    const flagged = await db.one<{ n: number }>(postgres, `select count(*)::int as n from public.content_items where not is_demo`)
    expect(flagged.n).toBe(0)
  })

  it('links current-month content to the demo plan and keeps the idea parked there', async () => {
    const row = await db.one<{ linked: number; ideas: number }>(
      postgres,
      `select count(*) filter (where scheduled_date is not null)::int as linked,
              count(*) filter (where scheduled_date is null)::int as ideas
       from public.content_items where monthly_plan_id = '0d3e0000-0000-4000-8000-0000000000c1'`,
    )
    expect(row.linked).toBe(13)
    expect(row.ideas).toBe(1)
  })

  it('is idempotent and creates no users', async () => {
    const before = await db.one<{ n: number }>(postgres, `select count(*)::int as n from public.content_items`)
    await db.pg.exec(readFileSync(path.resolve(import.meta.dirname, '../../supabase/seed.sql'), 'utf8'))
    const after = await db.one<{ n: number }>(postgres, `select count(*)::int as n from public.content_items`)
    expect(after.n).toBe(before.n)
    const users = await db.one<{ n: number }>(postgres, `select count(*)::int as n from auth.users`)
    expect(users.n).toBe(0)
  })

  it('attaches dev users that exist when re-run', async () => {
    await db.createAuthUser('editor@demo.joyno.local', 'Demo Editor')
    await db.pg.exec(readFileSync(path.resolve(import.meta.dirname, '../../supabase/seed.sql'), 'utf8'))
    const m = await db.one<{ role: string }>(postgres, `select role from public.workspace_members`)
    expect(m.role).toBe('editor')
  })
})
