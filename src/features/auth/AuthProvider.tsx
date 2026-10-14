import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

type AuthStatus = 'loading' | 'signed_out' | 'signed_in'

interface AuthContextValue {
  status: AuthStatus
  session: Session | null
  user: User | null
  /** True right after arriving from a password-recovery email. */
  recovering: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [recovering, setRecovering] = useState(false)

  useEffect(() => {
    if (!supabase) {
      setStatus('signed_out')
      return
    }
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setStatus(data.session ? 'signed_in' : 'signed_out')
    })
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      if (event === 'SIGNED_OUT') {
        // Drop every cached private record the moment the session ends.
        queryClient.clear()
        setRecovering(false)
      }
      setSession(next)
      setStatus(next ? 'signed_in' : 'signed_out')
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [queryClient])

  const signOut = useCallback(async () => {
    try {
      await supabase?.auth.signOut({ scope: 'local' })
    } finally {
      queryClient.clear()
      setSession(null)
      setStatus('signed_out')
    }
  }, [queryClient])

  const value = useMemo<AuthContextValue>(
    () => ({ status, session, user: session?.user ?? null, recovering, signOut }),
    [status, session, recovering, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
