/**
 * Version and build metadata. Both are baked into the image at build time (ARCH §15) and
 * fall back to something honest when the server runs straight from the sources.
 */
export const APP_VERSION = process.env['APP_VERSION'] ?? '2.0.0-alpha.0';
export const GIT_COMMIT = process.env['GIT_COMMIT'] ?? 'dev';
