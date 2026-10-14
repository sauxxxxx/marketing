import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, ClipboardCopy, MailPlus, MoreHorizontal, RotateCw, UserMinus, UserPlus, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { PageHeader } from '@/components/common/PageHeader'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Field } from '@/components/common/Field'
import { EmptyState, ErrorState, PageLoader, Spinner } from '@/components/common/states'
import { PersonAvatar } from '@/components/content/badges'
import { useActiveWorkspace } from '@/features/workspace/WorkspaceProvider'
import { useLookups, useMembers, wsKey, type MemberWithProfile } from '@/hooks/useWorkspaceData'
import { requireSupabase } from '@/lib/supabase'
import { friendlyError } from '@/lib/errors'
import { EdgeFunctionError, invokeFunction } from '@/lib/functions'
import { ROLE_LABEL } from '@/lib/permissions'
import { formatTimestamp } from '@/lib/dates'
import { emailSchema } from '@/lib/validation'
import type { Invitation, WorkspaceRole } from '@/types/database'
import { cn } from '@/lib/utils'

const INVITATION_COLUMNS = 'id, workspace_id, email, role, status, invited_by, expires_at, accepted_at, accepted_by, revoked_at, revoked_by, created_at, updated_at'

interface InviteResult {
  invitationId: string
  email: string
  expiresAt: string
  delivered: boolean
  shareLink: string | null
}

function useInvitations() {
  const { workspace } = useActiveWorkspace()
  return useQuery({
    queryKey: [...wsKey(workspace.id), 'invitations'],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('invitations')
        .select(INVITATION_COLUMNS)
        .eq('workspace_id', workspace.id)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data as Invitation[]
    },
  })
}

