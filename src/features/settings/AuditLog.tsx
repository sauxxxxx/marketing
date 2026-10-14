import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState, PageLoader } from '@/components/common/states'
import { useActiveWorkspace } from '@/features/workspace/WorkspaceProvider'
import { useLookups, wsKey, type Lookups } from '@/hooks/useWorkspaceData'
import { requireSupabase } from '@/lib/supabase'
import { ROLE_LABEL } from '@/lib/permissions'
import { formatTimestamp } from '@/lib/dates'
import type { WorkspaceAudit, WorkspaceRole } from '@/types/database'
import { SettingsSection } from './SettingsSection'

const PAGE = 50

export function describeAudit(entry: WorkspaceAudit, lookups: Pick<Lookups, 'personName'>): string {
  const d = entry.details as Record<string, string | string[] | undefined>
  const role = (r: unknown) => ROLE_LABEL[r as WorkspaceRole] ?? String(r)
  const person = (id: unknown) => lookups.personName(id as string) ?? 'a member'
  switch (entry.action) {
    case 'member_joined':
      return `${person(d.user_id)} joined as ${role(d.role)}`
    case 'member_role_changed':
      return `changed ${person(d.user_id)} from ${role(d.from)} to ${role(d.to)}`
    case 'member_deactivated':
      return `deactivated ${person(d.user_id)}`
    case 'member_reactivated':
      return `reactivated ${person(d.user_id)}`
    case 'invitation_created':
      return `invited ${d.email} as ${role(d.role)}`
    case 'invitation_accepted':
      return `invitation for ${d.email} was accepted`
    case 'invitation_revoked':
      return `invitation for ${d.email} was revoked`
    case 'workspace_updated':
      return `updated workspace settings (${(d.fields as string[] | undefined)?.join(', ')})`
    default: {
      const [entity, verb] = entry.action.split(/_(?=[^_]+$)/)
      const name = d.name ? ` “${d.name}”` : ''
      return `${verb ?? 'changed'} ${entity.replace(/_/g, ' ')}${name}`
    }
  }
}

export function AuditLog() {
  const { workspace } = useActiveWorkspace()
  const lookups = useLookups()
  const [page, setPage] = useState(0)
  const audit = useQuery({
    queryKey: [...wsKey(workspace.id), 'audit', page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('workspace_audit')
        .select('*')
        .eq('workspace_id', workspace.id)
        .order('created_at', { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE)
      if (error) throw error
      return data as WorkspaceAudit[]
    },
  })

  return (
    <SettingsSection title="Audit history" description="Membership, invitation, configuration and plan changes. Content history is shown on each item’s Activity tab.">
      {audit.isPending ? (
        <PageLoader />
      ) : audit.isError ? (
        <ErrorState error={audit.error} onRetry={() => audit.refetch()} />
      ) : audit.data.length === 0 ? (
        <EmptyState icon={<History />} title="No audit entries yet" />
      ) : (
        <>
          <ul className="-mx-4 -mt-4 divide-y">
            {audit.data.slice(0, PAGE).map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2 text-sm">
                <span>
                  <strong className="font-medium">{lookups.personName(entry.actor_id) ?? 'System'}</strong> {describeAudit(entry, lookups)}
                </span>
                <time className="text-xs text-muted-foreground" dateTime={entry.created_at}>
                  {formatTimestamp(entry.created_at, workspace.timezone)}
                </time>
              </li>
            ))}
          </ul>
          <div className="-mx-4 -mb-4 flex justify-end gap-1 border-t px-4 py-2">
            <Button variant="outline" size="icon-sm" aria-label="Newer entries" disabled={page === 0} onClick={() => setPage(page - 1)}>
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="icon-sm" aria-label="Older entries" disabled={audit.data.length <= PAGE} onClick={() => setPage(page + 1)}>
              <ChevronRight />
            </Button>
          </div>
        </>
      )}
    </SettingsSection>
  )
}
