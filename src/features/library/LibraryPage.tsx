import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Copy, Library, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState, ErrorState, PageLoader } from '@/components/common/states'
import { FilterBar } from '@/components/content/FilterBar'
import { FormatTag, OverdueFlag, PersonAvatar, PillarTag, StatusBadge } from '@/components/content/badges'
import { useContentPanel } from '@/components/content/ContentPanel'
import { useActiveWorkspace } from '@/features/workspace/WorkspaceProvider'
import { useLookups } from '@/hooks/useWorkspaceData'
import { LIBRARY_PAGE_SIZE, useLibrary, type LibraryParams } from '@/hooks/useContent'
import { filtersFromParams, filtersToParams, type ContentFilters } from '@/lib/filters'
import { can } from '@/lib/permissions'
import { formatDate, formatTime } from '@/lib/dates'
import { overdueReason } from '@/lib/summary'
import type { ContentItem } from '@/types/database'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const SORTS: LibraryParams['sort'][] = ['scheduled_desc', 'scheduled_asc', 'updated_desc', 'title_asc']
const SCHEDULING: LibraryParams['scheduling'][] = ['all', 'scheduled', 'unscheduled', 'in_plan']

export default function LibraryPage() {
  const { role, today } = useActiveWorkspace()
  const lookups = useLookups()
  const { openContent, createContent } = useContentPanel()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') ?? '')

  const filters = useMemo(() => filtersFromParams(params), [params])
  const libraryParams: LibraryParams = {
    search: params.get('q') ?? '',
    ...filters,
    from: ISO_DATE.test(params.get('from') ?? '') ? params.get('from')! : '',
    to: ISO_DATE.test(params.get('to') ?? '') ? params.get('to')! : '',
    scheduling: SCHEDULING.includes(params.get('scheduling') as LibraryParams['scheduling']) ? (params.get('scheduling') as LibraryParams['scheduling']) : 'all',
    archived: params.get('archived') === '1',
    overdue: params.get('overdue') === '1',
    today,
    sort: SORTS.includes(params.get('sort') as LibraryParams['sort']) ? (params.get('sort') as LibraryParams['sort']) : 'scheduled_desc',
    page: Math.max(0, Number(params.get('page') ?? 0) || 0),
  }
  const library = useLibrary(libraryParams)

  const update = (changes: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '') next.delete(k)
      else next.set(k, v)
    }
    if (resetPage) next.delete('page')
    setParams(next, { replace: true })
  }

  // Debounce typing into the URL.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('q') ?? '') !== search.trim()) update({ q: search.trim() || null })
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const setFilters = (f: ContentFilters) => {
    const next = filtersToParams(f, params)
    next.delete('page')
    setParams(next, { replace: true })
  }

  const reuse = (item: ContentItem) =>
    createContent({
      title: item.title,
      brand_id: item.brand_id,
      platforms: item.platforms,
      format_id: item.format_id,
      pillar_id: item.pillar_id,
      caption: item.caption,
      hashtags: item.hashtags,
      call_to_action: item.call_to_action,
      purpose: item.purpose,
      target_audience: item.target_audience,
      creative_brief: item.creative_brief,
      reference_urls: item.reference_urls,
      status: 'planned',
      source_item_id: item.id,
    })

  const total = library.data?.count ?? 0
  const pages = Math.max(1, Math.ceil(total / LIBRARY_PAGE_SIZE))
  const page = libraryParams.page

  return (
    <div className="flex flex-col">
      <PageHeader title="Content Library" description="Search every post and idea. Reusing content creates a new item — the original is never changed.">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search titles, captions, hashtags…"
                className="h-8 pl-8"
                aria-label="Search content"
              />
            </div>
            <Tabs value={libraryParams.scheduling} onValueChange={(v) => update({ scheduling: v === 'all' ? null : v })}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
                <TabsTrigger value="unscheduled">Ideas</TabsTrigger>
                <TabsTrigger value="in_plan">In a plan</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <FilterBar filters={filters} onChange={setFilters} lookups={lookups} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="lib-from" className="text-xs text-muted-foreground">
                Scheduled from
              </Label>
              <Input id="lib-from" type="date" value={libraryParams.from} onChange={(e) => update({ from: e.target.value || null })} className="h-8 w-38" />
              <Label htmlFor="lib-to" className="text-xs text-muted-foreground">
                to
              </Label>
              <Input id="lib-to" type="date" value={libraryParams.to} onChange={(e) => update({ to: e.target.value || null })} className="h-8 w-38" />
            </div>
            <div className="flex items-center gap-2">
              <Switch id="lib-overdue" checked={libraryParams.overdue} onCheckedChange={(v) => update({ overdue: v ? '1' : null })} />
              <Label htmlFor="lib-overdue" className="font-normal">
                Overdue only
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="lib-archived" checked={libraryParams.archived} onCheckedChange={(v) => update({ archived: v ? '1' : null })} />
              <Label htmlFor="lib-archived" className="font-normal">
                Archived
              </Label>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Label htmlFor="lib-sort" className="text-xs text-muted-foreground">
                Sort
              </Label>
              <Select value={libraryParams.sort} onValueChange={(v) => update({ sort: v === 'scheduled_desc' ? null : v })}>
                <SelectTrigger id="lib-sort" size="sm" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="scheduled_desc">Newest date first</SelectItem>
                  <SelectItem value="scheduled_asc">Oldest date first</SelectItem>
                  <SelectItem value="updated_desc">Recently updated</SelectItem>
                  <SelectItem value="title_asc">Title A–Z</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </PageHeader>

      <div className="p-3 md:p-4">
        {library.isError ? (
          <ErrorState error={library.error} onRetry={() => library.refetch()} />
        ) : library.isPending || lookups.loading ? (
          <PageLoader />
        ) : library.data.rows.length === 0 ? (
          <EmptyState
            icon={<Library />}
            title="No content found"
            description={libraryParams.search ? 'Try a different search term or clear some filters.' : 'Content you create appears here.'}
            className="rounded-lg border bg-card"
          />
        ) : (
          <div className="rounded-lg border bg-card">
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-32">Date</TableHead>
                    <TableHead>Content</TableHead>
                    <TableHead className="w-36">Format · Pillar</TableHead>
                    <TableHead className="w-36">Status</TableHead>
                    <TableHead className="w-32">Owner</TableHead>
                    <TableHead className="w-20">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {library.data.rows.map((item) => {
                    const overdue = overdueReason(item, today)
                    return (
                      <TableRow key={item.id} className="cursor-pointer" onClick={() => openContent(item.id)}>
                        <TableCell className="align-top text-xs">
                          {item.scheduled_date ? (
                            <>
                              <div className="font-medium">{formatDate(item.scheduled_date, 'd MMM yyyy')}</div>
                              {item.scheduled_time && <div className="text-muted-foreground">{formatTime(item.scheduled_time)}</div>}
                            </>
                          ) : (
                            <span className="rounded-sm border border-dashed px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">Idea</span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-0 align-top">
                          <button type="button" className="block max-w-full truncate text-left font-medium hover:underline" onClick={(e) => { e.stopPropagation(); openContent(item.id) }}>
                            {item.title}
                          </button>
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="shrink-0">{lookups.brandById.get(item.brand_id)?.name}</span>
                            {item.monthly_plan_id && <span className="shrink-0 rounded-sm bg-accent px-1 text-[10px] font-medium text-accent-foreground">In plan</span>}
                            {item.caption && <span className="truncate">· {item.caption.slice(0, 80)}</span>}
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="flex flex-col items-start gap-1">
                            <FormatTag format={lookups.formatById.get(item.format_id)} />
                            {item.pillar_id && <PillarTag pillar={lookups.pillarById.get(item.pillar_id)} />}
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="flex flex-col items-start gap-1">
                            <StatusBadge status={item.status} />
                            {overdue && <OverdueFlag reason={overdue} />}
                          </div>
                        </TableCell>
                        <TableCell className="align-top text-xs">
                          {item.assigned_to ? (
                            <span className="inline-flex items-center gap-1.5">
                              <PersonAvatar name={lookups.personName(item.assigned_to)} />
                              <span className="truncate">{lookups.personName(item.assigned_to)}</span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Unassigned</span>
                          )}
                        </TableCell>
                        <TableCell className="align-top text-right">
                          {can(role, 'content.reuse') && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Reuse “${item.title}” as new content`}
                              title="Reuse as new content"
                              onClick={(e) => {
                                e.stopPropagation()
                                reuse(item)
                              }}
                            >
                              <Copy />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y md:hidden">
              {library.data.rows.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => openContent(item.id)} className="flex w-full flex-col gap-1 px-3 py-2.5 text-left">
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>{item.scheduled_date ? formatDate(item.scheduled_date, 'EEE d MMM yyyy') : 'Unscheduled idea'}</span>
                      <StatusBadge status={item.status} />
                    </div>
                    <span className="font-medium">{item.title}</span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <FormatTag format={lookups.formatById.get(item.format_id)} /> {lookups.brandById.get(item.brand_id)?.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
              <span className="tabular">
                {page * LIBRARY_PAGE_SIZE + 1}–{Math.min(total, (page + 1) * LIBRARY_PAGE_SIZE)} of {total}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={page === 0} onClick={() => update({ page: String(page - 1) }, false)}>
                  <ChevronLeft />
                </Button>
                <span className="px-2 tabular">
                  Page {page + 1} of {pages}
                </span>
                <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={page + 1 >= pages} onClick={() => update({ page: String(page + 1) }, false)}>
                  <ChevronRight />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
