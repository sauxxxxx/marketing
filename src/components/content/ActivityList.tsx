import { History } from 'lucide-react'
import { EmptyState, ErrorState, Spinner } from '@/components/common/states'
import { useActiveWorkspace } from '@/features/workspace/WorkspaceProvider'
import { useContentActivity } from '@/hooks/useContent'
import { useLookups, type Lookups } from '@/hooks/useWorkspaceData'
import { STATUS_LABEL } from '@/lib/status'
import { formatDate, formatTime, formatTimestamp } from '@/lib/dates'
import type { ContentActivity, ContentStatus } from '@/types/database'

const FIELD_LABEL: Record<string, string> = {
  title: 'title',
  brand_id: 'brand',
  platforms: 'platforms',
  format_id: 'format',
  pillar_id: 'pillar',
  caption: 'caption',
  hashtags: 'hashtags',
  call_to_action: 'call to action',
  purpose: 'purpose',
  target_audience: 'target audience',
  creative_brief: 'creative brief',
  reference_urls: 'references',
  deadline_date: 'deadline',
  internal_notes: 'internal notes',
  published_at: 'publication time',
  published_url: 'live URL',
  publication_notes: 'publication notes',
}

function dateText(date: unknown, time: unknown): string {
  if (!date) return 'unscheduled'
  return `${formatDate(date as string, 'd MMM yyyy')}${time ? ` ${formatTime(time as string)}` : ''}`
}

export function describeActivity(entry: ContentActivity, lookups: Pick<Lookups, 'personName'>): string {
  const d = entry.details as Record<string, unknown>
  const status = (s: unknown) => STATUS_LABEL[s as ContentStatus] ?? String(s)
  switch (entry.action) {
    case 'created':
      return `created this item${d.scheduled_date ? ` for ${dateText(d.scheduled_date, null)}` : ' as an unscheduled idea'}`
    case 'duplicated':
      return 'created this item as a copy of earlier content'
    case 'status_changed':
      return `changed status from ${status(d.from)} to ${status(d.to)}`
    case 'approved':
      return 'approved this item'
    case 'published':
      return 'marked this item as published'
    case 'reopened':
      return `reopened this item (${status(d.from)} → ${status(d.to)})`
    case 'rescheduled':
      return `rescheduled from ${dateText(d.from_date, d.from_time)} to ${dateText(d.to_date, d.to_time)}`
    case 'assigned':
      return d.to ? `assigned this to ${lookups.personName(d.to as string)}` : 'removed the assignee'
    case 'archived':
      return 'archived this item'
    case 'restored':
      return 'restored this item'
    case 'asset_added':
      return `attached ${d.name ?? 'a file'}`
    case 'asset_removed':
      return `removed attachment ${d.name ?? ''}`.trim()
    case 'updated': {
      const fields = ((d.fields as string[]) ?? []).map((f) => FIELD_LABEL[f] ?? f)
      return `updated ${fields.join(', ')}`
    }
    default:
      return entry.action.replace(/_/g, ' ')
  }
}

export function ActivityList({ contentId }: { contentId: string }) {
  const { timezone } = useActiveWorkspace()
  const lookups = useLookups()
  const activity = useContentActivity(contentId)

  if (activity.isPending) return <div className="py-6 text-center"><Spinner /></div>
  if (activity.isError) return <ErrorState error={activity.error} onRetry={() => activity.refetch()} />
  if (activity.data.length === 0) return <EmptyState icon={<History />} title="No activity yet" />

  return (
    <ol className="relative ml-2 border-l">
      {activity.data.map((entry) => (
        <li key={entry.id} className="mb-4 ml-4">
          <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-card bg-primary/70" aria-hidden />
          <p className="text-sm">
            <strong className="font-medium">{lookups.personName(entry.actor_id) ?? 'System'}</strong> {describeActivity(entry, lookups)}
          </p>
          <time className="text-xs text-muted-foreground" dateTime={entry.created_at}>
            {formatTimestamp(entry.created_at, timezone)}
          </time>
        </li>
      ))}
    </ol>
  )
}
