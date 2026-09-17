import type { Context } from 'hono';
import type { z } from 'zod';
import { validationFailed } from './errors.js';
import type { AppContext } from './context.js';

/**
 * Bodies and queries are validated against the shared zod contracts (ARCH §3); a failure is
 * the `VALIDATION` error of ARCH §11 with the flattened issues as `details`.
 */
export async function parseBody<S extends z.ZodType>(
  c: Context<AppContext>,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw validationFailed({ body: 'expected JSON' });
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw validationFailed(result.error.flatten());
  return result.data;
}

export function parseQuery<S extends z.ZodType>(c: Context<AppContext>, schema: S): z.infer<S> {
  const result = schema.safeParse(c.req.query());
  if (!result.success) throw validationFailed(result.error.flatten());
  return result.data;
}

export function parseUuidParam(c: Context<AppContext>, name: string): string {
  const value = c.req.param(name);
  if (!value || !/^[0-9a-f-]{36}$/i.test(value)) throw validationFailed({ [name]: 'uuid' });
  return value;
}
