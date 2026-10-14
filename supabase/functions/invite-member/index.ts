// Sends a workspace invitation. Requires a signed-in caller (JWT verified by
// the platform); the database function create_invitation re-checks that the
// caller is an administrator of the target workspace.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { parseOrigins } from '../_shared/http.ts'
import { type CreatedInvitation, createInviteHandler } from './handler.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const appUrl = Deno.env.get('APP_URL')!

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const publicClient = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const handler = createInviteHandler(
  { appUrl, allowedOrigins: parseOrigins(Deno.env.get('ALLOWED_ORIGINS')) },
  {
    async createInvitation(jwt, { workspaceId, email, role }) {
      const asCaller = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { data, error } = await asCaller.rpc('create_invitation', {
        p_workspace_id: workspaceId,
        p_email: email,
        p_role: role,
      })
      if (error) throw error
      const row = (data as CreatedInvitation[] | null)?.[0]
      if (!row) throw new Error('No invitation returned')
      return row
    },
    async sendInviteEmail(email, redirectTo) {
      const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo })
      if (error) throw error
    },
    async sendMagicLink(email, redirectTo) {
      const { error } = await publicClient.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
      })
      if (error) throw error
    },
    async generateInviteLink(email, redirectTo) {
      const { data, error } = await admin.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo } })
      if (error) return null
      return data.properties?.action_link ?? null
    },
  },
)

Deno.serve(async (request) => {
  try {
    return await handler(request)
  } catch (error) {
    console.error('invite-member: unexpected error', error)
    return new Response(JSON.stringify({ error: 'internal_error', message: 'Unexpected error.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
