import { expect, it } from 'vitest';
import { createLogger } from './logger.js';

it('redacts nested secret keys, error properties and credentials embedded in errors', () => {
  const lines: string[] = [];
  const logger = createLogger({ sink: (_level, line) => lines.push(line) });
  const error = Object.assign(
    new Error(
      'request to https://api.telegram.org/bot123456:abcdefghijklmnopqrstuvwxyz/sendMessage failed; postgres://user:password@host/db',
    ),
    { BOT_TOKEN: 'private-token' },
  );
  logger
    .child({ requestId: 'id' })
    .error({ err: error, nested: { authorization: 'private-auth' } }, 'failed');
  const line = lines[0]!;
  for (const secret of ['abcdefghijklmnopqrstuvwxyz', 'password', 'private-token', 'private-auth'])
    expect(line).not.toContain(secret);
  expect(JSON.parse(line)).toMatchObject({ requestId: 'id', err: { BOT_TOKEN: '[redacted]' } });
});
