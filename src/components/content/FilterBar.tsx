import type { ReactNode } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { type Lookups } from '@/hooks/useWorkspaceData'
import { CONTENT_STATUSES, STATUS_LABEL } from '@/lib/status'
import { EMPTY_FILTERS, activeFilterCount, type ContentFilters } from '@/lib/filters'
import { useActiveWorkspace } from '@/features/workspace/WorkspaceProvider'
import { cn } from '@/lib/utils'
import { StatusIcon } from './badges'

interface Option {
  value: string
  label: string
  swatch?: ReactNode
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: Option[]
  selected: string[]
  onChange: (values: string[]) => void
}) {
  const count = selected.length
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn('h-8 gap-1.5 font-normal', count > 0 && 'border-primary/50 bg-accent/60')}>
          {label}
          {count > 0 && <span className="rounded-sm bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular">{count}</span>}
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-1">
        <div role="listbox" aria-multiselectable aria-label={label} className="max-h-72 overflow-y-auto">
          {options.length === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">Nothing to filter.</p>}
          {options.map((o) => {
            const isSelected = selected.includes(o.value)
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => onChange(isSelected ? selected.filter((v) => v !== o.value) : [...selected, o.value])}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <span className={cn('flex size-4 items-center justify-center rounded-[3px] border', isSelected && 'border-primary bg-primary text-primary-foreground')}>
                  {isSelected && <Check className="size-3" />}
                </span>
                {o.swatch}
                <span className="truncate">{o.label}</span>
              </button>
            )
          })}
        </div>
        {count > 0 && (
          <div className="border-t p-1">
            <Button variant="ghost" size="xs" className="w-full" onClick={() => onChange([])}>
              Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function FilterBar({
  filters,
  onChange,
  lookups,
  hide = [],
  children,
}: {
  filters: ContentFilters
  onChange: (filters: ContentFilters) => void
  lookups: Lookups
  hide?: (keyof ContentFilters)[]
  children?: ReactNode
}) {
  const { role } = useActiveWorkspace()
  const set = (key: keyof ContentFilters) => (values: string[]) => onChange({ ...filters, [key]: values })
  // Editors only ever see their own posts, so an assignee filter adds nothing for them.
  const hidden = role === 'editor' ? [...hide, 'assigneeIds'] : hide
  const count = activeFilterCount(filters)
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filters">
      {!hidden.includes('brandIds') && (
        <MultiSelect
          label="Brand"
          selected={filters.brandIds}
          onChange={set('brandIds')}
          options={lookups.brands
            .filter((b) => lookups.myBrandIds.has(b.id))
            .map((b) => ({ value: b.id, label: b.is_active ? b.name : `${b.name} (inactive)` }))}
        />
      )}
      {!hidden.includes('formatIds') && (
        <MultiSelect
          label="Format"
          selected={filters.formatIds}
          onChange={set('formatIds')}
          options={lookups.formats.map((f) => ({
            value: f.id,
            label: f.name,
            swatch: <span className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: f.color }} />,
          }))}
        />
      )}
      {!hidden.includes('pillarIds') && (
        <MultiSelect
          label="Pillar"
          selected={filters.pillarIds}
          onChange={set('pillarIds')}
          options={lookups.pillars.map((p) => ({
            value: p.id,
            label: p.name,
            swatch: <span className="size-2.5 shrink-0 rounded-full border-2" style={{ borderColor: p.color }} />,
          }))}
        />
      )}
      {!hidden.includes('statuses') && (
        <MultiSelect
          label="Status"
          selected={filters.statuses}
          onChange={set('statuses') as (v: string[]) => void}
          options={CONTENT_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s], swatch: <StatusIcon status={s} /> }))}
        />
      )}
      {!hidden.includes('assigneeIds') && (
        <MultiSelect
          label="Assignee"
          selected={filters.assigneeIds}
          onChange={set('assigneeIds')}
          options={lookups.members
            .filter((m) => m.role !== 'viewer')
            .map((m) => ({ value: m.user_id, label: `${m.profile?.full_name || m.profile?.email}${m.status !== 'active' ? ' (inactive)' : ''}` }))}
        />
      )}
      {children}
      {count > 0 && (
        <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={() => onChange(EMPTY_FILTERS)}>
          <X /> Clear filters
        </Button>
      )}
    </div>
  )
}
