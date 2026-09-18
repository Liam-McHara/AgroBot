import type { HubPort } from '../domain/ports.js';
import type { JobName, JobParams, JobResults } from '../jobs/types.js';

/**
 * Everything the Worker asks of the hub (ADR-0017): the domain-facing half in `HubPort`, plus
 * what the routes and the bot need. `realtime/client.ts` implements it over the Durable
 * Object stub; the integration tests implement it in-process, so the routes never know which.
 */
export interface Hub extends HubPort {
  /**
   * ARCH §9: run one job now, inside the hub (30 s of CPU, not a request's 10 ms), and hand
   * back its result. `/sync` and `POST /admin/catalog/sync` await this.
   */
  runJob<N extends JobName>(name: N, params: JobParams[N]): Promise<JobResults[N]>;
  /** ARCH §7: a single-use ticket the Mini App redeems when it opens its socket. */
  issueTicket(memberId: string): Promise<string>;
  /** ARCH §7: hand a checked `GET /api/events?ticket=` upgrade to the hub. */
  upgrade(request: Request): Promise<Response>;
}
