import {
  auth as googleAuth,
  sheets as createSheets,
} from 'googleapis/build/src/apis/sheets/index.js';
import { z } from 'zod';
import type { CatalogSource } from '../domain/catalog/source.js';

const credentialsSchema = z.object({ client_email: z.email(), private_key: z.string().min(1) });
export interface SheetsConfig {
  id: string;
  range: string;
  credentialsBase64: string;
}
export function createGoogleSheetsSource(config: SheetsConfig): CatalogSource {
  return {
    kind: 'sheets',
    sheetUrl: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(config.id)}/edit`,
    async fetchRows() {
      // Only parse the fields needed for signing; never accept endpoints from the key file.
      const credentials = credentialsSchema.parse(
        JSON.parse(Buffer.from(config.credentialsBase64, 'base64').toString('utf8')) as unknown,
      );
      const auth = new googleAuth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
      });
      const sheets = createSheets({ version: 'v4', auth });
      const response = await sheets.spreadsheets.values.get(
        {
          spreadsheetId: config.id,
          range: config.range,
          majorDimension: 'ROWS',
          valueRenderOption: 'UNFORMATTED_VALUE',
        },
        { timeout: 30_000, retry: false },
      );
      return (response.data.values ?? []) as unknown[][];
    },
  };
}
