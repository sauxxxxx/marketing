import { vi } from 'vitest'

/**
 * A controllable stand-in for the Supabase client used by component tests.
 * Each test configures only the calls it needs.
 */
export function createMockSupabase() {
  const listeners: ((event: string, session: unknown) => void)[] = []
  let session: unknown = null

  const result = { data: null as unknown, error: null as unknown }
  const query: Record<string, unknown> = {}
  const chain = ['select', 'insert', 'update', 'delete', 'eq', 'is', 'in', 'not', 'gte', 'lte', 'like', 'or', 'order', 'range', 'limit']
  for (const method of chain) query[method] = vi.fn(() => query)
  query.single = vi.fn(async () => result)
  query.maybeSingle = vi.fn(async () => result)
  query.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)

  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session } })),
      onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
        listeners.push(cb)
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      }),
      signInWithPassword: vi.fn(async () => ({ data: {}, error: null as unknown })),
      signOut: vi.fn(async () => ({ error: null })),
      updateUser: vi.fn(async () => ({ data: {}, error: null as unknown })),
      resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
    },
    rpc: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: { initialized: true }, error: null })),
    from: vi.fn(() => query),
    storage: { from: vi.fn() },
    functions: { invoke: vi.fn() },
  }

  return {
    client,
    query,
    result,
    setSession(next: unknown) {
      session = next
    },
    emit(event: string, next: unknown) {
      session = next
      for (const l of listeners) l(event, next)
    },
  }
}

export const fakeSession = {
  access_token: 'token',
  refresh_token: 'refresh',
  expires_in: 3600,
  token_type: 'bearer',
  user: { id: 'user-1', email: 'ana@joyno.example', user_metadata: {}, app_metadata: {}, aud: 'authenticated', created_at: '' },
}
