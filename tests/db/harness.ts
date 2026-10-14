import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const root = path.resolve(import.meta.dirname, '../..')
const migrationsDir = path.join(root, 'supabase/migrations')

export type Actor =
  | { kind: 'user'; id: string }
  | { kind: 'anon' }
  | { kind: 'service' }
  | { kind: 'postgres' }

export const anon: Actor = { kind: 'anon' }
export const service: Actor = { kind: 'service' }
export const postgres: Actor = { kind: 'postgres' }
export const user = (id: string): Actor => ({ kind: 'user', id })

export function migrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => path.join(migrationsDir, f))
}

/**
 * A fresh in-process PostgreSQL database with the Supabase shim and every
 * migration applied, plus helpers to run SQL as a specific API role.
 */
export class TestDb {
  private constructor(readonly pg: PGlite) {}

  /**
   * @param options.stopBefore apply only migrations whose file name sorts before
   *   this prefix; call applyRemainingMigrations() later (used to test backfills).
   */
  static async create(options: { seed?: boolean; stopBefore?: string } = {}): Promise<TestDb> {
    // Return date/time values as strings, like PostgREST does.
    const asText = (value: string) => value
    const pg = new PGlite({ parsers: { 1082: asText, 1083: asText, 1114: asText, 1184: asText } })
    await pg.exec(readFileSync(path.join(import.meta.dirname, 'supabase-shim.sql'), 'utf8'))
    for (const file of migrationFiles()) {
      if (options.stopBefore && path.basename(file) >= options.stopBefore) continue
      try {
        await pg.exec(readFileSync(file, 'utf8'))
      } catch (error) {
        throw new Error(`Migration failed: ${path.basename(file)}: ${(error as Error).message}`)
      }
    }
    if (options.seed) {
      await pg.exec(readFileSync(path.join(root, 'supabase/seed.sql'), 'utf8'))
    }
    return new TestDb(pg)
  }

  async applyRemainingMigrations(from: string): Promise<void> {
    for (const file of migrationFiles().filter((f) => path.basename(f) >= from)) {
      await this.pg.exec(readFileSync(file, 'utf8'))
    }
  }

  /** Runs one statement in its own transaction as the given actor. */
  async run<T = Record<string, unknown>>(actor: Actor, sql: string, params: unknown[] = []): Promise<T[]> {
    return this.pg.transaction(async (tx) => {
      if (actor.kind === 'user') {
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [actor.id])
        await tx.exec('set local role authenticated')
      } else if (actor.kind === 'anon') {
        await tx.exec('set local role anon')
      } else if (actor.kind === 'service') {
        await tx.exec('set local role service_role')
      }
      const result = await tx.query<T>(sql, params)
      return result.rows
    })
  }

  async one<T = Record<string, unknown>>(actor: Actor, sql: string, params: unknown[] = []): Promise<T> {
    const rows = await this.run<T>(actor, sql, params)
    if (rows.length !== 1) throw new Error(`Expected one row, got ${rows.length}`)
    return rows[0]
  }

  async createAuthUser(email: string, fullName = '', confirmed = true): Promise<string> {
    const row = await this.one<{ id: string }>(
      postgres,
      `insert into auth.users (email, email_confirmed_at, raw_user_meta_data)
       values ($1, case when $2 then now() end, jsonb_build_object('full_name', $3::text)) returning id`,
      [email, confirmed, fullName],
    )
    return row.id
  }

  async close() {
    await this.pg.close()
  }
}

export async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  let error: unknown
  try {
    await promise
  } catch (e) {
    error = e
  }
  if (!error) throw new Error(`Expected an error matching ${pattern}, but the statement succeeded`)
  const message = (error as Error).message
  if (!pattern.test(message)) throw new Error(`Expected error matching ${pattern}, got: ${message}`)
}

export interface WorkspaceFixture {
  workspaceId: string
  adminId: string
  editorId: string
  viewerId: string
  brandId: string
  formatIds: Record<string, string>
  pillarIds: Record<string, string>
}

/**
 * Creates a workspace with an admin, editor and viewer. The first call uses
 * the real first-admin provisioning path; later calls create additional
 * workspaces directly (as the database owner) for isolation tests.
 */
export async function createWorkspace(db: TestDb, label: string, viaBootstrap = false): Promise<WorkspaceFixture> {
  const adminId = await db.createAuthUser(`admin.${label}@example.test`, `Admin ${label}`)
  const editorId = await db.createAuthUser(`editor.${label}@example.test`, `Editor ${label}`)
  const viewerId = await db.createAuthUser(`viewer.${label}@example.test`, `Viewer ${label}`)

  let workspaceId: string
  if (viaBootstrap) {
    const row = await db.one<{ id: string }>(
      postgres,
      `select public.bootstrap_existing_user($1, $2, $3) as id`,
      [`admin.${label}@example.test`, `Admin ${label}`, `Workspace ${label}`],
    )
    workspaceId = row.id
  } else {
    const row = await db.one<{ id: string }>(
      postgres,
      `insert into public.workspaces (name, created_by) values ($1, $2) returning id`,
      [`Workspace ${label}`, adminId],
    )
    workspaceId = row.id
    await db.run(postgres, `select public.seed_workspace_defaults($1)`, [workspaceId])
    await db.run(postgres, `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'admin')`, [
      workspaceId,
      adminId,
    ])
  }
  await db.run(
    postgres,
    `insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, 'editor'), ($1, $3, 'viewer')`,
    [workspaceId, editorId, viewerId],
  )
  const brand = await db.one<{ id: string }>(
    postgres,
    `insert into public.brands (workspace_id, name) values ($1, $2) returning id`,
    [workspaceId, `Brand ${label}`],
  )
  // Editors work only on brands they are assigned to.
  await db.run(postgres, `insert into public.brand_editors (workspace_id, brand_id, user_id) values ($1, $2, $3)`, [
    workspaceId,
    brand.id,
    editorId,
  ])
  const formats = await db.run<{ id: string; name: string }>(
    postgres,
    `select id, name from public.content_formats where workspace_id = $1`,
    [workspaceId],
  )
  const pillars = await db.run<{ id: string; name: string }>(
    postgres,
    `select id, name from public.content_pillars where workspace_id = $1`,
    [workspaceId],
  )
  return {
    workspaceId,
    adminId,
    editorId,
    viewerId,
    brandId: brand.id,
    formatIds: Object.fromEntries(formats.map((f) => [f.name, f.id])),
    pillarIds: Object.fromEntries(pillars.map((p) => [p.name, p.id])),
  }
}

export async function insertContent(
  db: TestDb,
  actor: Actor,
  ws: WorkspaceFixture,
  fields: Partial<{ title: string; scheduled_date: string | null; status: string; format: string; assigned_to: string | null }> = {},
): Promise<string> {
  const row = await db.one<{ id: string }>(
    actor,
    `insert into public.content_items (workspace_id, brand_id, format_id, title, scheduled_date, status, assigned_to)
     values ($1, $2, $3, $4, $5, coalesce($6, 'planned')::public.content_status, $7) returning id`,
    [
      ws.workspaceId,
      ws.brandId,
      ws.formatIds[fields.format ?? 'Carousel'],
      fields.title ?? 'Test post',
      fields.scheduled_date === undefined ? '2026-11-10' : fields.scheduled_date,
      fields.status ?? null,
      fields.assigned_to ?? null,
    ],
  )
  return row.id
}
