import { z } from 'zod'
import { CONTENT_STATUSES } from './status'
import { PLATFORMS } from './constants'

/** Mirrors the server policy in supabase/functions/bootstrap/handler.ts and config.toml. */
export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters.')
  .max(72, 'Use at most 72 characters.')
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), 'Include upper-case and lower-case letters and a number.')

export const emailSchema = z.string().trim().toLowerCase().min(1, 'Enter your email address.').pipe(z.email('Enter a valid email address.'))

export const newPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords don’t match.' })

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
  remember: z.boolean(),
})

export const setupSchema = z
  .object({
    fullName: z.string().trim().min(1, 'Enter your full name.').max(120),
    email: emailSchema,
    workspaceName: z.string().trim().min(1, 'Enter a workspace name.').max(80),
    password: passwordSchema,
    confirm: z.string(),
    setupToken: z.string().trim().min(1, 'Enter the setup token from your deployment secrets.'),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords don’t match.' })

const optionalText = (max: number) =>
  z
    .string()
    .max(max, `Keep this under ${max.toLocaleString()} characters.`)
    .transform((v) => (v.trim() === '' ? null : v))

const httpUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(v), 'Enter a full URL starting with http:// or https://')

/** Parses "#one #two, three" into ["#one", "#two", "#three"]. */
export function parseHashtags(input: string): string[] {
  const tags = input
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.startsWith('#') ? t : `#${t}`))
    .filter((t) => t.length > 1)
  return [...new Set(tags)]
}

export const contentFormSchema = z
  .object({
    title: z.string().trim().min(1, 'Enter a title or topic.').max(200),
    brand_id: z.string().min(1, 'Choose a brand.'),
    platforms: z.array(z.enum(PLATFORMS)),
    format_id: z.string().min(1, 'Choose a format.'),
    pillar_id: z.string(),
    scheduled_date: z.string(),
    scheduled_time: z.string(),
    caption: optionalText(10000),
    hashtags: z.string().max(3000),
    call_to_action: optionalText(500),
    purpose: optionalText(1000),
    target_audience: optionalText(1000),
    creative_brief: optionalText(10000),
    reference_urls: z.array(z.object({ value: httpUrl })).max(20, 'Add at most 20 references.'),
    assigned_to: z.string(),
    deadline_date: z.string(),
    status: z.enum(CONTENT_STATUSES),
    internal_notes: optionalText(10000),
    published_at: z.string(),
    published_url: z.union([z.literal(''), httpUrl]),
    publication_notes: optionalText(5000),
  })
  .refine((v) => !v.scheduled_time || v.scheduled_date, {
    path: ['scheduled_time'],
    message: 'Choose a date before setting a time.',
  })
  .refine((v) => parseHashtags(v.hashtags).length <= 60, { path: ['hashtags'], message: 'Use at most 60 hashtags.' })

export type ContentFormInput = z.input<typeof contentFormSchema>
export type ContentFormValues = z.output<typeof contentFormSchema>

export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #0f5257.')
