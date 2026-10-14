import { cn } from '@/lib/utils'

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-7 shrink-0', className)}>
      <rect width="32" height="32" rx="6" fill="#0f5257" />
      <path d="M19 8v11.5a5.5 5.5 0 0 1-10.4 2.5" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  )
}

export function Logo({ name = 'Joyno Media', subtitle = 'Content Studio', className }: { name?: string; subtitle?: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      <div className="min-w-0 leading-tight">
        <div className="truncate text-sm font-semibold">{name}</div>
        <div className="truncate text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{subtitle}</div>
      </div>
    </div>
  )
}
