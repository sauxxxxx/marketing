import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Download, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Field } from '@/components/common/Field'
import { Spinner } from '@/components/common/states'
import { useActiveWorkspace } from '@/features/workspace/WorkspaceProvider'
import { useLookups } from '@/hooks/useWorkspaceData'
import { friendlyError } from '@/lib/errors'
import { monthKey } from '@/lib/dates'
import { exportFileName, loadExportData, type ExportMode, type ExportOptions } from './exportData'

const ALL = '__all'

export function printUrl(options: Pick<ExportOptions, 'year' | 'month' | 'brandIds' | 'mode' | 'includeNotes' | 'includeCancelled'>): string {
  const params = new URLSearchParams({ month: monthKey(options.year, options.month), mode: options.mode })
  if (options.brandIds.length) params.set('brand', options.brandIds.join(','))
  if (options.includeNotes) params.set('notes', '1')
  if (options.includeCancelled) params.set('cancelled', '1')
  return `/print?${params}`
}

export function ExportDialog({
  open,
  onOpenChange,
  year,
  month,
  brandIds,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  year: number
  month: number
  brandIds: string[]
}) {
  const { workspace, today } = useActiveWorkspace()
  const lookups = useLookups()
  const [period, setPeriod] = useState(monthKey(year, month))
  const [brand, setBrand] = useState<string>(brandIds.length === 1 ? brandIds[0] : ALL)
  const [mode, setMode] = useState<ExportMode>('calendar')
  const [includeNotes, setIncludeNotes] = useState(false)
  const [includeCancelled, setIncludeCancelled] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setPeriod(monthKey(year, month))
      setBrand(brandIds.length === 1 ? brandIds[0] : ALL)
    }
  }, [open, year, month, brandIds])

  const [py, pm] = period.split('-').map(Number)
  const options: ExportOptions = {
    year: py,
    month: pm,
    brandIds: brand === ALL ? [] : [brand],
    mode,
    includeNotes: mode === 'detailed' && includeNotes,
    includeCancelled,
  }

  const generate = async () => {
    if (!py || !pm) return
    setBusy(true)
    try {
      const data = await loadExportData({ workspace, options, formats: lookups.formats, pillars: lookups.pillars, brands: lookups.brands, today })
      const [{ pdf }, docs] = await Promise.all([import('@react-pdf/renderer'), import('./pdf/documents')])
      const element = mode === 'calendar' ? <docs.CalendarDocument data={data} /> : <docs.DetailedDocument data={data} />
      const blob = await pdf(element).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = exportFileName(data)
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      toast.success('PDF ready.')
      onOpenChange(false)
    } catch (error) {
      toast.error(friendlyError(error, 'The PDF could not be generated.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export PDF</DialogTitle>
          <DialogDescription>Generated from live data. Only members of this workspace can create exports.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Month">
              <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} required />
            </Field>
            <Field label="Brand">
              <Select value={brand} onValueChange={setBrand}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All brands</SelectItem>
                  {lookups.brands.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-xs font-medium text-foreground/80">Layout</legend>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['calendar', 'Calendar overview', 'Landscape grid, legend, summary and key dates'],
                  ['detailed', 'Detailed plan', 'Every post with caption, hashtags and CTA'],
                ] as const
              ).map(([value, title, hint]) => (
                <label
                  key={value}
                  className="flex cursor-pointer flex-col gap-0.5 rounded-md border p-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                >
                  <input type="radio" name="export-mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="sr-only" />
                  <span className="font-medium">{title}</span>
                  <span className="text-xs text-muted-foreground">{hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-col gap-2">
            {mode === 'detailed' && (
              <div className="flex items-center gap-2">
                <Checkbox id="export-notes" checked={includeNotes} onCheckedChange={(v) => setIncludeNotes(v === true)} />
                <Label htmlFor="export-notes" className="font-normal">
                  Include internal notes
                </Label>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Checkbox id="export-cancelled" checked={includeCancelled} onCheckedChange={(v) => setIncludeCancelled(v === true)} />
              <Label htmlFor="export-cancelled" className="font-normal">
                Show cancelled posts (never counted in totals)
              </Label>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" asChild>
            <Link to={printUrl(options)} target="_blank" rel="noopener">
              <ExternalLink /> Printable view
            </Link>
          </Button>
          <Button onClick={generate} disabled={busy || lookups.loading}>
            {busy ? <Spinner className="[&_svg]:text-current" /> : <Download />}
            Download PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
