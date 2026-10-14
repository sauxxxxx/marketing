import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { PageHeader } from '@/components/common/PageHeader'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { ErrorState, PageLoader } from '@/components/common/states'
import { FilterBar } from '@/components/content/FilterBar'
import { BoardCard } from '@/components/content/ContentCard'
import { StatusBadge } from '@/components/content/badges'
import { useContentPanel } from '@/components/content/ContentPanel'
import { useActiveWorkspace } from '@/features/workspace/WorkspaceProvider'
import { useLookups } from '@/hooks/useWorkspaceData'
import { useContentRange, usePatchContentOptimistic, useUnscheduledContent } from '@/hooks/useContent'
import { applyFilters, filtersFromParams, filtersToParams, type ContentFilters } from '@/lib/filters'
import { STATUS_LABEL, canTransition, isReopen, transitionError } from '@/lib/status'
import { canEditContent } from '@/lib/permissions'
import { addDays, monthRange, toLocalDate } from '@/lib/dates'
import type { ContentItem, ContentStatus } from '@/types/database'
import { cn } from '@/lib/utils'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function Column({ status, count, children }: { status: ContentStatus; count: number; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <section
      ref={setNodeRef}
      aria-label={`${STATUS_LABEL[status]} (${count})`}
      className={cn('flex w-[280px] shrink-0 flex-col rounded-lg border bg-muted/50 transition-colors', isOver && 'border-primary/50 bg-accent')}
    >
      <header className="flex items-center justify-between px-3 py-2">
        <StatusBadge status={status} />
        <span className="text-xs font-semibold text-muted-foreground tabular">{count}</span>
      </header>
      <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">{children}</div>
    </section>
  )
}

function DraggableBoardCard({ item, disabled, onOpen, children }: { item: ContentItem; disabled: boolean; onOpen: () => void; children: (dragging: boolean) => ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id, data: { item }, disabled })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-label={`${item.title}. ${disabled ? 'Press Enter to open.' : 'Press Enter to open, Space to move to another status.'}`}
      onClick={onOpen}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onOpen()
          return
        }
        listeners?.onKeyDown?.(e)
      }}
      className="cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children(isDragging)}
    </div>
  )
}

