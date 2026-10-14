import { QueryClient } from '@tanstack/react-query'
import { computeSummary, isOverdue, overdueReason } from '@/lib/summary'
import { CONTENT_STATUSES, canTransition, isReopen, nextStatuses } from '@/lib/status'
import { applyFilters, filtersFromParams, filtersToParams, EMPTY_FILTERS, UNASSIGNED } from '@/lib/filters'
import {
  addDays,
  formatTime,
  monthGridDays,
  periodDays,
  shiftMonth,
  timestampToZonedInput,
  todayInTimeZone,
  zonedInputToTimestamp,
} from '@/lib/dates'
import { optimisticallyPatchContent } from '@/lib/optimistic'
import { friendlyError } from '@/lib/errors'
import { contentFormSchema, parseHashtags, passwordSchema } from '@/lib/validation'
import { can, canEditContent } from '@/lib/permissions'
import { pdfText, exportFileName } from '@/features/export/exportData'
import { validateUpload, storageSafeName } from '@/components/content/AssetsPanel'
import { safeNext } from '@/features/auth/AuthLayout'
import { escapeLike } from '@/hooks/useContent'
import { pickChanged } from '@/components/content/ContentEditor'
import { FORMATS, PILLARS, makeItem } from './fixtures'

describe('monthly summary counting rules', () => {
  const from = '2026-11-01'
  const to = '2026-11-30'
  const today = '2026-11-15'
  const items = [
    makeItem({ status: 'planned', scheduled_date: '2026-11-02', format_id: 'fmt-carousel', pillar_id: 'pil-strategy' }),
    makeItem({ status: 'approved', scheduled_date: '2026-11-20', format_id: 'fmt-reel', pillar_id: 'pil-growth' }),
    makeItem({ status: 'published', scheduled_date: '2026-11-03', format_id: 'fmt-reel', pillar_id: null }),
    makeItem({ status: 'cancelled', scheduled_date: '2026-11-04', format_id: 'fmt-static' }),
    makeItem({ status: 'in_production', scheduled_date: '2026-11-10', format_id: 'fmt-carousel', deadline_date: '2026-11-08' }),
    makeItem({ status: 'planned', scheduled_date: null }), // unscheduled idea
    makeItem({ status: 'planned', scheduled_date: '2026-12-01' }), // outside period
    makeItem({ status: 'planned', scheduled_date: '2026-11-21', deleted_at: '2026-11-01T00:00:00Z' }), // archived
  ]
  const summary = computeSummary({ items, from, to, today, formats: FORMATS, pillars: PILLARS, unscheduledIdeas: 1 })

  it('excludes cancelled, unscheduled, archived and out-of-period items from planned posts', () => {
    expect(summary.plannedTotal).toBe(4)
    expect(summary.cancelledTotal).toBe(1)
    expect(summary.unscheduledIdeas).toBe(1)
  })

  it('keeps approved separate from published', () => {
    expect(summary.publishedTotal).toBe(1)
    expect(summary.approvedAwaitingPublication).toBe(1)
  })

  it('builds format and pillar breakdowns from the same set as the total', () => {
    const formatTotal = summary.byFormat.reduce((n, f) => n + f.count, 0)
    const pillarTotal = summary.byPillar.reduce((n, p) => n + p.count, 0)
    expect(formatTotal).toBe(summary.plannedTotal)
    expect(pillarTotal).toBe(summary.plannedTotal)
    expect(summary.byFormat.find((f) => f.name === 'Static Post')?.count).toBe(0)
    expect(summary.byPillar.find((p) => p.name === 'No pillar')?.count).toBe(1)
  })

  it('counts statuses across the whole period, including cancelled', () => {
    expect(Object.values(summary.byStatus).reduce((a, b) => a + b, 0)).toBe(5)
    expect(summary.byStatus.cancelled).toBe(1)
  })

  it('splits planned posts by week and day', () => {
    expect(summary.byWeek.reduce((n, w) => n + w.count, 0)).toBe(summary.plannedTotal)
    expect(summary.byWeek[0]).toEqual({ start: '2026-11-01', end: '2026-11-07', count: 2 })
    expect(summary.byDay['2026-11-04']).toBeUndefined()
  })

  it('flags overdue production and publication work', () => {
    // 2 Nov (planned) and 10 Nov (in production) are past their dates.
    expect(summary.overdueCount).toBe(2)
    expect(overdueReason({ status: 'in_production', scheduled_date: '2026-11-20', deadline_date: '2026-11-08' }, today)).toBe('production')
    expect(overdueReason({ status: 'approved', scheduled_date: '2026-11-14', deadline_date: null }, today)).toBe('publication')
    expect(overdueReason({ status: 'approved', scheduled_date: '2026-11-20', deadline_date: '2026-11-08' }, today)).toBeNull()
    expect(isOverdue({ status: 'published', scheduled_date: '2026-11-01', deadline_date: '2026-10-01' }, today)).toBe(false)
  })
})

