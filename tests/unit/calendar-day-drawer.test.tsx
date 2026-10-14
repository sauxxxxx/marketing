import { useState } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Lookups } from '@/hooks/useWorkspaceData'
import { CalendarDayDrawer } from '@/features/calendar/CalendarDayDrawer'
import { FORMATS, PILLARS, makeItem } from './fixtures'

const lookups: Lookups = {
  brands: [],
  formats: FORMATS,
  pillars: PILLARS,
  members: [],
  brandById: new Map(),
  formatById: new Map(FORMATS.map((format) => [format.id, format])),
  pillarById: new Map(),
  memberByUserId: new Map(),
  editorsByBrand: new Map(),
  myBrandIds: new Set(),
  personName: () => 'Editor One',
  loading: false,
  error: null,
  refetch: async () => [] as never,
}

const items = Array.from({ length: 15 }, (_, index) =>
  makeItem({
    title: `Day post ${index + 1}`,
    scheduled_date: '2026-11-09',
    scheduled_time: index === 0 ? null : `${String(index + 7).padStart(2, '0')}:00:00`,
  }),
)

const props = {
  date: '2026-11-09',
  items,
  keyDates: [],
  lookups,
  today: '2026-11-12',
  canCreate: true,
  editorOpen: false,
  returnFocus: null,
  onClose: vi.fn(),
  onOpen: vi.fn(),
  onCreate: vi.fn(),
}

it('makes every post accessible, with posting times first and readable ownership/status', async () => {
  const onOpen = vi.fn()
  render(<CalendarDayDrawer {...props} onOpen={onOpen} />)
  const drawer = screen.getByRole('dialog')
  expect(drawer).toHaveAccessibleName('Monday, 9 November 2026')
  expect(within(drawer).getByText('15 posts · Matching your calendar filters')).toBeInTheDocument()
  const buttons = within(drawer).getAllByRole('button', { name: /^Open Day post/ })
  expect(buttons).toHaveLength(15)
  expect(buttons[0]).toHaveAccessibleName('Open Day post 2')
  expect(buttons[14]).toHaveAccessibleName('Open Day post 1')
  expect(within(buttons[0]).getAllByText('Editor One')[0]).toBeInTheDocument()
  expect(within(buttons[0]).getByText('Planned')).toBeInTheDocument()
  await userEvent.click(buttons[14])
  expect(onOpen).toHaveBeenCalledWith(items[0])
})

it('restores the same day and scroll position after closing a content editor', async () => {
  function Harness() {
    const [editorOpen, setEditorOpen] = useState(false)
    return (
      <>
        <CalendarDayDrawer {...props} editorOpen={editorOpen} onOpen={() => setEditorOpen(true)} />
        {editorOpen && <button onClick={() => setEditorOpen(false)}>Close content editor</button>}
      </>
    )
  }
  render(<Harness />)
  const scroller = screen.getByRole('dialog').querySelector('.overflow-y-auto') as HTMLElement
  fireEvent.scroll(scroller, { target: { scrollTop: 220 } })
  await userEvent.click(screen.getByRole('button', { name: 'Open Day post 15' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Close content editor' }))
  expect(await screen.findByRole('dialog')).toHaveAccessibleName('Monday, 9 November 2026')
  expect(screen.getByRole('dialog').querySelector('.overflow-y-auto')?.scrollTop).toBe(220)
})

it('shows only the filtered records supplied by the calendar and handles an empty filtered day', () => {
  const { rerender } = render(<CalendarDayDrawer {...props} items={[items[2]]} canCreate={false} />)
  expect(screen.getAllByRole('button', { name: /^Open Day post/ })).toHaveLength(1)
  expect(screen.queryByRole('button', { name: 'Add content for this day' })).not.toBeInTheDocument()
  rerender(<CalendarDayDrawer {...props} items={[]} canCreate={false} />)
  expect(screen.queryByRole('button', { name: /^Open Day post/ })).not.toBeInTheDocument()
  expect(screen.getByText('No posts match your calendar filters for this day.')).toBeInTheDocument()
})

it('closes with Escape and returns focus to the calendar trigger', async () => {
  const trigger = document.createElement('button')
  document.body.appendChild(trigger)
  const onClose = vi.fn()
  const { rerender, unmount } = render(<CalendarDayDrawer {...props} onClose={onClose} returnFocus={trigger} />)
  await userEvent.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalled()
  rerender(<CalendarDayDrawer {...props} date={null} returnFocus={trigger} />)
  await waitFor(() => expect(trigger).toHaveFocus())
  unmount()
  trigger.remove()
})