export default function BoardPage() {
  const { workspace, role, userId, today } = useActiveWorkspace()
  const lookups = useLookups()
  const { openContent } = useContentPanel()
  const [params, setParams] = useSearchParams()
  const [active, setActive] = useState<ContentItem | null>(null)
  const [reopen, setReopen] = useState<{ item: ContentItem; to: ContentStatus } | null>(null)

  const anchor = toLocalDate(today)
  const defaults = monthRange(anchor.getFullYear(), anchor.getMonth() + 1)
  const from = ISO_DATE.test(params.get('from') ?? '') ? params.get('from')! : defaults.from
  const to = ISO_DATE.test(params.get('to') ?? '') ? params.get('to')! : defaults.to
  const showRevision = params.get('revision') !== '0'
  const showCancelled = params.get('cancelled') === '1'
  const includeUnscheduled = params.get('ideas') === '1'
  const filters = useMemo(() => filtersFromParams(params), [params])

  const content = useContentRange(from, to <= addDays(from, 366) ? to : addDays(from, 366))
  const ideas = useUnscheduledContent()
  const patch = usePatchContentOptimistic((item) => `Moved to ${STATUS_LABEL[item.status]}.`)

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value === null) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }
  const setFilters = (f: ContentFilters) => setParams(filtersToParams(f, params), { replace: true })

  const allColumns: ContentStatus[] = [
    'planned',
    'in_production',
    ...(showRevision ? (['needs_revision'] as const) : []),
    'for_review',
    'approved',
    'published',
    ...(showCancelled ? (['cancelled'] as const) : []),
  ]
  // A status filter narrows the visible columns (and can reveal the optional ones).
  const columns = filters.statuses.length ? allColumns.concat(filters.statuses.filter((s) => !allColumns.includes(s))).filter((c) => filters.statuses.includes(c)) : allColumns

  const items = useMemo(() => {
    const scheduled = content.data ?? []
    const all = includeUnscheduled ? [...scheduled, ...(ideas.data ?? [])] : scheduled
    return applyFilters(all, filters)
  }, [content.data, ideas.data, includeUnscheduled, filters])

  const byStatus = useMemo(() => {
    const map = new Map<ContentStatus, ContentItem[]>()
    for (const item of items) map.set(item.status, [...(map.get(item.status) ?? []), item])
    return map
  }, [items])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] } }),
  )

  const commit = (item: ContentItem, to: ContentStatus) => patch.mutate({ id: item.id, patch: { status: to } })

  const onDrop = (item: ContentItem, to: ContentStatus) => {
    if (item.status === to) return
    if (!canTransition(item.status, to, role)) {
      toast.error(transitionError(item.status, to))
      return
    }
    if (isReopen(item.status, to)) {
      setReopen({ item, to })
      return
    }
    commit(item, to)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Production Board" description="Drag cards between columns to update status. Every move is checked against the workflow rules.">
        <div className="flex flex-col gap-2">
          <FilterBar filters={filters} onChange={setFilters} lookups={lookups} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="board-from" className="text-xs text-muted-foreground">
                From
              </Label>
              <Input id="board-from" type="date" value={from} onChange={(e) => setParam('from', e.target.value || null)} className="h-8 w-38" />
              <Label htmlFor="board-to" className="text-xs text-muted-foreground">
                to
              </Label>
              <Input id="board-to" type="date" value={to} min={from} onChange={(e) => setParam('to', e.target.value || null)} className="h-8 w-38" />
            </div>
            <div className="flex items-center gap-2">
              <Switch id="show-revision" checked={showRevision} onCheckedChange={(v) => setParam('revision', v ? null : '0')} />
              <Label htmlFor="show-revision" className="font-normal">
                Needs Revision column
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="show-cancelled" checked={showCancelled} onCheckedChange={(v) => setParam('cancelled', v ? '1' : null)} />
              <Label htmlFor="show-cancelled" className="font-normal">
                Cancelled column
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="show-ideas" checked={includeUnscheduled} onCheckedChange={(v) => setParam('ideas', v ? '1' : null)} />
              <Label htmlFor="show-ideas" className="font-normal">
                Include unscheduled ideas
              </Label>
            </div>
          </div>
        </div>
      </PageHeader>

      {content.isError ? (
        <ErrorState error={content.error} onRetry={() => content.refetch()} />
      ) : content.isPending || lookups.loading ? (
        <PageLoader label="Loading board…" />
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={(e) => setActive((e.active.data.current?.item as ContentItem) ?? null)}
          onDragCancel={() => setActive(null)}
          onDragEnd={(e) => {
            setActive(null)
            const item = e.active.data.current?.item as ContentItem | undefined
            const target = e.over?.id as ContentStatus | undefined
            if (item && target) onDrop(item, target)
          }}
          accessibility={{
            screenReaderInstructions: {
              draggable: 'Press Space to pick up a card, use the arrow keys to move between columns, and press Space again to drop it. Press Escape to cancel. Press Enter to open the card.',
            },
          }}
        >
          <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3 md:p-4">
            {columns.map((status) => {
              const list = byStatus.get(status) ?? []
              return (
                <Column key={status} status={status} count={list.length}>
                  {list.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted-foreground">No items</p>}
                  {list.map((item) => (
                    <DraggableBoardCard
                      key={item.id}
                      item={item}
                      disabled={!canEditContent(role, workspace, item, userId) || (patch.isPending && patch.variables?.id === item.id)}
                      onOpen={() => openContent(item.id)}
                    >
                      {(dragging) => <BoardCard item={item} lookups={lookups} today={today} dragging={dragging} />}
                    </DraggableBoardCard>
                  ))}
                </Column>
              )
            })}
          </div>
          <DragOverlay dropAnimation={null}>{active ? <div className="w-[264px] rotate-1 shadow-lg"><BoardCard item={active} lookups={lookups} today={today} /></div> : null}</DragOverlay>
        </DndContext>
      )}

      <ConfirmDialog
        open={!!reopen}
        onOpenChange={(o) => !o && setReopen(null)}
        title={reopen?.item.status === 'published' ? 'Reopen published content?' : 'Restore cancelled content?'}
        description={
          reopen && (
            <>
              “{reopen.item.title}” will move from {STATUS_LABEL[reopen.item.status]} back to {STATUS_LABEL[reopen.to]}. This is recorded in the activity history.
            </>
          )
        }
        confirmLabel="Reopen"
        onConfirm={() => reopen && commit(reopen.item, reopen.to)}
      />
    </div>
  )
}
