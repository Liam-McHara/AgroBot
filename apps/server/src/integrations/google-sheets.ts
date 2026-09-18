import { z } from 'zod';
import type { CatalogSource } from '../domain/catalog/source.js';

/**
 * ARCH §10, sheets mode: the group's price sheet, read with a Google service account.
 *
 * No Google client library (it does not run on workerd, ADR-0016): the client signs an RS256 JWT with
 * WebCrypto, exchanges it for an access token and calls the Sheets REST API with `fetch`. It
 * asks for `spreadsheets.readonly` only, and it never takes an endpoint from the key file —
 * the token URL is Google's, hard-coded, so a tampered key file cannot send the JWT anywhere else.
 */
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_API_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const TIMEOUT_MS = 30_000;
const JWT_LIFETIME_SECONDS = 3600;

const credentialsSchema = z.object({ client_email: z.email(), private_key: z.string().min(1) });
export type ServiceAccountCredentials = z.infer<typeof credentialsSchema>;

const tokenSchema = z.object({ access_token: z.string().min(1) });
const valuesSchema = z.object({ values: z.array(z.array(z.unknown())).optional() });

export interface SheetsConfig {
  id: string;
  range: string;
  /** Base64 of the service account key file (ARCH §13 `GOOGLE_SERVICE_ACCOUNT_JSON`). */
  credentialsBase64: string;
}

export interface SheetsOptions {
  fetcher?: typeof fetch;
  now?: () => Date;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value.replace(/\s+/g, ''));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64Url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** The PKCS#8 body of a `-----BEGIN PRIVATE KEY-----` block, as DER. */
function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [A-Z ]+-----/, '')
    .replace(/-----END [A-Z ]+-----/, '')
    .replace(/\\n/g, '')
    .replace(/\s+/g, '');
  return decodeBase64(body).buffer as ArrayBuffer;
}

/** Parse the key file, keeping only what signing needs. */
export function parseServiceAccount(credentialsBase64: string): ServiceAccountCredentials {
  const json = new TextDecoder().decode(decodeBase64(credentialsBase64));
  return credentialsSchema.parse(JSON.parse(json) as unknown);
}

/** A service-account JWT (RFC 7523) for `SCOPE`, valid one hour from `now`. */
export async function signServiceAccountJwt(
  credentials: ServiceAccountCredentials,
  now: Date,
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(
    JSON.stringify({
      iss: credentials.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + JWT_LIFETIME_SECONDS,
    }),
  );
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(credentials.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  return `${header}.${claims}.${base64Url(new Uint8Array(signature))}`;
}

export function createGoogleSheetsSource(
  config: SheetsConfig,
  options: SheetsOptions = {},
): CatalogSource {
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const now = options.now ?? (() => new Date());

  async function accessToken(): Promise<string> {
    const assertion = await signServiceAccountJwt(
      parseServiceAccount(config.credentialsBase64),
      now(),
    );
    const response = await fetcher(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Status only: a token error body can echo the request, and it must never reach a log.
    if (!response.ok) throw new Error(`Google token endpoint answered ${response.status}`);
    return tokenSchema.parse(await response.json()).access_token;
  }

  return {
    kind: 'sheets',
    sheetUrl: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(config.id)}/edit`,
    async fetchRows() {
      const token = await accessToken();
      const url = new URL(
        `${SHEETS_API_URL}/${encodeURIComponent(config.id)}/values/${encodeURIComponent(config.range)}`,
      );
      url.searchParams.set('majorDimension', 'ROWS');
      url.searchParams.set('valueRenderOption', 'UNFORMATTED_VALUE');
      const response = await fetcher(url, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Google Sheets API answered ${response.status}`);
      return valuesSchema.parse(await response.json()).values ?? [];
    },
  };
}
