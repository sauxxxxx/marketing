import { type HttpContext, cleanText, json, normaliseEmail, readJsonRequest, timingSafeEqual } from '../_shared/http.ts'

/** Privileged operations, implemented with the service-role client in index.ts. */
export interface BootstrapPort {
  acquireLock(): Promise<string>
  releaseLock(lock: string): Promise<void>
  createUser(input: { email: string; password: string; fullName: string }): Promise<string>
  deleteUser(userId: string): Promise<void>
  complete(input: { lock: string; userId: string; fullName: string; workspaceName: string }): Promise<string>
}

export interface BootstrapConfig extends HttpContext {
  /** Secret the installer must present. When unset, setup is disabled (fail closed). */
  bootstrapToken: string | undefined
}

export const MIN_PASSWORD_LENGTH = 12

export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length === 0) return 'Enter a password.'
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  if (password.length > 72) return 'Use at most 72 characters.'
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return 'Include upper-case and lower-case letters and a number.'
  }
  return null
}

const KNOWN_DB_CODES = [
  'already_initialized',
  'bootstrap_in_progress',
  'bootstrap_lock_lost',
  'invalid_full_name',
  'invalid_workspace_name',
]

function dbErrorCode(error: unknown): string {
  const message = (error as { message?: string })?.message ?? ''
  return KNOWN_DB_CODES.find((code) => message.includes(code)) ?? 'unknown'
}

export function createBootstrapHandler(config: BootstrapConfig, port: BootstrapPort) {
  return async (request: Request): Promise<Response> => {
    const parsed = await readJsonRequest(request, config)
    if ('response' in parsed) return parsed.response
    const { body } = parsed

    if (!config.bootstrapToken || config.bootstrapToken.length < 16) {
      return json(request, config, 503, {
        error: 'setup_disabled',
        message: 'Initial setup is disabled. Set the BOOTSTRAP_TOKEN secret on the server.',
      })
    }
    const token = typeof body.setupToken === 'string' ? body.setupToken : ''
    if (!(await timingSafeEqual(token, config.bootstrapToken))) {
      return json(request, config, 401, { error: 'invalid_setup_token', message: 'The setup token is incorrect.' })
    }

    // Only these fields are read; a "role" or any other field in the body is ignored.
    const fullName = cleanText(body.fullName, 120)
    const email = normaliseEmail(body.email)
    const workspaceName = cleanText(body.workspaceName ?? 'Joyno Media', 80)
    const passwordError = validatePassword(body.password)
    const fieldErrors: Record<string, string> = {}
    if (!fullName) fieldErrors.fullName = 'Enter your full name.'
    if (!email) fieldErrors.email = 'Enter a valid email address.'
    if (!workspaceName) fieldErrors.workspaceName = 'Enter a workspace name (up to 80 characters).'
    if (passwordError) fieldErrors.password = passwordError
    if (!fullName || !email || !workspaceName || passwordError) {
      return json(request, config, 400, { error: 'validation_failed', message: 'Check the highlighted fields.', fieldErrors })
    }
    const password = body.password as string

    let lock: string
    try {
      lock = await port.acquireLock()
    } catch (error) {
      const code = dbErrorCode(error)
      if (code === 'already_initialized') {
        return json(request, config, 409, { error: code, message: 'Setup has already been completed. Sign in instead.' })
      }
      if (code === 'bootstrap_in_progress') {
        return json(request, config, 409, { error: code, message: 'Setup is already in progress. Try again in a few minutes.' })
      }
      return json(request, config, 500, { error: 'setup_failed', message: 'Setup could not start. Check the server logs.' })
    }

    let userId: string | null = null
    try {
      userId = await port.createUser({ email, password, fullName })
      const workspaceId = await port.complete({ lock, userId, fullName, workspaceName })
      return json(request, config, 201, { workspaceId, email })
    } catch (error) {
      // Undo partial work so the installer can retry cleanly.
      if (userId) await port.deleteUser(userId).catch(() => undefined)
      await port.releaseLock(lock).catch(() => undefined)
      const message = (error as { message?: string })?.message ?? ''
      if (/already.*registered|already exists/i.test(message)) {
        return json(request, config, 409, {
          error: 'email_in_use',
          message: 'An account with this email already exists. Use the manual bootstrap procedure in the README.',
        })
      }
      if (dbErrorCode(error) === 'already_initialized') {
        return json(request, config, 409, { error: 'already_initialized', message: 'Setup has already been completed. Sign in instead.' })
      }
      return json(request, config, 500, { error: 'setup_failed', message: 'Setup failed and was rolled back. Check the server logs.' })
    }
  }
}
