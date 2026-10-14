import { createClient, type SupportedStorage } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { readEnv } from './env'

const REMEMBER_KEY = 'jm.remember-session'

function safeStorage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

export function getRememberSession(): boolean {
  return safeStorage('local')?.getItem(REMEMBER_KEY) !== '0'
}

/**
 * "Keep me signed in": Supabase persists the session through this adapter.
 * When remember is off the session lives in sessionStorage and ends with the
 * browser tab. Only the Supabase session is stored here — roles and
 * workspace access are always re-read from the database.
 */
export function setRememberSession(remember: boolean) {
  const local = safeStorage('local')
  const session = safeStorage('session')
  local?.setItem(REMEMBER_KEY, remember ? '1' : '0')
  // Move any existing auth entries to the chosen storage.
  const from = remember ? session : local
  const to = remember ? local : session
  if (!from || !to) return
  for (const key of Object.keys(from)) {
    if (key.startsWith('sb-')) {
      to.setItem(key, from.getItem(key) ?? '')
      from.removeItem(key)
    }
  }
}

const authStorage: SupportedStorage = {
  getItem(key) {
    return safeStorage(getRememberSession() ? 'local' : 'session')?.getItem(key) ?? null
  },
  setItem(key, value) {
    safeStorage(getRememberSession() ? 'local' : 'session')?.setItem(key, value)
  },
  removeItem(key) {
    safeStorage('local')?.removeItem(key)
    safeStorage('session')?.removeItem(key)
  },
}

const { env } = readEnv()

/** Null when the app is not configured; the UI then shows setup instructions. */
export const supabase = env
  ? createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'implicit',
        storage: authStorage,
      },
    })
  : null

export function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

export const appUrl = env?.appUrl ?? (typeof window !== 'undefined' ? window.location.origin : '')
