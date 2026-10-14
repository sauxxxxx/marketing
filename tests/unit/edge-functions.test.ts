import { createBootstrapHandler, type BootstrapPort } from '../../supabase/functions/bootstrap/handler.ts'
import { createInviteHandler, type InvitePort } from '../../supabase/functions/invite-member/handler.ts'
import { timingSafeEqual } from '../../supabase/functions/_shared/http.ts'

const ORIGIN = 'https://studio.example.com'
const TOKEN = 'correct-horse-battery-staple-42'

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://fn.example.com', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const validSetup = {
  setupToken: TOKEN,
  fullName: 'Olivia Owner',
  email: 'Owner@Joyno.example',
  password: 'Sup3rSecurePassword',
  workspaceName: 'Joyno Media',
}

function fakeBootstrapPort(overrides: Partial<BootstrapPort> = {}) {
  const calls: string[] = []
  const port: BootstrapPort = {
    acquireLock: vi.fn(async () => {
      calls.push('acquire')
      return 'lock-1'
    }),
    releaseLock: vi.fn(async () => {
      calls.push('release')
    }),
    createUser: vi.fn(async () => {
      calls.push('createUser')
      return 'user-1'
    }),
    deleteUser: vi.fn(async () => {
      calls.push('deleteUser')
    }),
    complete: vi.fn(async () => {
      calls.push('complete')
      return 'ws-1'
    }),
    ...overrides,
  }
  return { port, calls }
}

