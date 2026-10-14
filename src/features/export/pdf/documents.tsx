import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { STATUS_LABEL, CONTENT_STATUSES } from '@/lib/status'
import { WEEKDAY_LABELS, formatDate, formatTime, isWeekend } from '@/lib/dates'
import type { ContentItem } from '@/types/database'
import { pdfText, type ExportData } from '../exportData'

const INK = '#121a1c'
const MUTED = '#5b686b'
const LINE = '#dde3e3'
const TEAL = '#0f5257'
const WEEKEND = '#f3f5f5'
const OUTSIDE = '#eceff0'

// Fixed layout metrics (points) so the calendar page never overflows.
const PAD_TOP = 28
const PAD_BOTTOM = 34
const HEADER_H = 46
const HEADER_GAP = 8
const WEEKDAY_H = 14
const SUMMARY_LINE = 10.5

const s = StyleSheet.create({
  page: { paddingTop: PAD_TOP, paddingBottom: PAD_BOTTOM, paddingHorizontal: 28, fontFamily: 'Helvetica', fontSize: 8.5, color: INK },
  header: { height: HEADER_H, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderBottomWidth: 2, borderBottomColor: TEAL, paddingBottom: 6, marginBottom: HEADER_GAP },
  brand: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: INK, maxLines: 1, textOverflow: 'ellipsis' },
  subtitle: { fontSize: 10, color: TEAL, marginTop: 2, fontFamily: 'Helvetica-Bold' },
  meta: { fontSize: 7.5, color: MUTED, textAlign: 'right' },
  footer: { position: 'absolute', bottom: 14, left: 28, right: 28, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: MUTED },
  sectionTitle: { height: 15, paddingTop: 5, fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6 },
  row: { height: SUMMARY_LINE, flexDirection: 'row', alignItems: 'center' },
  swatch: { width: 7, height: 7, borderRadius: 1.5, marginRight: 5 },
  ring: { width: 7, height: 7, borderRadius: 3.5, borderWidth: 1.6, marginRight: 5 },
  grow: { flexGrow: 1, flexShrink: 1 },
  num: { fontFamily: 'Helvetica-Bold' },
})

function Footer({ data }: { data: ExportData }) {
  return (
    <View style={s.footer} fixed>
      <Text>
        {pdfText(data.workspace.name)} · Generated {data.generatedAt} ({data.workspace.timezone})
      </Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  )
}

function Header({ data }: { data: ExportData }) {
  return (
    <View style={s.header} fixed>
      <View style={{ flexShrink: 1, marginRight: 12 }}>
        <Text style={s.brand}>{pdfText(data.title)}</Text>
        <Text style={s.subtitle}>{data.subtitle}</Text>
      </View>
      <Text style={s.meta}>
        {data.summary.plannedTotal} planned posts{'\n'}
        {data.summary.publishedTotal} published · {data.summary.approvedAwaitingPublication} approved
      </Text>
    </View>
  )
}

function SummaryColumn({ data, height }: { data: ExportData; height: number }) {
  const { summary } = data
  const pillars = summary.byPillar.filter((p) => p.count > 0)
  const statuses = CONTENT_STATUSES.filter((st) => summary.byStatus[st] > 0)
  // Everything above "Key dates" has a known height; key dates get what is left.
  const used = 4 * 15 + (summary.byFormat.length + 1 + pillars.length + statuses.length) * SUMMARY_LINE
  const keyRoom = Math.max(1, Math.floor((height - used) / SUMMARY_LINE))
  const keyDates = data.keyDates.length > keyRoom ? data.keyDates.slice(0, keyRoom - 1) : data.keyDates
  const hiddenKeys = data.keyDates.length - keyDates.length
  return (
    <View style={{ width: 150, marginLeft: 12, height, overflow: 'hidden' }}>
      <Text style={[s.sectionTitle, { paddingTop: 0 }]}>Formats</Text>
      {summary.byFormat.map((f) => (
        <View key={f.id ?? 'none'} style={s.row}>
          <View style={[s.swatch, { backgroundColor: f.color }]} />
          <Text style={s.grow}>{pdfText(f.name)}</Text>
          <Text style={s.num}>{f.count}</Text>
        </View>
      ))}
      <View style={[s.row, { borderTopWidth: 0.6, borderTopColor: LINE }]}>
        <Text style={[s.grow, s.num]}>Total planned</Text>
        <Text style={s.num}>{summary.plannedTotal}</Text>
      </View>

      <Text style={s.sectionTitle}>Content pillars</Text>
      {pillars.map((p) => (
        <View key={p.id ?? 'none'} style={s.row}>
          <View style={[s.ring, { borderColor: p.color }]} />
          <Text style={s.grow}>{pdfText(p.name)}</Text>
          <Text style={s.num}>{p.count}</Text>
        </View>
      ))}

      <Text style={s.sectionTitle}>Status</Text>
      {statuses.map((st) => (
        <View key={st} style={s.row}>
          <Text style={s.grow}>{STATUS_LABEL[st]}</Text>
          <Text style={s.num}>{summary.byStatus[st]}</Text>
        </View>
      ))}

      <Text style={s.sectionTitle}>Key dates</Text>
      {data.keyDates.length === 0 && <Text style={{ color: MUTED }}>None this month</Text>}
      {keyDates.map((k) => (
        <View key={k.id} style={s.row}>
          <Text style={{ width: 30, color: MUTED }}>{formatDate(k.date, 'd MMM')}</Text>
          <Text style={[s.grow, { maxLines: 1, textOverflow: 'ellipsis' }]}>{pdfText(k.name)}</Text>
        </View>
      ))}
      {hiddenKeys > 0 && <Text style={{ color: MUTED }}>+{hiddenKeys} more</Text>}
    </View>
  )
}

