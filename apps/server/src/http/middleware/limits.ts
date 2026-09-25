import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import { AppError } from '../../errors.js';
import type { Hub } from '../../realtime/port.js';
import type { AppContext } from '../context.js';

export const API_BODY_BYTES = 16 * 1024;
export const WEBHOOK_BODY_BYTES = 64 * 1024;

export async function enforceRateLimit(
  c: Context<AppContext>,
  hub: Hub,
  key: string,
  limit: number,
): Promise<void> {
  const decision = await hub.hit(key, limit, 60_000);
  if (!decision.allowed) {
    const retryAfter = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
    c.header('Retry-After', String(retryAfter));
    throw new AppError('RATE_LIMITED', { details: { retryAfter } });
  }
}

/** Count bytes even when Content-Length is missing or inaccurate; keep only a bounded body. */
export function boundedBody(maxBytes: number) {
  return createMiddleware<AppContext>(async (c, next) => {
    const body = c.req.raw.body;
    if (!body) return next();
    const reject = () => {
      const error = new AppError('VALIDATION', { details: { maxBytes } });
      return c.json(error.body(c.get('language') ?? 'ca'), 413);
    };
    if (Number(c.req.header('content-length')) > maxBytes) return reject();
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > maxBytes) {
          void reader.cancel().catch(() => {});
          return reject();
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    c.req.raw = new Request(c.req.raw, { body: bytes });
    await next();
  });
}
