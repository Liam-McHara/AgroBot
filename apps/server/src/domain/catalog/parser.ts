import { z } from 'zod';
import {
  normalizeProductName,
  productNameSchema,
  UNIT_LIST,
  type CatalogIssue,
  type UnitCode,
} from '@agrobot/shared';

const aliases: Record<string, string> = {
  producte: 'name',
  producto: 'name',
  product: 'name',
  unitat: 'unitCode',
  unidad: 'unitCode',
  unit: 'unitCode',
  preu: 'priceCents',
  precio: 'priceCents',
  price: 'priceCents',
  categoria: 'category',
  category: 'category',
  'producto (es)': 'nameEs',
  'nom es': 'nameEs',
  'name es': 'nameEs',
};
const unitMap = new Map(
  UNIT_LIST.flatMap((u) => [u.code, u.nameCa, u.nameEs].map((name) => [name, u.code] as const)),
);
const cellText = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

/** Decimal text → integer cents, without floating-point rounding or thousands ambiguity. */
export function parsePrice(value: unknown): number | null {
  const text = cellText(value);
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) return null;
  const [whole = '', fraction = ''] = text.replace(',', '.').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents <= 2_147_483_647 ? cents : null;
}
const rowSchema = z.object({
  name: productNameSchema,
  unitCode: z.custom<UnitCode>((value) => UNIT_LIST.some((unit) => unit.code === value)),
  priceCents: z.number().int().nonnegative(),
  category: z.string().min(1).max(40).nullable(),
  nameEs: productNameSchema.nullable(),
});
export type CatalogRow = z.infer<typeof rowSchema> & { slug: string; row: number };
export interface ParsedCatalog {
  rows: CatalogRow[];
  rowsRead: number;
  /** Even a broken row means the product is present, so it must not be archived. */
  presentSlugs: string[];
  errors: CatalogIssue[];
}

export function parseCatalog(cells: unknown[][]): ParsedCatalog {
  const result: ParsedCatalog = {
    rows: [],
    rowsRead: Math.max(0, cells.length - 1),
    presentSlugs: [],
    errors: [],
  };
  const headers = (cells[0] ?? []).map((value) => aliases[normalizeProductName(cellText(value))]);
  const recognized = headers.filter((h) => h !== undefined);
  if (
    ['name', 'unitCode', 'priceCents'].some((h) => !headers.includes(h)) ||
    new Set(recognized).size !== recognized.length
  ) {
    result.errors.push({ row: 1, reason: 'headers', severity: 'error' });
    return result;
  }
  const seen = new Map<string, number[]>();
  for (let i = 1; i < cells.length; i++) {
    const row = cells[i]!;
    if (row.every((cell) => cellText(cell) === '')) continue;
    const values = Object.fromEntries(
      headers.map((key, column) => [key ?? '', cellText(row[column])]),
    );
    const slug = normalizeProductName(values['name'] ?? '');
    if (slug) {
      result.presentSlugs.push(slug);
      seen.set(slug, [...(seen.get(slug) ?? []), i + 1]);
    }
    const parsed = rowSchema.safeParse({
      name: values['name'],
      unitCode: unitMap.get(normalizeProductName(values['unitCode'] ?? '')),
      priceCents: parsePrice(values['priceCents']),
      category: values['category'] || null,
      nameEs: values['nameEs'] || null,
    });
    if (parsed.success) result.rows.push({ ...parsed.data, slug, row: i + 1 });
    else
      for (const issue of parsed.error.issues) {
        const reasons = {
          name: 'name',
          unitCode: 'unit',
          priceCents: 'price',
          category: 'category',
          nameEs: 'name_es',
        } as const;
        const reason = reasons[issue.path[0] as keyof typeof reasons];
        if (!result.errors.some((error) => error.row === i + 1 && error.reason === reason)) {
          result.errors.push({ row: i + 1, reason, severity: 'error' });
        }
      }
  }
  for (const [slug, rowNumbers] of seen) {
    if (rowNumbers.length < 2) continue;
    result.rows = result.rows.filter((row) => row.slug !== slug);
    for (const row of rowNumbers)
      result.errors.push({ row, reason: 'duplicate', severity: 'error' });
  }
  if (result.rows.length === 0) result.errors.push({ row: 0, reason: 'empty', severity: 'error' });
  return result;
}
