import { Hono } from 'hono';
import {
  boardQuerySchema,
  editOfferSchema,
  publishOfferSchema,
  type MyOfferResponse,
  type MyOffersResponse,
  type OfferDetailResponse,
} from '@agrobot/shared';
import { authenticate, requireMember } from '../middleware/auth.js';
import { toBoard, toMyOffer, toOfferDetail } from '../serializers.js';
import { parseBody, parseQuery, parseUuidParam } from '../validate.js';
import type { AppContext, AppDeps } from '../context.js';

/**
 * ARCH §11 `/board` and `/offers` (PRD §7). The routes translate HTTP to `domain/offers` and
 * nothing more: the producer check, the one-active-per-product rule, the held floor and the
 * board's visibility rules all live in the domain, where the bot's quick actions share them.
 */
export function offerRoutes(deps: AppDeps): Hono<AppContext> {
  const app = new Hono<AppContext>();

  app.use('/board', authenticate(deps), requireMember);
  app.use('/offers', authenticate(deps), requireMember);
  app.use('/offers/*', authenticate(deps), requireMember);

  app.get('/board', async (c) => {
    const query = parseQuery(c, boardQuerySchema);
    const result = await deps.offers.board(c.get('member')!, query);
    return c.json(toBoard(result, query.group));
  });

  app.get('/offers/mine', async (c) => {
    const records = await deps.offers.mine(c.get('member')!);
    const body: MyOffersResponse = { offers: records.map(toMyOffer) };
    return c.json(body);
  });

  app.post('/offers', async (c) => {
    const input = await parseBody(c, publishOfferSchema);
    const record = await deps.offers.publish(c.get('member')!, input);
    const body: MyOfferResponse = { offer: toMyOffer(record) };
    return c.json(body, 201);
  });

  app.get('/offers/:id', async (c) => {
    const member = c.get('member')!;
    const record = await deps.offers.get(member, parseUuidParam(c, 'id'));
    const body: OfferDetailResponse = { offer: toOfferDetail(record, member) };
    return c.json(body);
  });

  app.patch('/offers/:id', async (c) => {
    const patch = await parseBody(c, editOfferSchema);
    const record = await deps.offers.edit(c.get('member')!, parseUuidParam(c, 'id'), patch);
    const body: MyOfferResponse = { offer: toMyOffer(record) };
    return c.json(body);
  });

  app.post('/offers/:id/withdraw', async (c) => {
    const record = await deps.offers.withdraw(c.get('member')!, parseUuidParam(c, 'id'));
    const body: MyOfferResponse = { offer: toMyOffer(record) };
    return c.json(body);
  });

  app.post('/offers/:id/still-available', async (c) => {
    const record = await deps.offers.stillAvailable(c.get('member')!, parseUuidParam(c, 'id'));
    const body: MyOfferResponse = { offer: toMyOffer(record) };
    return c.json(body);
  });

  return app;
}
