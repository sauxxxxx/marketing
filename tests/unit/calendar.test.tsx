import { render, screen, within, waitFor, renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { createMockSupabase } from './mockSupabase'
import { FORMATS, PILLARS, makeItem } from './fixtures'

const mock = vi.hoisted(() => ({ current: null as ReturnType<typeof createMockSupabase> | null }))
const toastError = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return mock.current!.client
  },
  requireSupabase: () => mock.current!.client,
  appUrl: 'https://studio.example.com',
}))
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }))
vi.mock('@/features/workspace/WorkspaceProvider', () => ({
  useActiveWorkspace: () => ({
    workspace: { id: 'w1', name: 'Joyno', timezone: 'Asia/Manila', editors_can_edit_all: true },
    role: 'editor',
    userId: 'user-1',
    today: '2026-11-12',
    timezone: 'Asia/Manila',
  }),
}))

import { usePatchContentOptimistic, contentKey } from '@/hooks/useContent'
import { CalendarDnd, MonthView, PeriodView, type CalendarViewProps } from '@/features/calendar/CalendarViews'
import type { Lookups } from '@/hooks/useWorkspaceData'
import { monthGridDays, periodDays } from '@/lib/dates'
import type { ContentItem } from '@/types/database'

beforeEach(() => {
  mock.current = createMockSupabase()
  toastError.mockReset()
})

describe('drag-and-drop persistence', () => {
  function setup() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const item = makeItem({ id: 'item-1', scheduled_date: '2026-11-05' })
    const key = [...contentKey('w1'), 'range', '2026-11-01', '2026-12-05']
    qc.setQueryData(key, [item])
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    const hook = renderHook(() => usePatchContentOptimistic(), { wrapper })
    return { qc, key, hook }
  }

  it('persists the new date to Supabase', async () => {
    const { qc, key, hook } = setup()
    mock.current!.result.data = makeItem({ id: 'item-1', scheduled_date: '2026-11-09' })
    await act(() => hook.result.current.mutateAsync({ id: 'item-1', patch: { scheduled_date: '2026-11-09' } }))
    expect(mock.current!.client.from).toHaveBeenCalledWith('content_items')
    expect(mock.current!.query.update).toHaveBeenCalledWith({ scheduled_date: '2026-11-09' })
    expect(mock.current!.query.eq).toHaveBeenCalledWith('id', 'item-1')
    expect(qc.getQueryData<ContentItem[]>(key)![0].scheduled_date).toBe('2026-11-09')
  })

  it('restores the previous date and explains why when the write fails', async () => {
    const { qc, key, hook } = setup()
    let rejectWrite: (e: unknown) => void = () => undefined
    mock.current!.query.single = vi.fn(() => new Promise((_, reject) => (rejectWrite = reject)))

    act(() => hook.result.current.mutate({ id: 'item-1', patch: { scheduled_date: '2026-11-09' } }))
    await waitFor(() => expect(qc.getQueryData<ContentItem[]>(key)![0].scheduled_date).toBe('2026-11-09'))

    await act(async () => rejectWrite({ code: '42501', message: 'new row violates row-level security policy' }))
    await waitFor(() => expect(qc.getQueryData<ContentItem[]>(key)![0].scheduled_date).toBe('2026-11-05'))
    expect(toastError).toHaveBeenCalledWith('You don’t have permission to do that.')
  })
})

function lookups(): Lookups {
  return {
    brands: [],
    formats: FORMATS,
    pillars: PILLARS,
    members: [],
    brandById: new Map(),
    formatById: new Map(FORMATS.map((f) => [f.id, f])),
    pillarById: new Map(PILLARS.map((p) => [p.id, p])),
    memberByUserId: new Map(),
    editorsByBrand: new Map(),
    myBrandIds: new Set(),
    personName: () => null,
    loading: false,
    error: null,
    refetch: async () => [] as never,
  }
}

function viewProps(days: string[], items: ContentItem[]): CalendarViewProps {
  const itemsByDay = new Map<string, ContentItem[]>()
  for (const i of items) itemsByDay.set(i.scheduled_date!, [...(itemsByDay.get(i.scheduled_date!) ?? []), i])
  return {
    days,
    itemsByDay,
    keyDatesByDay: new Map([['2026-11-30', [{ id: 'k', workspace_id: 'w1', date: '2026-11-30', name: 'Bonifacio Day', kind: 'holiday', region: 'PH', notes: null, is_demo: false, created_by: null, created_at: '', updated_at: '' }]]]),
    lookups: lookups(),
    today: '2026-11-12',
    monthKey: '2026-11',
    showBrand: false,
    canCreate: true,
    canDrag: () => true,
    pendingIds: new Set(),
    onOpen: vi.fn(),
    onCreate: vi.fn(),
    onMove: vi.fn(),
  }
}

function dayCellOf(title: string) {
  return screen.getByText(title).closest('[class*="group/day"]') as HTMLElement
}

describe('calendar views', () => {
  const items = [
    makeItem({ title: 'Kickoff carousel', scheduled_date: '2026-11-09' }),
    makeItem({ title: 'Weekend reel', scheduled_date: '2026-11-14', format_id: 'fmt-reel', scheduled_time: '18:00:00' }),
  ]

  it('places content on its scheduled day in the month view', () => {
    render(<CalendarDnd onMove={vi.fn()} renderOverlay={() => null}><MonthView {...viewProps(monthGridDays(2026, 11), items)} /></CalendarDnd>)
    expect(within(dayCellOf('Kickoff carousel')).getByLabelText('Monday, 9 November 2026')).toBeInTheDocument()
    expect(within(dayCellOf('Weekend reel')).getByLabelText('Saturday, 14 November 2026')).toBeInTheDocument()
    expect(within(dayCellOf('Weekend reel')).getByText('6:00 PM')).toBeInTheDocument()
    expect(screen.getByText('Bonifacio Day')).toBeInTheDocument()
    expect(screen.getByLabelText('Thursday, 12 November 2026 (today)')).toBeInTheDocument()
  })

  it('shows the same records on the same days in week and two-week views', () => {
    const { unmount } = render(<CalendarDnd onMove={vi.fn()} renderOverlay={() => null}><PeriodView {...viewProps(periodDays('2026-11-09', 7), items)} /></CalendarDnd>)
    expect(within(dayCellOf('Kickoff carousel')).getByLabelText('Monday, 9 November 2026')).toBeInTheDocument()
    expect(within(dayCellOf('Weekend reel')).getByLabelText('Saturday, 14 November 2026')).toBeInTheDocument()
    unmount()
    render(<CalendarDnd onMove={vi.fn()} renderOverlay={() => null}><PeriodView {...viewProps(periodDays('2026-11-09', 14), items)} /></CalendarDnd>)
    expect(screen.getAllByRole('button', { name: /Kickoff carousel/ })).toHaveLength(1)
    expect(within(dayCellOf('Weekend reel')).getByLabelText('Saturday, 14 November 2026')).toBeInTheDocument()
  })

  it('opens a card with Enter and creates content from an empty day', async () => {
    const props = viewProps(monthGridDays(2026, 11), items)
    render(<CalendarDnd onMove={vi.fn()} renderOverlay={() => null}><MonthView {...props} /></CalendarDnd>)
    const card = screen.getByRole('button', { name: /Kickoff carousel/ })
    card.focus()
    await (await import('@testing-library/user-event')).default.keyboard('{Enter}')
    expect(props.onOpen).toHaveBeenCalledWith(items[0])
    screen.getByRole('button', { name: 'Add content on 20 November' }).click()
    expect(props.onCreate).toHaveBeenCalledWith('2026-11-20')
  })
})
