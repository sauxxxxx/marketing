import type { ComponentType } from 'react'
import { BadgeCheck, CircleCheck, CircleDashed, CircleDot, Eye, RotateCcw, Ban, AlertTriangle } from 'lucide-react'
import type { ConfigItem, ContentStatus } from '@/types/database'
import { STATUS_LABEL } from '@/lib/status'
import { cn } from '@/lib/utils'

export const STATUS_STYLE: Record<ContentStatus, { icon: ComponentType<{ className?: string }>; className: string; dot: string }> = {
  planned: { icon: CircleDashed, className: 'text-slate-700 bg-slate-100 border-slate-200', dot: 'bg-slate-400' },
  in_production: { icon: CircleDot, className: 'text-blue-800 bg-blue-50 border-blue-200', dot: 'bg-blue-600' },
  for_review: { icon: Eye, className: 'text-amber-900 bg-amber-50 border-amber-200', dot: 'bg-amber-500' },
  needs_revision: { icon: RotateCcw, className: 'text-orange-900 bg-orange-50 border-orange-200', dot: 'bg-orange-600' },
  approved: { icon: CircleCheck, className: 'text-emerald-800 bg-emerald-50 border-emerald-200', dot: 'bg-emerald-600' },
  published: { icon: BadgeCheck, className: 'text-teal-900 bg-teal-50 border-teal-200', dot: 'bg-teal-700' },
  cancelled: { icon: Ban, className: 'text-zinc-500 bg-zinc-100 border-zinc-200 line-through', dot: 'bg-zinc-400' },
}

export function StatusIcon({ status, className }: { status: ContentStatus; className?: string }) {
  const Icon = STATUS_STYLE[status].icon
  return <Icon className={cn('size-3.5 shrink-0', className)} aria-hidden />
}

export function StatusBadge({ status, compact = false, className }: { status: ContentStatus; compact?: boolean; className?: string }) {
  const style = STATUS_STYLE[status]
  const Icon = style.icon
  if (compact) {
    return (
      <span title={STATUS_LABEL[status]} className={cn('inline-flex items-center', className)}>
        <Icon className="size-3.5 shrink-0 opacity-80" aria-hidden />
        <span className="sr-only">{STATUS_LABEL[status]}</span>
      </span>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex h-5 max-w-full min-w-0 items-center gap-1 rounded-sm border px-1.5 text-[11px] font-medium whitespace-nowrap',
        style.className,
        className,
      )}
      title={STATUS_LABEL[status]}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{STATUS_LABEL[status]}</span>
    </span>
  )
}

/** Formats: solid colour swatch + name. */
export function FormatTag({ format, className }: { format: ConfigItem | undefined; className?: string }) {
  if (!format) return null
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-foreground/80', className)}>
      <span className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: format.color }} aria-hidden />
      <span className="truncate">{format.name}</span>
    </span>
  )
}

/** Pillars: outlined tag with coloured text — visually distinct from formats. */
export function PillarTag({ pillar, className }: { pillar: ConfigItem | undefined | null; className?: string }) {
  if (!pillar) return null
  return (
    <span
      className={cn('inline-flex h-5 max-w-full items-center rounded-full border px-2 text-[11px] font-medium', className)}
      style={{ color: pillar.color, borderColor: `${pillar.color}55` }}
    >
      <span className="truncate">{pillar.name}</span>
    </span>
  )
}

export function OverdueFlag({ reason, className }: { reason: 'production' | 'publication'; className?: string }) {
  return (
    <span
      className={cn('inline-flex h-5 items-center gap-1 rounded-sm border border-red-200 bg-red-50 px-1.5 text-[11px] font-semibold text-red-800', className)}
      title={reason === 'production' ? 'Production deadline has passed' : 'Scheduled date has passed without publishing'}
    >
      <AlertTriangle className="size-3" aria-hidden />
      Overdue
    </span>
  )
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+|@/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
}

export function PersonAvatar({ name, className }: { name: string | null | undefined; className?: string }) {
  return (
    <span
      title={name ?? undefined}
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-[9px] font-semibold text-accent-foreground',
        className,
      )}
    >
      {initials(name)}
      {name && <span className="sr-only">{name}</span>}
    </span>
  )
}
