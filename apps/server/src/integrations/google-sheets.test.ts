import { beforeEach, expect, it, vi } from 'vitest';
import { createGoogleSheetsSource } from './google-sheets.js';

const mocks = vi.hoisted(() => ({ get: vi.fn(), auth: vi.fn(), sheets: vi.fn() }));
vi.mock('googleapis/build/src/apis/sheets/index.js', () => ({
  auth: {
    GoogleAuth: class {
      constructor(options: unknown) {
        mocks.auth(options);
      }
    },
  },
  sheets: (options: unknown) => {
    mocks.sheets(options);
    return { spreadsheets: { values: { get: mocks.get } } };
  },
}));
const config = {
  id: 'test-sheet',
  range: 'Productes!A:E',
  credentialsBase64: Buffer.from(
    JSON.stringify({
      client_email: 'catalog@example.test',
      private_key: 'test-key',
      token_uri: 'https://untrusted.test',
    }),
  ).toString('base64'),
};
beforeEach(() => vi.clearAllMocks());
it('uses only read-only Sheets scope, the configured range and unformatted cell values', async () => {
  mocks.get.mockResolvedValue({
    data: {
      values: [
        ['Producte', 'Preu', 'Unitat'],
        ['Tomàquet', 2.35, 'kg'],
      ],
    },
  });
  expect(await createGoogleSheetsSource(config).fetchRows()).toEqual([
    ['Producte', 'Preu', 'Unitat'],
    ['Tomàquet', 2.35, 'kg'],
  ]);
  expect(mocks.auth).toHaveBeenCalledWith({
    credentials: { client_email: 'catalog@example.test', private_key: 'test-key' },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  expect(mocks.get).toHaveBeenCalledWith(
    {
      spreadsheetId: 'test-sheet',
      range: 'Productes!A:E',
      majorDimension: 'ROWS',
      valueRenderOption: 'UNFORMATTED_VALUE',
    },
    { timeout: 30000, retry: false },
  );
});
it('handles an empty sheet and propagates failures to the sync failure log', async () => {
  mocks.get.mockResolvedValue({ data: {} });
  expect(await createGoogleSheetsSource(config).fetchRows()).toEqual([]);
  mocks.get.mockRejectedValueOnce(new Error('unavailable'));
  await expect(createGoogleSheetsSource(config).fetchRows()).rejects.toThrow('unavailable');
  await expect(
    createGoogleSheetsSource({ ...config, credentialsBase64: 'broken' }).fetchRows(),
  ).rejects.toThrow();
});