describe('status transition policy', () => {
  it('follows the documented standard path', () => {
    expect(canTransition('planned', 'in_production', 'editor')).toBe(true)
    expect(canTransition('in_production', 'for_review', 'editor')).toBe(true)
    expect(canTransition('for_review', 'approved', 'editor')).toBe(true)
    expect(canTransition('approved', 'published', 'editor')).toBe(true)
    expect(canTransition('for_review', 'needs_revision', 'editor')).toBe(true)
    expect(canTransition('needs_revision', 'in_production', 'editor')).toBe(true)
  })

  it('blocks skipping steps and all viewer changes', () => {
    expect(canTransition('planned', 'published', 'admin')).toBe(false)
    expect(canTransition('planned', 'approved', 'admin')).toBe(false)
    for (const to of CONTENT_STATUSES) expect(canTransition('planned', to, 'viewer')).toBe(false)
  })

  it('treats reopening as an explicit, role-limited action', () => {
    expect(isReopen('published', 'approved')).toBe(true)
    expect(canTransition('published', 'approved', 'editor')).toBe(false)
    expect(canTransition('published', 'approved', 'admin')).toBe(true)
    expect(canTransition('cancelled', 'planned', 'editor')).toBe(true)
    expect(nextStatuses('published', 'editor')).toEqual([])
  })
})

describe('filters', () => {
  const items = [
    makeItem({ brand_id: 'b1', format_id: 'f1', pillar_id: 'p1', status: 'planned', assigned_to: 'u1' }),
    makeItem({ brand_id: 'b2', format_id: 'f2', pillar_id: null, status: 'approved', assigned_to: null }),
  ]

  it('filters format and pillar independently', () => {
    expect(applyFilters(items, { ...EMPTY_FILTERS, formatIds: ['f2'] })).toHaveLength(1)
    expect(applyFilters(items, { ...EMPTY_FILTERS, pillarIds: ['p1'] })).toHaveLength(1)
    expect(applyFilters(items, { ...EMPTY_FILTERS, formatIds: ['f2'], pillarIds: ['p1'] })).toHaveLength(0)
  })

  it('supports unassigned and status filters', () => {
    expect(applyFilters(items, { ...EMPTY_FILTERS, assigneeIds: [UNASSIGNED] }).map((i) => i.brand_id)).toEqual(['b2'])
    expect(applyFilters(items, { ...EMPTY_FILTERS, statuses: ['planned'] }).map((i) => i.brand_id)).toEqual(['b1'])
  })

  it('round-trips through the URL and rejects unsafe values', () => {
    const params = filtersToParams({ ...EMPTY_FILTERS, brandIds: ['b1', 'b2'], statuses: ['approved'] }, new URLSearchParams('view=week'))
    expect(params.get('view')).toBe('week')
    expect(filtersFromParams(params)).toEqual({ ...EMPTY_FILTERS, brandIds: ['b1', 'b2'], statuses: ['approved'] })
    const evil = filtersFromParams(new URLSearchParams('brand=a),or(1.eq.1&status=hacked,planned'))
    expect(evil.brandIds).toEqual([])
    expect(evil.statuses).toEqual(['planned'])
  })
})

