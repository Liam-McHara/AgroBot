import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'csv-parse/sync';
import { normalizeProductName } from '@agrobot/shared';
import { parseCatalog, parsePrice } from './parser.js';

describe('catalogue row validation (US-2.1)', () => {
  it('parses a mixed fixture and reports the exact broken row', async () => {
    const csv = await readFile(
      new URL('../../../test/fixtures/catalog.csv', import.meta.url),
      'utf8',
    );
    const result = parseCatalog(parse(csv) as unknown[][]);
    expect(result.rowsRead).toBe(4);
    expect(result.rows.map((row) => [row.slug, row.unitCode, row.priceCents])).toEqual([
      ['tomaquet', 'kg', 235],
      ['ous', 'dozen', 310],
      ['enciam', 'unit', 95],
    ]);
    expect(result.errors).toEqual([{ row: 4, reason: 'unit', severity: 'error' }]);
    expect(result.presentSlugs).toContain('carbasso');
  });
  it.each([
    ['Producto', 'Precio', 'Unidad'],
    ['Product', 'Price', 'Unit'],
    [' Producte ', 'PREU', 'UNITAT'],
  ])('accepts reordered multilingual headers: %s', (...headers) => {
    const result = parseCatalog([headers, ['Raïm', '1,5', 'caja']]);
    expect(result.rows[0]).toMatchObject({ slug: 'raim', priceCents: 150, unitCode: 'box' });
  });
  it.each([
    'kg',
    'unit',
    'box',
    'bunch',
    'dozen',
    'litre',
    'unitat',
    'unidad',
    'caixa',
    'caja',
    'manat',
    'manojo',
    'dotzena',
    'docena',
    'litro',
  ])('accepts unit %s', (unit) => {
    expect(
      parseCatalog([
        ['Product', 'Unit', 'Price'],
        ['Product name', unit, 0],
      ]).errors,
    ).toEqual([]);
  });
  it.each([
    ['0', 0],
    ['0.01', 1],
    ['1,10', 110],
    [2.35, 235],
    ['21474836.47', 2147483647],
    ['', null],
    ['-1', null],
    ['1.005', null],
    ['1,000.00', null],
    ['1e3', null],
    ['Infinity', null],
    ['21474836.48', null],
  ])('parses exact cents from %s', (input, expected) => {
    expect(parsePrice(input)).toBe(expected);
  });
  it('rejects every ambiguous duplicate and normalizes accents and whitespace', () => {
    expect(normalizeProductName(' TOMÀQUET  cor de bou ')).toBe('tomaquet cor de bou');
    const result = parseCatalog([
      ['Product', 'Unit', 'Price'],
      ['Tomàquet', 'kg', 2],
      ['TOMAQUET', 'kg', 3],
      ['Ous', 'unit', 1],
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.errors.map((e) => [e.row, e.reason])).toEqual([
      [2, 'duplicate'],
      [3, 'duplicate'],
    ]);
  });
  it('rejects missing or ambiguous headers and empty catalogues', () => {
    expect(parseCatalog([]).errors[0]?.reason).toBe('headers');
    expect(parseCatalog([['Product', 'Unit', 'Price', 'Preu']]).errors[0]?.reason).toBe('headers');
    expect(parseCatalog([['Product', 'Unit', 'Price'], []]).errors[0]?.reason).toBe('empty');
  });
  it('validates optional fields and keeps blank sheet rows in row numbering', () => {
    const result = parseCatalog([
      ['Product', 'Unit', 'Price', 'Category', 'Name es'],
      [],
      ['A', 'bad', 'x', 'c'.repeat(41), 'x'],
    ]);
    expect(result.errors.filter((e) => e.row === 3).map((e) => e.reason)).toEqual([
      'name',
      'unit',
      'price',
      'category',
      'name_es',
    ]);
  });
});
