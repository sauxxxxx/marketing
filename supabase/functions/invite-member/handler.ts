import { type HttpContext, json, normaliseEmail, readJsonRequest } from '../_shared/http.ts'

export interface CreatedInvitation {
  invitation_id: string
  token: string
  expires_at: string
  email: string
  user_exists: boolean
}

export interface InvitePort {
  /**
   * Calls public.create_invitation with the CALLER's JWT, so the database
   * decides whether the caller is an administrator of that workspace.
   */
  createInvitation(
    jwt: string,
    input: { workspaceId: string; email: string; role: 'editor' | 'viewer' },
  ): Promise<CreatedInvitation>
  /** New user: Supabase invitation email (they choose a password on arrival). */
  sendInviteEmail(email: string, redirectTo: string): Promise<void>
  /** Existing user: magic-link email that signs them in and opens the link. */
  sendMagicLink(email: string, redirectTo: string): Promise<void>
  /** Fallback for new users when email delivery fails: an invite link to share manually. */
  generateInviteLink(email: string, redirectTo: string): Promise<string | null>
}

export interface InviteConfig extends HttpContext {
  appUrl: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function createInviteHandler(config: InviteConfig, port: InvitePort) {
  return async (request: Request): Promise<Response> => {
    const parsed = await readJsonRequest(request, config)
    if ('response' in parsed) return parsed.response
    const { body } = parsed

    const authorization = request.headers.get('Authorization') ?? ''
    const jwt = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
    if (!jwt) {
      return json(request, config, 401, { error: 'unauthorized', message: 'Sign in again to invite members.' })
    }

    const workspaceId = typeof body.workspaceId === 'string' && UUID.test(body.workspaceId) ? body.workspaceId : null
    const email = normaliseEmail(body.email)
    const role = body.role === 'editor' || body.role === 'viewer' ? body.role : null
    if (!workspaceId || !email || !role) {
      return json(request, config, 400, {
        error: 'validation_failed',
        message: 'Provide a valid email address and choose Editor or Viewer.',
      })
    }

    let invitation: CreatedInvitation
    try {
      invitation = await port.createInvitation(jwt, { workspaceId, email, role })
    } catch (error) {
      const err = error as { code?: string; message?: string }
      if (err.code === '42501') {
        return json(request, config, 403, { error: 'forbidden', message: 'Only administrators can invite team members.' })
      }
      if (err.code === 'P0001' && err.message) {
        return json(request, config, 400, { error: 'invitation_rejected', message: err.message })
      }
      return json(request, config, 500, { error: 'invitation_failed', message: 'The invitation could not be created.' })
    }

    const base = config.appUrl.replace(/\/$/, '')
    const acceptUrl = `${base}/accept-invite?token=${invitation.token}${invitation.user_exists ? '' : '&setup=1'}`

    let delivered = true
    let shareLink: string | null = null
    try {
      if (invitation.user_exists) {
        await port.sendMagicLink(invitation.email, acceptUrl)
      } else {
        await port.sendInviteEmail(invitation.email, acceptUrl)
      }
    } catch (error) {
      console.error('invite-member: email delivery failed', (error as Error)?.message)
      delivered = false
      // Existing users can sign in normally and then open the accept link.
      // New users need a Supabase invite link to establish their account.
      shareLink = invitation.user_exists
        ? acceptUrl
        : await port.generateInviteLink(invitation.email, acceptUrl).catch(() => null)
    }

    return json(request, config, 201, {
      invitationId: invitation.invitation_id,
      email: invitation.email,
      expiresAt: invitation.expires_at,
      delivered,
      shareLink,
    })
  }
}
