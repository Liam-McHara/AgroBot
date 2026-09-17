import { describe, expect, it } from 'vitest';
import { escapeHtml, html } from './html.js';

describe('escapeHtml', () => {
  it('escapes the three characters Telegram HTML mode gives meaning to', () => {
    expect(escapeHtml('<b>tomàquet</b> & co')).toBe('&lt;b&gt;tomàquet&lt;/b&gt; &amp; co');
  });

  it('escapes the ampersand first, so an escape is not escaped twice', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeHtml('Marta Puig')).toBe('Marta Puig');
    expect(escapeHtml('')).toBe('');
  });

  it('does not escape quotes, which carry no meaning outside a tag', () => {
    expect(escapeHtml(`"l'hort"`)).toBe(`"l'hort"`);
  });
});

describe('html', () => {
  it('escapes interpolated values but not the template', () => {
    const name = '<script>alert(1)</script>';
    expect(html`<b>${name}</b>`).toBe('<b>&lt;script&gt;alert(1)&lt;/script&gt;</b>');
  });

  it('renders null and undefined as nothing', () => {
    expect(html`a${null}b${undefined}c`).toBe('abc');
  });
});
