import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, KanbanSquare, Library, NotebookTabs } from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { useActiveWorkspace } from '@/features/workspace/WorkspaceProvider'
import { useContentPanel } from '@/components/content/ContentPanel'
import { contentKey, escapeLike } from '@/hooks/useContent'
import { useLookups } from '@/hooks/useWorkspaceData'
import { requireSupabase } from '@/lib/supabase'
import { formatDate } from '@/lib/dates'
import { StatusIcon } from '@/components/content/badges'
import type { ContentItem } from '@/types/database'

function useDebounced<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

/** Global quick search (Ctrl/⌘ K) across titles, captions and hashtags. */
export function CommandSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { workspace } = useActiveWorkspace()
  const { openContent } = useContentPanel()
  const lookups = useLookups()
  const navigate = useNavigate()
  const [term, setTerm] = useState('')
  const debounced = useDebounced(term.trim().toLowerCase())

  const results = useQuery({
    queryKey: [...contentKey(workspace.id), 'quick-search', debounced],
    enabled: open && debounced.length >= 2,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('content_items')
        .select('id, title, status, scheduled_date, brand_id')
        .eq('workspace_id', workspace.id)
        .is('deleted_at', null)
        .like('search_text', `%${escapeLike(debounced)}%`)
        .order('scheduled_date', { ascending: false, nullsFirst: true })
        .limit(12)
      if (error) throw error
      return data as Pick<ContentItem, 'id' | 'title' | 'status' | 'scheduled_date' | 'brand_id'>[]
    },
  })

  const go = (path: string) => {
    onOpenChange(false)
    navigate(path)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search content" description="Search titles, captions and hashtags" shouldFilter={false}>
      <CommandInput placeholder="Search titles, captions, hashtags…" value={term} onValueChange={setTerm} />
      <CommandList>
        {debounced.length >= 2 && !results.isPending && <CommandEmpty>No matching content.</CommandEmpty>}
        {results.data && results.data.length > 0 && (
          <CommandGroup heading="Content">
            {results.data.map((item) => (
              <CommandItem
                key={item.id}
                value={item.id}
                onSelect={() => {
                  onOpenChange(false)
                  openContent(item.id)
                }}
              >
                <StatusIcon status={item.status} />
                <span className="truncate">{item.title}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {lookups.brandById.get(item.brand_id)?.name} · {item.scheduled_date ? formatDate(item.scheduled_date, 'd MMM yyyy') : 'Unscheduled'}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {debounced.length < 2 && (
          <CommandGroup heading="Go to">
            <CommandItem onSelect={() => go('/calendar')}>
              <CalendarDays /> Content Calendar
            </CommandItem>
            <CommandItem onSelect={() => go('/board')}>
              <KanbanSquare /> Production Board
            </CommandItem>
            <CommandItem onSelect={() => go('/library')}>
              <Library /> Content Library
            </CommandItem>
            <CommandItem onSelect={() => go('/plans')}>
              <NotebookTabs /> Monthly Plans
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