describe('bootstrap Edge Function handler', () => {
  const config = { bootstrapToken: TOKEN, allowedOrigins: [ORIGIN] }

  it('fails closed when no BOOTSTRAP_TOKEN is configured', async () => {
    const { port } = fakeBootstrapPort()
    const res = await createBootstrapHandler({ ...config, bootstrapToken: undefined }, port)(post(validSetup))
    expect(res.status).toBe(503)
    expect(port.acquireLock).not.toHaveBeenCalled()
  })

  it('rejects a wrong setup token without touching the database', async () => {
    const { port } = fakeBootstrapPort()
    const res = await createBootstrapHandler(config, port)(post({ ...validSetup, setupToken: 'nope' }))
    expect(res.status).toBe(401)
    expect(port.acquireLock).not.toHaveBeenCalled()
  })

  it('validates fields server-side', async () => {
    const { port } = fakeBootstrapPort()
    const res = await createBootstrapHandler(config, port)(
      post({ ...validSetup, email: 'not-an-email', password: 'short', fullName: '' }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(Object.keys(body.fieldErrors).sort()).toEqual(['email', 'fullName', 'password'])
  })

  it('provisions the admin and ignores any role in the request', async () => {
    const { port, calls } = fakeBootstrapPort()
    const res = await createBootstrapHandler(config, port)(post({ ...validSetup, role: 'superuser' }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ workspaceId: 'ws-1', email: 'owner@joyno.example' })
    expect(calls).toEqual(['acquire', 'createUser', 'complete'])
    expect(port.createUser).toHaveBeenCalledWith({
      email: 'owner@joyno.example',
      password: validSetup.password,
      fullName: 'Olivia Owner',
    })
  })

  it('reports an already-initialised installation as 409', async () => {
    const { port } = fakeBootstrapPort({
      acquireLock: vi.fn(async () => {
        throw new Error('already_initialized')
      }),
    })
    const res = await createBootstrapHandler(config, port)(post(validSetup))
    expect(res.status).toBe(409)
    expect(port.createUser).not.toHaveBeenCalled()
  })

  it('deletes the created user and releases the lock when provisioning fails', async () => {
    const { port, calls } = fakeBootstrapPort({
      complete: vi.fn(async () => {
        throw new Error('bootstrap_lock_lost')
      }),
    })
    const res = await createBootstrapHandler(config, port)(post(validSetup))
    expect(res.status).toBe(500)
    expect(calls).toEqual(['acquire', 'createUser', 'deleteUser', 'release'])
  })

  it('blocks disallowed origins and non-POST methods', async () => {
    const { port } = fakeBootstrapPort()
    const handler = createBootstrapHandler(config, port)
    const evil = await handler(post(validSetup, { Origin: 'https://evil.example' }))
    expect(evil.status).toBe(403)
    const get = await handler(new Request('https://fn.example.com', { method: 'GET', headers: { Origin: ORIGIN } }))
    expect(get.status).toBe(405)
    const preflight = await handler(new Request('https://fn.example.com', { method: 'OPTIONS', headers: { Origin: ORIGIN } }))
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
  })
})

describe('invite-member Edge Function handler', () => {
  const config = { appUrl: 'https://studio.example.com/', allowedOrigins: [ORIGIN] }
  const workspaceId = '6f1c2b8e-3a5d-4c1e-9b7a-2d4e6f8a0b1c'
  const invitation = {
    invitation_id: 'inv-1',
    token: 'a'.repeat(64),
    expires_at: '2026-10-20T00:00:00Z',
    email: 'new@joyno.example',
    user_exists: false,
  }

  function fakeInvitePort(overrides: Partial<InvitePort> = {}): InvitePort {
    return {
      createInvitation: vi.fn(async () => invitation),
      sendInviteEmail: vi.fn(async () => undefined),
      sendMagicLink: vi.fn(async () => undefined),
      generateInviteLink: vi.fn(async () => 'https://project.supabase.co/auth/v1/verify?token=x'),
      ...overrides,
    }
  }

  const authed = { Authorization: 'Bearer caller-jwt' }

  it('requires a caller JWT', async () => {
    const res = await createInviteHandler(config, fakeInvitePort())(post({ workspaceId, email: 'x@y.co', role: 'editor' }))
    expect(res.status).toBe(401)
  })

  it('only offers Editor or Viewer', async () => {
    const port = fakeInvitePort()
    const res = await createInviteHandler(config, port)(post({ workspaceId, email: 'x@y.co', role: 'admin' }, authed))
    expect(res.status).toBe(400)
    expect(port.createInvitation).not.toHaveBeenCalled()
  })

  it('passes the caller JWT to the database and maps permission errors', async () => {
    const port = fakeInvitePort({
      createInvitation: vi.fn(async () => {
        throw { code: '42501', message: 'Only administrators can invite team members.' }
      }),
    })
    const res = await createInviteHandler(config, port)(post({ workspaceId, email: 'x@y.co', role: 'editor' }, authed))
    expect(res.status).toBe(403)
    expect(port.createInvitation).toHaveBeenCalledWith('caller-jwt', { workspaceId, email: 'x@y.co', role: 'editor' })
  })

  it('sends a Supabase invite to new users with an account-setup redirect', async () => {
    const port = fakeInvitePort()
    const res = await createInviteHandler(config, port)(post({ workspaceId, email: 'New@Joyno.example', role: 'viewer' }, authed))
    expect(res.status).toBe(201)
    expect(port.sendInviteEmail).toHaveBeenCalledWith(
      'new@joyno.example',
      `https://studio.example.com/accept-invite?token=${'a'.repeat(64)}&setup=1`,
    )
    expect((await res.json()).delivered).toBe(true)
  })

  it('sends a magic link to existing users', async () => {
    const port = fakeInvitePort({ createInvitation: vi.fn(async () => ({ ...invitation, user_exists: true })) })
    await createInviteHandler(config, port)(post({ workspaceId, email: 'new@joyno.example', role: 'viewer' }, authed))
    expect(port.sendMagicLink).toHaveBeenCalledWith(
      'new@joyno.example',
      `https://studio.example.com/accept-invite?token=${'a'.repeat(64)}`,
    )
    expect(port.sendInviteEmail).not.toHaveBeenCalled()
  })

  it('returns a shareable link when email delivery fails', async () => {
    const port = fakeInvitePort({
      sendInviteEmail: vi.fn(async () => {
        throw new Error('rate limit')
      }),
    })
    const res = await createInviteHandler(config, port)(post({ workspaceId, email: 'new@joyno.example', role: 'editor' }, authed))
    const body = await res.json()
    expect(body.delivered).toBe(false)
    expect(body.shareLink).toContain('/auth/v1/verify')
  })
})

describe('timingSafeEqual', () => {
  it('compares strings correctly', async () => {
    expect(await timingSafeEqual('abc', 'abc')).toBe(true)
    expect(await timingSafeEqual('abc', 'abd')).toBe(false)
    expect(await timingSafeEqual('abc', 'abcd')).toBe(false)
    expect(await timingSafeEqual('', TOKEN)).toBe(false)
  })
})
