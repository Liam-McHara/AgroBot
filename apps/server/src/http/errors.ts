/**
 * The HTTP layer's view of the one error type. It lives in `src/errors.ts` so that
 * `domain/` can throw it without importing anything from `http/` (ARCH §2).
 */
export * from '../errors.js';
