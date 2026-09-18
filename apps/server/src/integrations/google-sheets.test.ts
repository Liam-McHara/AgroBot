import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createGoogleSheetsSource, signServiceAccountJwt } from './google-sheets.js';

/**
 * ARCH §10 sheets mode without Google: a key pair generated here stands in for the service
 * account, and a mocked `fetch` plays the token endpoint and the Sheets API, verifying the
 * JWT the client signed the way Google would.
 */
let publicKey: CryptoKey;
let credentialsBase64 = '';
let privateKeyPem = '';

const toBase64 = (bytes: ArrayBuffer | Uint8Array): string => {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const fromBase64Url = (value: string): Uint8Array =>
  Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
const utf8 = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  publicKey = pair.publicKey;
  const pkcs8 = toBase64((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer);
  privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
  credentialsBase64 = toBase64(
    new TextEncoder().encode(
      JSON.stringify({
        type: 'service_account',
        client_email: 'catalog@example.iam.gserviceaccount.com',
        // Key files carry the newlines escaped, exactly like this.
        private_key: privateKeyPem.replaceAll('\n', '\\n'),
        token_uri: 'https://untrusted.test/token',
      }),
    ),
  );
});

const config = () => ({ id: 'sheet-123', range: 'Productes!A:E', credentialsBase64 });
const NOW = new Date('2026-07-01T10:00:00Z');

async function verifyJwt(jwt: string) {
  const [header, claims, signature] = jwt.split('.') as [string, string, string];
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    fromBase64Url(signature),
    new TextEncoder().encode(`${header}.${claims}`),
  );
  return {
    valid,
    header: JSON.parse(utf8(fromBase64Url(header))) as Record<string, unknown>,
    claims: JSON.parse(utf8(fromBase64Url(claims))) as Record<string, unknown>,
  };
}

/** Google, played by a mock: checks the assertion, hands out a token, serves the range. */
function googleDouble(values: unknown[][] | undefined) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, init });
    if (url === 'https://oauth2.googleapis.com/token') {
      const body = init?.body as URLSearchParams;
      const { valid } = await verifyJwt(body.get('assertion')!);
      if (!valid) return new Response('{"error":"invalid_grant"}', { status: 401 });
      return Response.json({ access_token: 'ya29.token', expires_in: 3599, token_type: 'Bearer' });
    }
    if (url.startsWith('https://sheets.googleapis.com/')) {
      const authorization = new Headers(init?.headers).get('authorization');
      if (authorization !== 'Bearer ya29.token') return new Response('', { status: 401 });
      return Response.json(values === undefined ? { range: 'x' } : { values });
    }
    return new Response('not found', { status: 404 });
  });
  return { fetcher, calls };
}

describe('signServiceAccountJwt', () => {
  it('produces an RS256 JWT for the read-only scope, valid one hour, addressed to Google', async () => {
    const jwt = await signServiceAccountJwt(
      { client_email: 'catalog@example.iam.gserviceaccount.com', private_key: privateKeyPem },
      NOW,
    );
    const { valid, header, claims } = await verifyJwt(jwt);
    expect(valid).toBe(true);
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(claims).toEqual({
      iss: 'catalog@example.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1782900000,
      exp: 1782903600,
    });
  });
});

describe('createGoogleSheetsSource', () => {
  it('exchanges the JWT for a token and reads the range with unformatted values', async () => {
    const google = googleDouble([
      ['Producte', 'Preu', 'Unitat'],
      ['Tomàquet', 2.35, 'kg'],
    ]);
    const source = createGoogleSheetsSource(config(), { fetcher: google.fetcher, now: () => NOW });
    expect(source.kind).toBe('sheets');
    expect(source.sheetUrl).toBe('https://docs.google.com/spreadsheets/d/sheet-123/edit');
    expect(await source.fetchRows()).toEqual([
      ['Producte', 'Preu', 'Unitat'],
      ['Tomàquet', 2.35, 'kg'],
    ]);

    expect(google.calls).toHaveLength(2);
    // The token URL is Google's, never the one in the key file (ARCH §17).
    expect(google.calls[0]?.url).toBe('https://oauth2.googleapis.com/token');
    expect((google.calls[0]?.init?.body as URLSearchParams).get('grant_type')).toBe(
      'urn:ietf:params:oauth:grant-type:jwt-bearer',
    );
    const sheets = new URL(google.calls[1]!.url);
    expect(sheets.pathname).toBe('/v4/spreadsheets/sheet-123/values/Productes!A%3AE');
    expect(sheets.searchParams.get('majorDimension')).toBe('ROWS');
    expect(sheets.searchParams.get('valueRenderOption')).toBe('UNFORMATTED_VALUE');
    for (const call of google.calls) expect(call.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('handles an empty sheet and propagates failures to the sync failure log', async () => {
    const empty = googleDouble(undefined);
    expect(
      await createGoogleSheetsSource(config(), { fetcher: empty.fetcher }).fetchRows(),
    ).toEqual([]);

    const unavailable = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"error":"backend"}', { status: 503 }));
    await expect(
      createGoogleSheetsSource(config(), { fetcher: unavailable }).fetchRows(),
    ).rejects.toThrow('503');

    const wrongKey = { ...config(), credentialsBase64: btoa('{"nope":1}') };
    await expect(
      createGoogleSheetsSource(wrongKey, { fetcher: unavailable }).fetchRows(),
    ).rejects.toThrow();
    expect(unavailable).toHaveBeenCalledTimes(1);

    await expect(
      createGoogleSheetsSource({ ...config(), credentialsBase64: '%%%' }).fetchRows(),
    ).rejects.toThrow();
  });

  it('does not put the response body in the error it throws', async () => {
    const leaky = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"error_description":"SECRET assertion"}', { status: 400 }));
    await expect(
      createGoogleSheetsSource(config(), { fetcher: leaky }).fetchRows(),
    ).rejects.not.toThrow(/SECRET/);
  });
});
