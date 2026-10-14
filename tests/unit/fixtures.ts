import type { ConfigItem, ContentItem } from '@/types/database'

let seq = 0

export function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  seq += 1
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    workspace_id: 'ws-1',
    monthly_plan_id: null,
    brand_id: 'brand-1',
    title: `Post ${seq}`,
    platforms: ['Facebook'],
    format_id: 'fmt-carousel',
    pillar_id: 'pil-strategy',
    caption: null,
    hashtags: [],
    call_to_action: null,
    purpose: null,
    target_audience: null,
    creative_brief: null,
    reference_urls: [],
    scheduled_date: '2026-11-10',
    scheduled_time: null,
    deadline_date: null,
    status: 'planned',
    assigned_to: null,
    internal_notes: null,
    approved_at: null,
    approved_by: null,
    published_at: null,
    published_url: null,
    publication_notes: null,
    source_item_id: null,
    search_text: '',
    is_demo: false,
    created_by: 'user-1',
    updated_by: 'user-1',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    deleted_at: null,
    deleted_by: null,
    ...overrides,
  }
}

export function makeConfig(id: string, name: string, color: string, sort = 0): ConfigItem {
  return { id, workspace_id: 'ws-1', name, color, sort_order: sort, is_active: true, created_at: '', updated_at: '' }
}

export const FORMATS = [
  makeConfig('fmt-carousel', 'Carousel', '#0e7490', 10),
  makeConfig('fmt-reel', 'Reel', '#c2410c', 20),
  makeConfig('fmt-static', 'Static Post', '#7c3aed', 30),
]

export const PILLARS = [makeConfig('pil-strategy', 'Strategy', '#1e40af', 10), makeConfig('pil-growth', 'Growth', '#3f6212', 20)]