function InviteDialog({ open, onOpenChange, initialEmail = '', initialRole = 'editor' }: { open: boolean; onOpenChange: (o: boolean) => void; initialEmail?: string; initialRole?: WorkspaceRole }) {
  const { workspace } = useActiveWorkspace()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState(initialEmail)
  const [role, setRole] = useState<'editor' | 'viewer'>(initialRole === 'viewer' ? 'viewer' : 'editor')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<InviteResult | null>(null)
  const [copied, setCopied] = useState(false)

  const invite = useMutation({
    mutationFn: () => invokeFunction<InviteResult>('invite-member', { workspaceId: workspace.id, email, role }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [...wsKey(workspace.id), 'invitations'] })
      if (data.delivered) {
        toast.success(`Invitation sent to ${data.email}.`)
        close()
      } else {
        setResult(data)
      }
    },
    onError: (e) => setError(e instanceof EdgeFunctionError ? e.message : friendlyError(e)),
  })

  const close = () => {
    onOpenChange(false)
    setTimeout(() => {
      setEmail('')
      setResult(null)
      setError(null)
      setCopied(false)
    }, 200)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>Invitation created — email not sent</DialogTitle>
              <DialogDescription>
                The email to {result.email} couldn’t be delivered (often a mail rate limit). Share this link with them directly. It works once, only for{' '}
                {result.email}, and expires {formatTimestamp(result.expiresAt, workspace.timezone, false)}.
              </DialogDescription>
            </DialogHeader>
            {result.shareLink ? (
              <div className="flex gap-2">
                <Input readOnly value={result.shareLink} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} />
                <Button
                  variant="outline"
                  onClick={async () => {
                    await navigator.clipboard.writeText(result.shareLink!)
                    setCopied(true)
                  }}
                >
                  {copied ? <Check /> : <ClipboardCopy />} {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-destructive">A shareable link couldn’t be generated either. Check the email settings in Supabase and try again.</p>
            )}
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setError(null)
              const parsed = emailSchema.safeParse(email)
              if (!parsed.success) {
                setError(parsed.error.issues[0]?.message ?? 'Enter a valid email address.')
                return
              }
              invite.mutate()
            }}
          >
            <DialogHeader>
              <DialogTitle>Invite a team member</DialogTitle>
              <DialogDescription>They’ll get an email to set up their account or sign in. Administrators are promoted from an existing member’s role.</DialogDescription>
            </DialogHeader>
            <div className="my-4 flex flex-col gap-3">
              {error && (
                <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}
              <Field label="Email" required>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="off" />
              </Field>
              <Field label="Role" required hint={role === 'editor' ? 'Can create, edit, schedule and move content through production.' : 'Read-only: calendars, content, summaries and exports.'}>
                <Select value={role} onValueChange={(v) => setRole(v as 'editor' | 'viewer')}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="editor">Editor</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={invite.isPending}>
                {invite.isPending ? <Spinner className="[&_svg]:text-current" /> : <MailPlus />}
                Send invitation
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function invitationState(inv: Invitation): { label: string; className: string } {
  if (inv.status === 'accepted') return { label: 'Accepted', className: 'text-emerald-800 bg-emerald-50 border-emerald-200' }
  if (inv.status === 'revoked') return { label: 'Revoked', className: 'text-zinc-500 bg-zinc-100 border-zinc-200' }
  if (new Date(inv.expires_at) < new Date()) return { label: 'Expired', className: 'text-orange-900 bg-orange-50 border-orange-200' }
  return { label: 'Pending', className: 'text-amber-900 bg-amber-50 border-amber-200' }
}

export default function TeamPage() {
  const { workspace, userId } = useActiveWorkspace()
  const lookups = useLookups()
  const members = useMembers()
  const invitations = useInvitations()
  const queryClient = useQueryClient()
  const [inviting, setInviting] = useState<null | { email?: string; role?: WorkspaceRole }>(null)
  const [statusChange, setStatusChange] = useState<MemberWithProfile | null>(null)
  const [revoking, setRevoking] = useState<Invitation | null>(null)

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [...wsKey(workspace.id), 'members'] })
    queryClient.invalidateQueries({ queryKey: [...wsKey(workspace.id), 'invitations'] })
  }

  const changeRole = async (member: MemberWithProfile, role: WorkspaceRole) => {
    const { error } = await requireSupabase().rpc('update_member_role', { p_member_id: member.id, p_role: role })
    if (error) toast.error(friendlyError(error))
    else toast.success(`${member.profile?.full_name || member.profile?.email} is now ${ROLE_LABEL[role].toLowerCase()}.`)
    refresh()
  }

  const toggleStatus = async (member: MemberWithProfile) => {
    const next = member.status === 'active' ? 'deactivated' : 'active'
    const { error } = await requireSupabase().rpc('set_member_status', { p_member_id: member.id, p_status: next })
    if (error) throw new Error(friendlyError(error))
    toast.success(next === 'deactivated' ? 'Member deactivated. Their content is kept.' : 'Member reactivated.')
    refresh()
  }

  const revoke = async (inv: Invitation) => {
    const { error } = await requireSupabase().rpc('revoke_invitation', { p_invitation_id: inv.id })
    if (error) toast.error(friendlyError(error))
    else toast.success('Invitation revoked.')
    refresh()
  }

  const pendingInvites = (invitations.data ?? []).filter((i) => i.status === 'pending')
  const pastInvites = (invitations.data ?? []).filter((i) => i.status !== 'pending').slice(0, 20)

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Team"
        description="Invite people, set their role and manage access. Role changes take effect immediately."
        actions={
          <Button size="sm" onClick={() => setInviting({})}>
            <UserPlus /> Invite member
          </Button>
        }
      />
      <div className="flex flex-col gap-4 p-3 md:p-4">
        <section className="rounded-lg border bg-card">
          <header className="border-b px-4 py-2.5">
            <h2 className="text-sm font-semibold">Members</h2>
          </header>
          {members.isPending ? (
            <PageLoader />
          ) : members.isError ? (
            <ErrorState error={members.error} onRetry={() => members.refetch()} />
          ) : members.data.length === 0 ? (
            <EmptyState icon={<Users />} title="No members" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-40">Role</TableHead>
                    <TableHead className="w-28">Status</TableHead>
                    <TableHead className="w-40">Joined</TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.data.map((m) => {
                    const isSelf = m.user_id === userId
                    const name = m.profile?.full_name || m.profile?.email || 'Unknown'
                    return (
                      <TableRow key={m.id} className={cn(m.status !== 'active' && 'text-muted-foreground')}>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <PersonAvatar name={name} className="size-7 text-[10px]" />
                            <div className="min-w-0">
                              <div className="truncate font-medium">
                                {name}
                                {isSelf && <span className="ml-1 text-xs font-normal text-muted-foreground">(you)</span>}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">{m.profile?.email}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {isSelf ? (
                            <span className="text-sm">{ROLE_LABEL[m.role]}</span>
                          ) : (
                            <Select value={m.role} onValueChange={(v) => changeRole(m, v as WorkspaceRole)}>
                              <SelectTrigger size="sm" className="w-36" aria-label={`Role for ${name}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="admin">Administrator</SelectItem>
                                <SelectItem value="editor">Editor</SelectItem>
                                <SelectItem value="viewer">Viewer</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className={cn('inline-flex h-5 items-center rounded-sm border px-1.5 text-[11px] font-medium', m.status === 'active' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-zinc-200 bg-zinc-100 text-zinc-600')}>
                            {m.status === 'active' ? 'Active' : 'Deactivated'}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs">{formatTimestamp(m.joined_at, workspace.timezone, false)}</TableCell>
                        <TableCell>
                          {!isSelf && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`}>
                                  <MoreHorizontal />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem variant={m.status === 'active' ? 'destructive' : 'default'} onSelect={() => setStatusChange(m)}>
                                  {m.status === 'active' ? <UserMinus /> : <RotateCw />}
                                  {m.status === 'active' ? 'Deactivate' : 'Reactivate'}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <section className="rounded-lg border bg-card">
          <header className="border-b px-4 py-2.5">
            <h2 className="text-sm font-semibold">Invitations</h2>
          </header>
          {invitations.isPending ? (
            <PageLoader />
          ) : invitations.isError ? (
            <ErrorState error={invitations.error} onRetry={() => invitations.refetch()} />
          ) : pendingInvites.length + pastInvites.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">No invitations sent yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead className="w-24">Role</TableHead>
                    <TableHead className="w-28">Status</TableHead>
                    <TableHead className="w-44">Sent</TableHead>
                    <TableHead className="w-44">Expires</TableHead>
                    <TableHead className="w-28">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...pendingInvites, ...pastInvites].map((inv) => {
                    const state = invitationState(inv)
                    return (
                      <TableRow key={inv.id}>
                        <TableCell>
                          <div className="font-medium">{inv.email}</div>
                          {inv.invited_by && <div className="text-xs text-muted-foreground">by {lookups.personName(inv.invited_by)}</div>}
                        </TableCell>
                        <TableCell>{ROLE_LABEL[inv.role]}</TableCell>
                        <TableCell>
                          <span className={cn('inline-flex h-5 items-center rounded-sm border px-1.5 text-[11px] font-medium', state.className)}>{state.label}</span>
                        </TableCell>
                        <TableCell className="text-xs">{formatTimestamp(inv.created_at, workspace.timezone)}</TableCell>
                        <TableCell className="text-xs">{inv.status === 'pending' ? formatTimestamp(inv.expires_at, workspace.timezone) : '—'}</TableCell>
                        <TableCell className="text-right">
                          {inv.status === 'pending' && state.label === 'Pending' && (
                            <Button variant="ghost" size="xs" onClick={() => setRevoking(inv)}>
                              Revoke
                            </Button>
                          )}
                          {(state.label === 'Expired' || inv.status === 'revoked') && (
                            <Button variant="ghost" size="xs" onClick={() => setInviting({ email: inv.email, role: inv.role })}>
                              Resend
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </div>

      {inviting && <InviteDialog open onOpenChange={(o) => !o && setInviting(null)} initialEmail={inviting.email} initialRole={inviting.role} />}
      <ConfirmDialog
        open={!!statusChange}
        onOpenChange={(o) => !o && setStatusChange(null)}
        title={statusChange?.status === 'active' ? 'Deactivate this member?' : 'Reactivate this member?'}
        description={
          statusChange?.status === 'active'
            ? 'They lose access to this workspace immediately. Content they created or own is kept.'
            : 'They regain access with their previous role.'
        }
        confirmLabel={statusChange?.status === 'active' ? 'Deactivate' : 'Reactivate'}
        destructive={statusChange?.status === 'active'}
        onConfirm={async () => {
          try {
            if (statusChange) await toggleStatus(statusChange)
          } catch (e) {
            toast.error((e as Error).message)
          }
        }}
      />
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Revoke invitation?"
        description={`The link sent to ${revoking?.email} will stop working.`}
        confirmLabel="Revoke"
        destructive
        onConfirm={() => revoking && revoke(revoking)}
      />
    </div>
  )
}