describe('dates and timezones', () => {
  it('computes "today" in the workspace timezone, not the device timezone', () => {
    const instant = new Date('2026-11-05T17:30:00Z')
    expect(todayInTimeZone('Asia/Manila', instant)).toBe('2026-11-06')
    expect(todayInTimeZone('America/New_York', instant)).toBe('2026-11-05')
  })

  it('builds full-week month grids starting on Sunday', () => {
    const days = monthGridDays(2026, 11)
    expect(days[0]).toBe('2026-11-01')
    expect(days.length % 7).toBe(0)
    expect(days.at(-1)).toBe('2026-12-05')
    expect(periodDays('2026-11-11', 14)).toHaveLength(14)
    expect(periodDays('2026-11-11', 7)[0]).toBe('2026-11-08')
  })

  it('handles month and day arithmetic without timezone drift', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 })
    expect(formatTime('14:05:00')).toBe('2:05 PM')
    expect(formatTime('00:30')).toBe('12:30 AM')
  })

  it('converts publication times between wall clock and timestamps', () => {
    const ts = zonedInputToTimestamp('2026-11-05T09:30', 'Asia/Manila')!
    expect(new Date(ts).toISOString()).toBe('2026-11-05T01:30:00.000Z')
    expect(timestampToZonedInput('2026-11-05T01:30:00Z', 'Asia/Manila')).toBe('2026-11-05T09:30')
    expect(zonedInputToTimestamp('nonsense', 'Asia/Manila')).toBeNull()
  })
})

describe('optimistic updates', () => {
  it('patches every cached copy and restores them exactly on failure', async () => {
    const qc = new QueryClient()
    const item = makeItem({ id: 'abc', scheduled_date: '2026-11-05' })
    const other = makeItem({ id: 'def' })
    qc.setQueryData(['ws', 'w', 'content', 'range', 'a'], [item, other])
    qc.setQueryData(['ws', 'w', 'content', 'item', 'abc'], item)
    qc.setQueryData(['ws', 'w', 'content', 'library', {}], { rows: [item], count: 1 })
    qc.setQueryData(['ws', 'w', 'brands'], ['untouched'])

    const restore = await optimisticallyPatchContent(qc, ['ws', 'w', 'content'], 'abc', { scheduled_date: '2026-11-09' })
    expect(qc.getQueryData<typeof item[]>(['ws', 'w', 'content', 'range', 'a'])![0].scheduled_date).toBe('2026-11-09')
    expect(qc.getQueryData<typeof item[]>(['ws', 'w', 'content', 'range', 'a'])![1]).toBe(other)
    expect(qc.getQueryData<typeof item>(['ws', 'w', 'content', 'item', 'abc'])!.scheduled_date).toBe('2026-11-09')
    expect(qc.getQueryData<{ rows: typeof item[] }>(['ws', 'w', 'content', 'library', {}])!.rows[0].scheduled_date).toBe('2026-11-09')

    restore()
    expect(qc.getQueryData<typeof item[]>(['ws', 'w', 'content', 'range', 'a'])![0].scheduled_date).toBe('2026-11-05')
    expect(qc.getQueryData<typeof item>(['ws', 'w', 'content', 'item', 'abc'])).toEqual(item)
    expect(qc.getQueryData(['ws', 'w', 'brands'])).toEqual(['untouched'])
  })
})

describe('error messages', () => {
  it('passes through deliberate database messages', () => {
    expect(friendlyError({ code: 'P0001', message: 'Status cannot change from Planned to Published.' })).toBe(
      'Status cannot change from Planned to Published.',
    )
  })

  it('never leaks SQL or policy internals', () => {
    const rls = friendlyError({ code: '42501', message: 'new row violates row-level security policy for table "content_items"' })
    expect(rls).toBe('You don’t have permission to do that.')
    const unique = friendlyError({ code: '23505', message: 'duplicate key value violates unique constraint "monthly_plans_one_per_brand_month"' })
    expect(unique).toBe('A plan already exists for this brand and month.')
    const random = friendlyError({ code: 'XX000', message: 'internal error at pg_foo.c:123 SELECT * FROM secrets' })
    expect(random).toBe('Something went wrong. Please try again.')
    expect(friendlyError({ name: 'AuthApiError', message: 'Invalid login credentials', status: 400 })).toBe('Email or password is incorrect.')
    expect(friendlyError({ name: 'AuthApiError', code: 'email_provider_disabled', message: 'Email logins are disabled', status: 422 })).toMatch(/enable the Email provider/)
  })
})

