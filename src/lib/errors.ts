/**
 * Converts Supabase/PostgREST/Auth errors into messages that are safe to show:
 * no SQL, constraint internals, stack traces or secrets.
 *
 * Messages raised deliberately by our database functions (SQLSTATE P0001 and
 * 42501 with a human sentence) are passed through; everything else is mapped
 * to a generic explanation.
 */
interface ErrorLike {
  code?: string
  message?: string
  status?: number
  name?: string
}

const CONSTRAINT_MESSAGES: Record<string, string> = {
  monthly_plans_one_per_brand_month: 'A plan already exists for this brand and month.',
  brands_unique_name: 'A brand with this name already exists.',
  content_formats_unique_name: 'A format with this name already exists.',
  content_pillars_unique_name: 'A pillar with this name already exists.',
  key_dates_workspace_id_date_name_key: 'This key date already exists.',
  content_time_requires_date: 'Choose a date before setting a time.',
  invitations_one_pending_per_email: 'There is already a pending invitation for this email.',
}

const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Email or password is incorrect.',
  email_not_confirmed: 'Confirm your email address before signing in.',
  user_banned: 'This account has been suspended. Contact your administrator.',
  over_request_rate_limit: 'Too many attempts. Wait a moment and try again.',
  over_email_send_rate_limit: 'Too many emails sent. Wait a few minutes and try again.',
  same_password: 'Choose a password different from your current one.',
  weak_password: 'Choose a stronger password.',
  session_expired: 'Your session has expired. Sign in again.',
  session_not_found: 'Your session has expired. Sign in again.',
  otp_expired: 'This link has expired. Request a new one.',
  email_provider_disabled: 'Email sign-in is turned off for this Supabase project. An administrator must enable the Email provider (Authentication → Sign In / Providers).',
  signup_disabled: 'New accounts can only be created by invitation.',
}

const SAFE_SENTENCE = /^[A-Z][^\n]{3,200}[.!?]$/

export function friendlyError(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!error) return fallback
  if (typeof error === 'string') return SAFE_SENTENCE.test(error) ? error : fallback
  const e = error as ErrorLike
  const message = e.message ?? ''

  if (e.code && AUTH_MESSAGES[e.code]) return AUTH_MESSAGES[e.code]
  if (e.name === 'AuthApiError' || e.name === 'AuthWeakPasswordError') {
    if (/invalid login credentials/i.test(message)) return AUTH_MESSAGES.invalid_credentials
    if (/password/i.test(message) && SAFE_SENTENCE.test(message)) return message
  }

  if (e.code === 'P0001' && SAFE_SENTENCE.test(message)) return message
  if (e.code === '42501') {
    return SAFE_SENTENCE.test(message) && !/row-level security|permission denied/i.test(message)
      ? message
      : 'You don’t have permission to do that.'
  }
  if (e.code === '23505' || e.code === '23514' || e.code === '23503') {
    const constraint = Object.keys(CONSTRAINT_MESSAGES).find((c) => message.includes(c))
    if (constraint) return CONSTRAINT_MESSAGES[constraint]
    if (e.code === '23503') return 'This item is still in use and cannot be removed. Deactivate it instead.'
    if (e.code === '23505') return 'This already exists.'
    return 'Some values are not valid. Check the form and try again.'
  }
  if (e.code === 'PGRST116') return 'This item no longer exists or you don’t have permission to change it.'
  if (e.code === 'PGRST301' || e.status === 401) return 'Your session has expired. Sign in again.'
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return 'Can’t reach the server. Check your connection and try again.'
  }
  return fallback
}

export function isPermissionError(error: unknown): boolean {
  const e = error as ErrorLike | null
  return e?.code === '42501' || e?.code === 'PGRST116'
}
