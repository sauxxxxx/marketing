import { Link } from 'react-router-dom'
import { CalendarHeart } from 'lucide-react'
import type { KeyDate } from '@/types/database'
import type { MonthlySummary } from '@/lib/summary'
import { CONTENT_STATUSES, STATUS_LABEL } from '@/lib/status'
import { formatDate } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { StatusIcon } from './badges'

function Row({ label, value, swatch, muted }: { label: string; value: number; swatch?: React.ReactNode; muted?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2 py-0.5 text-[13px]', muted && 'text-muted-foreground')}>
      {swatch}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="font-medium tabular">{value}</span>
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b px-4 py-3 last:border-b-0">
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

/** The automatic replacement for the Canva calendar's hand-counted summary. */
export function SummaryPanel({
  summary,
  keyDates,
  periodLabel,
  unscheduledHref,
  className,
}: {
  summary: MonthlySummary
  keyDates: KeyDate[]
  periodLabel: string
  unscheduledHref?: string
  className?: string
}) {
  return (
    <aside aria-label={`Summary for ${periodLabel}`} className={cn('bg-card', className)}>
      <div className="border-b px-4 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Summary · {periodLabel}</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular">{summary.plannedTotal}</span>
          <span className="text-sm text-muted-foreground">planned posts</span>
        </div>
        <div className="mt-1 grid grid-cols-2 gap-x-3 text-xs text-muted-foreground">
          <span>
            <strong className="font-semibold text-foreground tabular">{summary.publishedTotal}</strong> published
          </span>
          <span>
            <strong className="font-semibold text-foreground tabular">{summary.approvedAwaitingPublication}</strong> approved, not yet live
          </span>
          {summary.overdueCount > 0 && (
            <span className="text-red-700">
              <strong className="font-semibold tabular">{summary.overdueCount}</strong> overdue
            </span>
          )}
          {summary.cancelledTotal > 0 && (
            <span>
              <strong className="font-semibold text-foreground tabular">{summary.cancelledTotal}</strong> cancelled (not counted)
            </span>
          )}
        </div>
      </div>

      <Block title="By format">
        {summary.byFormat.map((f) => (
          <Row key={f.id ?? 'none'} label={f.name} value={f.count} muted={f.count === 0} swatch={<span className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: f.color }} />} />
        ))}
      </Block>

      <Block title="By pillar">
        {summary.byPillar.filter((p) => p.count > 0).length === 0 && <p className="text-xs text-muted-foreground">No posts yet.</p>}
        {summary.byPillar
          .filter((p) => p.count > 0)
          .map((p) => (
            <Row key={p.id ?? 'none'} label={p.name} value={p.count} swatch={<span className="size-2.5 shrink-0 rounded-full border-2" style={{ borderColor: p.color }} />} />
          ))}
      </Block>

      <Block title="By status">
        {CONTENT_STATUSES.map((s) => (
          <Row key={s} label={STATUS_LABEL[s]} value={summary.byStatus[s]} muted={summary.byStatus[s] === 0} swatch={<StatusIcon status={s} className="text-muted-foreground" />} />
        ))}
      </Block>

      <Block title="By week">
        {summary.byWeek.map((w) => (
          <Row key={w.start} label={`${formatDate(w.start, 'd MMM')} – ${formatDate(w.end, 'd MMM')}`} value={w.count} muted={w.count === 0} />
        ))}
      </Block>

      <Block title="Key dates">
        {keyDates.length === 0 ? (
          <p className="text-xs text-muted-foreground">No key dates in this period.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {keyDates.map((k) => (
              <li key={k.id} className="flex items-start gap-2 text-[13px]">
                <CalendarHeart className="mt-0.5 size-3.5 shrink-0 text-rose-700" aria-hidden />
                <span className="w-12 shrink-0 text-muted-foreground tabular">{formatDate(k.date, 'd MMM')}</span>
                <span className="min-w-0">{k.name}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="Ideas">
        <p className="text-[13px]">
          <strong className="font-semibold tabular">{summary.unscheduledIdeas}</strong> unscheduled{' '}
          {summary.unscheduledIdeas === 1 ? 'idea' : 'ideas'} <span className="text-muted-foreground">(not counted above)</span>
        </p>
        {unscheduledHref && (
          <Link to={unscheduledHref} className="text-xs font-medium text-primary hover:underline">
            View ideas
          </Link>
        )}
      </Block>
    </aside>
  )
}
