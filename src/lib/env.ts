/** Public runtime configuration (Vite exposes only VITE_* variables). */
export interface AppEnv {
  supabaseUrl: string
  supabaseAnonKey: string
  appUrl: string
}

export function readEnv(source: Record<string, string | undefined> = import.meta.env): { env: AppEnv | null; missing: string[] } {
  const supabaseUrl = source.VITE_SUPABASE_URL?.trim() ?? ''
  const supabaseAnonKey = source.VITE_SUPABASE_ANON_KEY?.trim() ?? ''
  const appUrl = (source.VITE_APP_URL?.trim() || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '')
  const missing: string[] = []
  if (!/^https?:\/\//.test(supabaseUrl)) missing.push('VITE_SUPABASE_URL')
  if (!supabaseAnonKey) missing.push('VITE_SUPABASE_ANON_KEY')
  if (missing.length) return { env: null, missing }
  return { env: { supabaseUrl, supabaseAnonKey, appUrl }, missing }
}
