import type { CatalogSource as SourceKind } from '@agrobot/shared';

/** Read-only port: integrations supply cells; the domain owns validation and application. */
export interface CatalogSource {
  readonly kind: SourceKind;
  readonly sheetUrl: string;
  fetchRows(): Promise<unknown[][]>;
}