/** Landscape month grid + summary, the direct replacement for the Canva calendar. */
export function CalendarDocument({ data }: { data: ExportData }) {
  const weeks: string[][] = []
  for (let i = 0; i < data.gridDays.length; i += 7) weeks.push(data.gridDays.slice(i, i + 7))
  const monthPrefix = `${data.year}-${String(data.month).padStart(2, '0')}`
  const byDay = new Map<string, ContentItem[]>()
  for (const item of data.items) byDay.set(item.scheduled_date!, [...(byDay.get(item.scheduled_date!) ?? []), item])
  const keyByDay = new Map<string, string[]>()
  for (const k of data.keyDates) keyByDay.set(k.date, [...(keyByDay.get(k.date) ?? []), k.name])
  const formatById = new Map(data.formats.map((f) => [f.id, f]))

  // A4 landscape is 595.28pt tall. Row heights are fixed so the grid always
  // fits one page; days with more posts than fit show "+N more".
  const bodyHeight = 595.28 - PAD_TOP - PAD_BOTTOM - HEADER_H - HEADER_GAP - 4
  const rowHeight = (bodyHeight - WEEKDAY_H) / weeks.length
  const maxLines = Math.max(1, Math.floor((rowHeight - 6 - 11) / 10))

  return (
    <Document title={`${data.title} — ${data.subtitle}`} author={data.workspace.name} creator="Joyno Media Content Studio">
      <Page size="A4" orientation="landscape" style={s.page}>
        <Header data={data} />
        <View style={{ flexDirection: 'row', height: bodyHeight }} wrap={false}>
          <View style={{ flexGrow: 1, flexShrink: 1 }}>
            <View style={{ flexDirection: 'row', height: WEEKDAY_H, borderBottomWidth: 0.6, borderBottomColor: LINE }}>
              {WEEKDAY_LABELS.map((d) => (
                <Text key={d} style={{ flex: 1, fontSize: 7, fontFamily: 'Helvetica-Bold', color: MUTED, paddingTop: 3, paddingHorizontal: 3, textTransform: 'uppercase' }}>
                  {d}
                </Text>
              ))}
            </View>
            {weeks.map((week) => (
              <View key={week[0]} style={{ flexDirection: 'row', height: rowHeight, borderBottomWidth: 0.6, borderBottomColor: LINE }}>
                {week.map((day, i) => {
                  const outside = !day.startsWith(monthPrefix)
                  const items = outside ? [] : byDay.get(day) ?? []
                  const keys = outside ? [] : keyByDay.get(day) ?? []
                  const room = Math.max(0, maxLines - keys.length)
                  const visible = items.length > room ? items.slice(0, Math.max(0, room - 1)) : items
                  const hidden = items.length - visible.length
                  return (
                    <View
                      key={day}
                      style={{
                        flex: 1,
                        padding: 3,
                        borderRightWidth: i < 6 ? 0.6 : 0,
                        borderRightColor: LINE,
                        backgroundColor: outside ? OUTSIDE : isWeekend(day) ? WEEKEND : '#ffffff',
                        overflow: 'hidden',
                      }}
                    >
                      <Text style={{ fontSize: 8, height: 11, fontFamily: 'Helvetica-Bold', color: outside ? '#a3adb0' : INK }}>{formatDate(day, 'd')}</Text>
                      {keys.map((k) => (
                        <Text key={k} style={{ fontSize: 6.5, height: 10, color: '#9f1239', fontFamily: 'Helvetica-Bold', maxLines: 1, textOverflow: 'ellipsis' }}>
                          {pdfText(k)}
                        </Text>
                      ))}
                      {visible.map((item) => {
                        const format = formatById.get(item.format_id)
                        return (
                          <View key={item.id} style={{ flexDirection: 'row', alignItems: 'flex-start', height: 10, paddingTop: 1.5 }}>
                            <View style={{ width: 2.5, height: 8, backgroundColor: format?.color ?? LINE, marginRight: 2.5, marginTop: 0.5 }} />
                            <Text style={{ fontSize: 7, flexShrink: 1, maxLines: 1, textOverflow: 'ellipsis', textDecoration: item.status === 'cancelled' ? 'line-through' : 'none' }}>
                              {pdfText(item.title)}
                            </Text>
                          </View>
                        )
                      })}
                      {hidden > 0 && <Text style={{ fontSize: 6.5, height: 10, paddingTop: 1.5, color: MUTED }}>+{hidden} more</Text>}
                    </View>
                  )
                })}
              </View>
            ))}
          </View>
          <SummaryColumn data={data} height={bodyHeight} />
        </View>
        <Footer data={data} />
      </Page>
    </Document>
  )
}

