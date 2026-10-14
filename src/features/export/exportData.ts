import { requireSupabase } from '@/lib/supabase'
import { CONTENT_COLUMNS } from '@/hooks/useContent'
import { computeSummary, type MonthlySummary } from '@/lib/summary'
import { monthGridDays, monthRange } from '@/lib/dates'
import type { Brand, ConfigItem, ContentItem, KeyDate, Workspace } from '@/types/database'

export type ExportMode = 'calendar' | 'detailed'

export interface ExportOptions {
  year: number
  month: number
  /** Empty = all brands. */
  brandIds: string[]
  mode: ExportMode
  includeNotes: boolean
  includeCancelled: boolean
}

export interface ExportData {
  workspace: Pick<Workspace, 'name' | 'timezone'>
  title: string
  subtitle: string
  year: number
  month: number
  items: ContentItem[]
  keyDates: KeyDate[]
  formats: ConfigItem[]
  pillars: ConfigItem[]
  brands: Brand[]
  summary: MonthlySummary
  gridDays: string[]
  options: ExportOptions
  generatedAt: string
}

/** Loads exactly the records shown in the export, from the database. */
export async function loadExportData(input: {
  workspace: Pick<Workspace, 'id' | 'name' | 'timezone'>
  options: ExportOptions
  formats: ConfigItem[]
  pillars: ConfigItem[]
  brands: Brand[]
  today: string
}): Promise<ExportData> {
  const { workspace, options } = input
  const { from, to } = monthRange(options.year, options.month)
  const client = requireSupabase()

  let query = client
    .from('content_items')
    .select(CONTENT_COLUMNS)
    .eq('workspace_id', workspace.id)
    .is('deleted_at', null)
    .gte('scheduled_date', from)
    .lte('scheduled_date', to)
    .order('scheduled_date')
    .order('scheduled_time', { nullsFirst: true })
    .order('created_at')
  if (options.brandIds.length) query = query.in('brand_id', options.brandIds)
  const [{ data: items, error }, { data: keyDates, error: kdError }] = await Promise.all([
    query,
    client.from('key_dates').select('*').eq('workspace_id', workspace.id).gte('date', from).lte('date', to).order('date'),
  ])
  if (error) throw error
  if (kdError) throw kdError

  const all = (items ?? []) as unknown as ContentItem[]
  const shown = options.includeCancelled ? all : all.filter((i) => i.status !== 'cancelled')
  const selectedBrands = input.brands.filter((b) => options.brandIds.includes(b.id))
  const title = selectedBrands.length === 1 ? selectedBrands[0].name : selectedBrands.length > 1 ? selectedBrands.map((b) => b.name).join(', ') : workspace.name
  const monthLabel = new Date(options.year, options.month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })

  return {
    workspace: { name: workspace.name, timezone: workspace.timezone },
    title,
    subtitle: `${options.mode === 'calendar' ? 'Content Calendar' : 'Detailed Content Plan'} · ${monthLabel}`,
    year: options.year,
    month: options.month,
    items: shown,
    keyDates: (keyDates ?? []) as KeyDate[],
    formats: input.formats,
    pillars: input.pillars,
    brands: input.brands,
    // Summary always follows the standard counting rules (cancelled never counted).
    summary: computeSummary({ items: all, from, to, today: input.today, formats: input.formats, pillars: input.pillars }),
    gridDays: monthGridDays(options.year, options.month),
    options,
    generatedAt: new Intl.DateTimeFormat('en-PH', { timeZone: workspace.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date()),
  }
}

/**
 * The built-in PDF fonts (Helvetica) only cover Latin-1 plus common
 * typography. Characters outside that (e.g. emoji) are removed rather than
 * rendered as broken glyphs.
 */
export function pdfText(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[^\n\t\x20-\x7E\xA0-\xFF‘’“”–—…•€™]/gu, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

export function exportFileName(data: Pick<ExportData, 'title' | 'year' | 'month' | 'options'>): string {
  const slug = data.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return `${slug || 'content'}-${data.year}-${String(data.month).padStart(2, '0')}-${data.options.mode === 'calendar' ? 'calendar' : 'plan'}.pdf`
}
