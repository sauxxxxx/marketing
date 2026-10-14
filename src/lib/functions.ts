import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { requireSupabase } from './supabase'

export interface FunctionErrorBody {
  error?: string
  message?: string
  fieldErrors?: Record<string, string>
}

export class EdgeFunctionError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message)
  }
}

/** Invokes an Edge Function and normalises its JSON error responses. */
export async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireSupabase().functions.invoke<T>(name, { body })
  if (!error) return data as T
  if (error instanceof FunctionsHttpError) {
    let payload: FunctionErrorBody = {}
    try {
      payload = await (error.context as Response).json()
    } catch {
      // Non-JSON response; fall through to the generic message.
    }
    throw new EdgeFunctionError(payload.message ?? 'The request failed.', payload.error ?? 'error', payload.fieldErrors)
  }
  if (error instanceof FunctionsFetchError) {
    throw new EdgeFunctionError('Can’t reach the server. Check your connection and that the function is deployed.', 'network')
  }
  throw new EdgeFunctionError('The request failed.', 'error')
}