describe('validation', () => {
  it('normalises hashtags', () => {
    expect(parseHashtags('#one two, #one  three')).toEqual(['#one', '#two', '#three'])
  })

  it('enforces the password policy', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false)
    expect(passwordSchema.safeParse('alllowercase123').success).toBe(false)
    expect(passwordSchema.safeParse('Sup3rSecurePassword').success).toBe(true)
  })

  it('allows a post without a caption or date but validates URLs and time', () => {
    const base = {
      title: 'Idea',
      brand_id: 'b',
      platforms: [],
      format_id: 'f',
      pillar_id: '__none',
      scheduled_date: '',
      scheduled_time: '',
      caption: '',
      hashtags: '',
      call_to_action: '',
      purpose: '',
      target_audience: '',
      creative_brief: '',
      reference_urls: [],
      assigned_to: '__none',
      deadline_date: '',
      status: 'planned' as const,
      internal_notes: '',
      published_at: '',
      published_url: '',
      publication_notes: '',
    }
    const ok = contentFormSchema.safeParse(base)
    expect(ok.success).toBe(true)
    expect(ok.data?.caption).toBeNull()
    expect(contentFormSchema.safeParse({ ...base, published_url: 'javascript:alert(1)' }).success).toBe(false)
    expect(contentFormSchema.safeParse({ ...base, reference_urls: [{ value: 'ftp://x' }] }).success).toBe(false)
    expect(contentFormSchema.safeParse({ ...base, scheduled_time: '10:00' }).success).toBe(false)
  })
})

describe('permissions (UI layer)', () => {
  it('mirrors the database editing rules', () => {
    const item = { created_by: 'a', assigned_to: 'b' }
    expect(canEditContent('viewer', { editors_can_edit_all: true }, item, 'x')).toBe(false)
    expect(canEditContent('editor', { editors_can_edit_all: false }, item, 'x')).toBe(false)
    expect(canEditContent('editor', { editors_can_edit_all: false }, item, 'b')).toBe(true)
    expect(canEditContent('admin', { editors_can_edit_all: false }, item, 'x')).toBe(true)
    // Owner rule: editors edit only what is assigned to them, whatever the old workspace flag says.
    expect(canEditContent('editor', { editors_can_edit_all: true }, item, 'x')).toBe(false)
    expect(canEditContent('editor', { editors_can_edit_all: true }, item, 'a')).toBe(false)
    expect(can('editor', 'team.manage')).toBe(false)
    expect(can('editor', 'content.assign')).toBe(false)
    expect(can('admin', 'content.assign')).toBe(true)
    expect(can('viewer', 'export')).toBe(true)
  })
})

describe('misc safety helpers', () => {
  it('only allows same-origin redirect targets', () => {
    expect(safeNext('/calendar?view=week')).toBe('/calendar?view=week')
    expect(safeNext('https://evil.example')).toBe('/')
    expect(safeNext('//evil.example')).toBe('/')
    expect(safeNext('/\\evil.example')).toBe('/')
  })

  it('validates uploads and sanitises storage names', () => {
    expect(validateUpload({ name: 'a.svg', type: 'image/svg+xml', size: 10 })).toMatch(/isn’t allowed/)
    expect(validateUpload({ name: 'a.mp4', type: 'video/mp4', size: 60 * 1024 * 1024 })).toMatch(/50 MB/)
    expect(validateUpload({ name: 'a.png', type: 'image/png', size: 1000 })).toBeNull()
    expect(storageSafeName('../../etc/pass wd?.png')).toBe('etc-pass-wd-.png')
    expect(storageSafeName('...')).toBe('file')
  })

  it('escapes search wildcards', () => {
    expect(escapeLike('50%_off*')).toBe('50\\%\\_off ')
  })

  it('strips characters the PDF fonts cannot render', () => {
    expect(pdfText('Hello 👋 “world” — ñ')).toBe('Hello  “world” — ñ')
    expect(exportFileName({ title: 'Kape Kultura Café', year: 2026, month: 11, options: { mode: 'calendar' } as never })).toBe(
      'kape-kultura-caf-2026-11-calendar.pdf',
    )
  })
})

describe('editor saves', () => {
  it('sends only changed fields, keeping time in step with date', () => {
    const payload = { title: 'T', caption: 'C', published_at: '2026-11-05T01:30:00.000Z', scheduled_date: null, scheduled_time: null, reference_urls: ['https://a.example'] }
    expect(pickChanged(payload, { caption: true })).toEqual({ caption: 'C' })
    expect(pickChanged(payload, { scheduled_date: true })).toEqual({ scheduled_date: null, scheduled_time: null })
    expect(pickChanged(payload, { reference_urls: [{ value: true }] })).toEqual({ reference_urls: ['https://a.example'] })
    expect(pickChanged(payload, { reference_urls: [{ value: false }] })).toEqual({})
  })
})
