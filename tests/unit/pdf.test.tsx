// @vitest-environment node
import { renderToBuffer } from '@react-pdf/renderer'
import { CalendarDocument, DetailedDocument } from '@/features/export/pdf/documents'
import { computeSummary } from '@/lib/summary'
import { monthGridDays } from '@/lib/dates'
import type { ExportData } from '@/features/export/exportData'
import { FORMATS, PILLARS, makeItem } from './fixtures'

function latin1(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return out
}

/** Reads the PDF Info /Title (an indirect object holding a literal string, UTF-16BE when non-ASCII). */
function pdfTitle(buffer: Uint8Array): string {
  const raw = latin1(buffer)
  const ref = /\/Title\s+(\d+)\s+0\s+R/.exec(raw)
  const objStart = ref ? raw.indexOf(`\n${ref[1]} 0 obj\n(`) : -1
  if (objStart < 0) return ''
  let i = raw.indexOf('(', objStart) + 1
  const bytes: number[] = []
  for (let depth = 1; i < raw.length; i++) {
    const ch = raw.charCodeAt(i)
    if (ch === 0x5c) {
      i++
      bytes.push(raw.charCodeAt(i))
      continue
    }
    if (ch === 0x28) depth++
    if (ch === 0x29 && --depth === 0) break
    bytes.push(ch)
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = ''
    for (let j = 2; j + 1 < bytes.length; j += 2) out += String.fromCharCode((bytes[j] << 8) | bytes[j + 1])
    return out
  }
  return String.fromCharCode(...bytes)
}

function pageCount(buffer: Uint8Array): number {
  return (latin1(buffer).match(/\/Type\s*\/Page(?!s)/g) ?? []).length
}

function data(items: ReturnType<typeof makeItem>[], mode: 'calendar' | 'detailed'): ExportData {
  return {
    workspace: { name: 'Joyno Media', timezone: 'Asia/Manila' },
    title: 'Kape Kultura',
    subtitle: `${mode === 'calendar' ? 'Content Calendar' : 'Detailed Content Plan'} · November 2026`,
    year: 2026,
    month: 11,
    items,
    keyDates: [{ id: 'k', workspace_id: 'w', date: '2026-11-30', name: 'Bonifacio Day', kind: 'holiday', region: 'PH', notes: null, is_demo: false, created_by: null, created_at: '', updated_at: '' }],
    formats: FORMATS,
    pillars: PILLARS,
    brands: [],
    summary: computeSummary({ items, from: '2026-11-01', to: '2026-11-30', today: '2026-11-12', formats: FORMATS, pillars: PILLARS }),
    gridDays: monthGridDays(2026, 11),
    options: { year: 2026, month: 11, brandIds: ['b'], mode, includeNotes: true, includeCancelled: false },
    generatedAt: '12 Nov 2026, 9:00 AM',
  }
}

describe('PDF export', () => {
  it('renders a one-page landscape calendar identified by brand and month', async () => {
    // Many posts on one day must not overflow the page.
    const items = [
      ...Array.from({ length: 12 }, (_, i) => makeItem({ title: `Busy day post ${i}`, scheduled_date: '2026-11-10' })),
      makeItem({ title: 'Emoji test 🎉', scheduled_date: '2026-11-20' }),
    ]
    const buffer = await renderToBuffer(<CalendarDocument data={data(items, 'calendar')} />)
    expect(latin1(buffer.subarray(0, 5))).toBe('%PDF-')
    expect(pageCount(buffer)).toBe(1)
    const title = pdfTitle(buffer)
    expect(title).toContain('Kape Kultura')
    expect(title).toContain('November 2026')
    // Landscape A4 MediaBox: 841.89 x 595.28
    expect(latin1(buffer)).toMatch(/\/MediaBox\s*\[0 0 841\.89\d* 595\.28\d*\]/)
  }, 30_000)

  it('paginates long captions in the detailed plan', async () => {
    const longCaption = Array.from({ length: 400 }, (_, i) => `Sentence ${i} of a very long caption that keeps going.`).join(' ')
    const items = [
      makeItem({ title: 'Long-form post', scheduled_date: '2026-11-03', caption: longCaption, hashtags: ['#joyno'], internal_notes: 'Check with client' }),
      makeItem({ title: 'Short post', scheduled_date: '2026-11-04', caption: 'Short.' }),
    ]
    const buffer = await renderToBuffer(<DetailedDocument data={data(items, 'detailed')} />)
    expect(pageCount(buffer)).toBeGreaterThan(1)
    expect(pdfTitle(buffer)).toContain('Detailed Content Plan')
    // Portrait A4
    expect(latin1(buffer)).toMatch(/\/MediaBox\s*\[0 0 595\.28\d* 841\.89\d*\]/)
  }, 30_000)
})
