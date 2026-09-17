/**
 * The one HTML escape helper (ARCH §17).
 *
 * Every notification and bot reply is sent with `parse_mode: 'HTML'`, so any value that comes
 * from a member — a display name, a note, a product name typed into the sheet — passes
 * through here first. Telegram's HTML mode only assigns meaning to `<`, `>` and `&`.
 */
export function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** Tagged template that escapes every interpolated value: html`Hola, ${name}`. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce<string>(
    (accumulator, part, index) =>
      accumulator + part + (index < values.length ? escapeHtml(String(values[index] ?? '')) : ''),
    '',
  );
}
