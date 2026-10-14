// Shared HTTP helpers for Edge Functions. No runtime-specific imports, so
// these modules can be unit-tested under Node as well as run on Deno.

export interface HttpContext {
  allowedOrigins: string[]
}

export function corsHeaders(request: Request, ctx: HttpContext): Record<string, string> {
  const origin = request.headers.get('Origin') ?? ''
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
  if (origin && ctx.allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

export function json(request: Request, ctx: HttpContext, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request, ctx),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

/** Common request gate: CORS preflight, origin allow-list, method and JSON body. */
export async function readJsonRequest(
  request: Request,
  ctx: HttpContext,
): Promise<{ response: Response } | { body: Record<string, unknown> }> {
  if (request.method === 'OPTIONS') {
    return { response: new Response(null, { status: 204, headers: corsHeaders(request, ctx) }) }
  }
  const origin = request.headers.get('Origin')
  if (origin && !ctx.allowedOrigins.includes(origin)) {
    return { response: json(request, ctx, 403, { error: 'origin_not_allowed', message: 'This origin is not allowed.' }) }
  }
  if (request.method !== 'POST') {
    return { response: json(request, ctx, 405, { error: 'method_not_allowed', message: 'Use POST.' }) }
  }
  const text = await request.text()
  if (text.length > 16_384) {
    return { response: json(request, ctx, 413, { error: 'payload_too_large', message: 'Request is too large.' }) }
  }
  try {
    const body = JSON.parse(text)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object')
    return { body: body as Record<string, unknown> }
  } catch {
    return { response: json(request, ctx, 400, { error: 'invalid_json', message: 'Send a JSON object.' }) }
  }
}

export function parseOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

const encoder = new TextEncoder()

/** Constant-time string comparison (compares SHA-256 digests). */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ])
  const va = new Uint8Array(da)
  const vb = new Uint8Array(db)
  let diff = a.length === b.length ? 0 : 1
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i]
  return diff === 0
}

export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function normaliseEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null
}

export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim().replace(/\s+/g, ' ')
  return text.length >= 1 && text.length <= max ? text : null
}
