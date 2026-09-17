import type { Env } from '../env.js';

/**
 * ARCH §4 deep links: `https://t.me/<BOT_USERNAME>/<MINIAPP_SHORT_NAME>?startapp=<param>`.
 * The Mini App reads `start_param` once on launch and routes; the grammar is
 * `r_<reservationId>`, `o_<offerId>`, `a_members`, `a_catalog`.
 */
export type StartParam = `r_${string}` | `o_${string}` | 'a_members' | 'a_catalog';

export function miniAppLink(
  env: Pick<Env, 'BOT_USERNAME' | 'MINIAPP_SHORT_NAME'>,
  startParam?: StartParam,
): string {
  const base = `https://t.me/${env.BOT_USERNAME}/${env.MINIAPP_SHORT_NAME}`;
  return startParam ? `${base}?startapp=${encodeURIComponent(startParam)}` : base;
}

/** Quick-action `callback_data` (≤ 64 bytes): `<action>:<entityId>`. */
export type QuickAction = 'approve' | 'reject';

export function quickActionData(action: QuickAction, entityId: string): string {
  const data = `${action}:${entityId}`;
  if (Buffer.byteLength(data) > 64) throw new Error(`callback_data too long: ${data}`);
  return data;
}

export function parseQuickAction(data: string): { action: QuickAction; entityId: string } | null {
  const match = /^(approve|reject):([0-9a-f-]{36})$/.exec(data);
  if (!match) return null;
  return { action: match[1] as QuickAction, entityId: match[2]! };
}
