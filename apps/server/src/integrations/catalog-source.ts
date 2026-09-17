import type { Env } from '../env.js';
import { createCsvCatalogSource } from './csv-catalog.js';
import { createGoogleSheetsSource } from './google-sheets.js';

export const createCatalogSource = (env: Env) =>
  env.CATALOG_SOURCE === 'csv'
    ? createCsvCatalogSource(env.CATALOG_CSV_URL!)
    : createGoogleSheetsSource({
        id: env.GOOGLE_SHEET_ID!,
        range: env.GOOGLE_SHEET_RANGE,
        credentialsBase64: env.GOOGLE_SERVICE_ACCOUNT_JSON!,
      });
