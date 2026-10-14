import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import type { ContentItem } from '@/types/database'
import { FORMATS, PILLARS, makeItem } from './fixtures'

const state = vi.hoisted(() => ({
  items: [] as ContentItem[],
  role: 'admin' as 'admin' | 'viewer',
  desktop: true,
  range: vi.fn(),
}))

vi.mock('@/features/workspace/WorkspaceProvider', () => ({
  useActiveWorkspace: () => ({
    workspace: { id: 'w1', timezone: 'Asia/Manila', default_calendar_view: 'month' },
    role: state.role,
    userId: 'admin-1',
    today: '2026-11-12',
  }),
}))
vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: (query: string) => query === '(min-width: 768px)' && state.desktop,
}))
vi.mock('@/hooks/useWorkspaceData', () => ({
  useLookups: () => ({
    brands: [],
    formats: FORMATS,
    pillars: PILLARS,
    members: [],
    brandById: new Map(),
    formatById: new Map(FORMATS.map((format) => [format.id, format])),
    pillarById: new Map(),
    personName: () => null,
    myBrandIds: new Set(),
    loading: false,
  }),
  useKeyDates: () => ({ data: [] }),
}))
vi.mock('@/hooks/useContent', () => ({
  useContentRange: (from: string, to: string) => {
    state.range(from, to)
    return { data: state.items, isError: false, isPending: false }
  },
  useUnscheduledContent: () => ({ data: [] }),
  usePatchContentOptimistic: () => ({ mutate: vi.fn() }),
}))
vi.mock('@/features/export/ExportDialog', () => ({ ExportDialog: () => null }))
vi.mock('@/components/content/ContentEditor', () => ({
  ContentEditor: ({ onClose }: { onClose: () => void }) => <button onClick={onClose}>Close content editor</button>,
}))

import CalendarPage from '@/features/calendar/CalendarPage'
import { ContentPanelProvider } from '@/components/content/ContentPanel'

function Location() {
  return <output data-testid="location">{useLocation().search}</output>
}

function renderCalendar(entry = '/calendar?d=2026-11-01&brand=brand-1') {
  const client = new QueryClient()
  const router = createMemoryRouter(
    [
      {
        path: '/calendar',
        element: (
          <ContentPanelProvider>
            <CalendarPage />
            <Location />
          </ContentPanelProvider>
        ),
      },
    ],
    { initialEntries: [entry] },
  )
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  state.items = [
    makeItem({ title: 'Visible post', scheduled_date: '2026-11-09' }),
    makeItem({ title: 'Filtered post', scheduled_date: '2026-11-09', brand_id: 'brand-2' }),
  ]
  state.role = 'admin'
  state.desktop = true
  state.range.mockClear()
})

it('preserves filters and the selected day through opening and closing the shared content editor', async () => {
  renderCalendar()
  await userEvent.click(screen.getByLabelText('Monday, 9 November 2026'))
  const drawer = screen.getByRole('dialog')
  expect(within(drawer).getByText('1 post · Matching your calendar filters')).toBeInTheDocument()
  expect(within(drawer).queryByText('Filtered post')).not.toBeInTheDocument()
  await userEvent.click(within(drawer).getByRole('button', { name: 'Open Visible post' }))
  expect(await screen.findByRole('dialog')).toHaveAccessibleName('Content details')
  await userEvent.click(screen.getByRole('button', { name: 'Close content editor' }))
  await waitFor(() => expect(screen.getByRole('dialog')).toHaveAccessibleName('Monday, 9 November 2026'))
  expect(screen.getByTestId('location')).toHaveTextContent('?d=2026-11-01&brand=brand-1')
})

it('provides a desktop agenda for the whole month while keeping filters during month navigation', async () => {
  renderCalendar()
  await userEvent.click(screen.getByRole('tab', { name: 'Agenda' }))
  expect(screen.getByRole('button', { name: 'Open Visible post' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Open Filtered post' })).not.toBeInTheDocument()
  expect(state.range).toHaveBeenLastCalledWith('2026-11-01', '2026-11-30')
  expect(screen.getByTestId('location')).toHaveTextContent('brand=brand-1&view=agenda')
  await userEvent.click(screen.getByRole('button', { name: 'Next period' }))
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('December 2026')
  expect(state.range).toHaveBeenLastCalledWith('2026-12-01', '2026-12-31')
  expect(screen.getByTestId('location')).toHaveTextContent('brand=brand-1&view=agenda')
})

it('honors viewer permissions in both the drawer and agenda', async () => {
  state.role = 'viewer'
  renderCalendar()
  await userEvent.click(screen.getByLabelText('Monday, 9 November 2026'))
  expect(screen.queryByRole('button', { name: 'Add content for this day' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Close' }))
  await userEvent.click(screen.getByRole('tab', { name: 'Agenda' }))
  expect(screen.queryByRole('button', { name: /Add content on/ })).not.toBeInTheDocument()
})

it('keeps the mobile agenda available without horizontal calendar tabs', () => {
  state.desktop = false
  renderCalendar()
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Open Visible post' })).toBeInTheDocument()
})
