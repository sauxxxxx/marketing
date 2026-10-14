// One-time first-administrator setup.
// Deployed with JWT verification disabled (see supabase/config.toml) because
// the caller has no account yet. Access is gated by the BOOTSTRAP_TOKEN
// secret and by the single-use lock inside the database.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { parseOrigins } from '../_shared/http.ts'
import { createBootstrapHandler } from './handler.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const handler = createBootstrapHandler(
  {
    bootstrapToken: Deno.env.get('BOOTSTRAP_TOKEN'),
    allowedOrigins: parseOrigins(Deno.env.get('ALLOWED_ORIGINS')),
  },
  {
    async acquireLock() {
      const { data, error } = await admin.rpc('bootstrap_acquire_lock')
      if (error) throw error
      return data as string
    },
    async releaseLock(lock) {
      const { error } = await admin.rpc('bootstrap_release_lock', { p_lock: lock })
      if (error) throw error
    },
    async createUser({ email, password, fullName }) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      })
      if (error) throw error
      return data.user.id
    },
    async deleteUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId)
      if (error) throw error
    },
    async complete({ lock, userId, fullName, workspaceName }) {
      const { data, error } = await admin.rpc('bootstrap_complete', {
        p_lock: lock,
        p_user_id: userId,
        p_full_name: fullName,
        p_workspace_name: workspaceName,
      })
      if (error) throw error
      return data as string
    },
  },
)

Deno.serve(async (request) => {
  try {
    return await handler(request)
  } catch (error) {
    console.error('bootstrap: unexpected error', error)
    return new Response(JSON.stringify({ error: 'internal_error', message: 'Unexpected error.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