function Labelled({ label, children }: { label: string; children: string }) {
  if (!children) return null
  return (
    <View style={{ marginTop: 5 }}>
      <Text style={{ fontSize: 7, fontFamily: 'Helvetica-Bold', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 1.5 }}>{label}</Text>
      <Text style={{ fontSize: 9, lineHeight: 1.4 }}>{children}</Text>
    </View>
  )
}

/** Portrait, one block per post with full copy; long captions paginate. */
export function DetailedDocument({ data }: { data: ExportData }) {
  const formatById = new Map(data.formats.map((f) => [f.id, f]))
  const pillarById = new Map(data.pillars.map((p) => [p.id, p]))
  const brandById = new Map(data.brands.map((b) => [b.id, b]))
  const multiBrand = data.options.brandIds.length !== 1
  return (
    <Document title={`${data.title} — ${data.subtitle}`} author={data.workspace.name} creator="Joyno Media Content Studio">
      <Page size="A4" style={s.page}>
        <Header data={data} />
        {data.items.length === 0 && <Text style={{ color: MUTED, marginTop: 20 }}>No scheduled content for this month.</Text>}
        {data.items.map((item) => {
          const format = formatById.get(item.format_id)
          const pillar = item.pillar_id ? pillarById.get(item.pillar_id) : null
          return (
            <View key={item.id} style={{ borderBottomWidth: 0.6, borderBottomColor: LINE, paddingVertical: 8 }} wrap>
              <View minPresenceAhead={60} style={{ flexDirection: 'row' }}>
                <View style={{ width: 70 }}>
                  <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 9 }}>{formatDate(item.scheduled_date, 'EEE d MMM')}</Text>
                  {item.scheduled_time && <Text style={{ color: MUTED }}>{formatTime(item.scheduled_time)}</Text>}
                </View>
                <View style={s.grow}>
                  <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 11, textDecoration: item.status === 'cancelled' ? 'line-through' : 'none' }}>{pdfText(item.title)}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 3, alignItems: 'center' }}>
                    {format && (
                      <View style={[s.row, { marginRight: 10, marginBottom: 0 }]}>
                        <View style={[s.swatch, { backgroundColor: format.color }]} />
                        <Text>{pdfText(format.name)}</Text>
                      </View>
                    )}
                    {pillar && (
                      <View style={[s.row, { marginRight: 10, marginBottom: 0 }]}>
                        <View style={[s.ring, { borderColor: pillar.color }]} />
                        <Text style={{ color: pillar.color }}>{pdfText(pillar.name)}</Text>
                      </View>
                    )}
                    <Text style={{ color: MUTED, marginRight: 10 }}>{STATUS_LABEL[item.status]}</Text>
                    {multiBrand && <Text style={{ color: MUTED, marginRight: 10 }}>{pdfText(brandById.get(item.brand_id)?.name)}</Text>}
                    {item.platforms.length > 0 && <Text style={{ color: MUTED }}>{item.platforms.join(', ')}</Text>}
                  </View>
                </View>
              </View>
              <View style={{ marginLeft: 70 }}>
                <Labelled label="Purpose / theme">{pdfText(item.purpose)}</Labelled>
                <Labelled label="Caption">{pdfText(item.caption) || '—'}</Labelled>
                <Labelled label="Hashtags">{pdfText(item.hashtags.join(' '))}</Labelled>
                <Labelled label="Call to action">{pdfText(item.call_to_action)}</Labelled>
                {data.options.includeNotes && <Labelled label="Internal notes">{pdfText(item.internal_notes)}</Labelled>}
              </View>
            </View>
          )
        })}
        <Footer data={data} />
      </Page>
    </Document>
  )
}
