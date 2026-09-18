import type { RealtimeEvent } from '@agrobot/shared';
import { AppError } from '../errors.js';
import type { JobName, JobParams, JobResults } from '../jobs/types.js';
import type { Logger } from '../logger.js';
import { HUB_NAME, type AgroBotHub, type RunJobOutcome } from './hub.js';
import type { Hub } from './port.js';

export type WaitUntil = (promise: Promise<unknown>) => void;

/**
 * The one hub instance (ADR-0017). The location hint only matters the first time the object
 * is created; `weur` is the region the database lives in (ADR-0016).
 */
export function hubStub(
  namespace: DurableObjectNamespace<AgroBotHub>,
): DurableObjectStub<AgroBotHub> {
  return namespace.get(namespace.idFromName(HUB_NAME), { locationHint: 'weur' });
}

/**
 * The Worker's implementation of the hub port over the Durable Object stub (ARCH §7–§9).
 *
 * `wake` and `publish` run after a commit and are handed to `waitUntil`, so the response is
 * not delayed by them and a hub hiccup can never make a committed change look like a failure.
 * `runJob` is awaited: the caller wants the report.
 */
export function createHubClient(
  namespace: DurableObjectNamespace<AgroBotHub>,
  waitUntil: WaitUntil,
  logger: Logger,
): Hub {
  const stub = hubStub(namespace);

  const background = (call: string, promise: Promise<unknown>): void => {
    waitUntil(
      promise.catch((error: unknown) => {
        logger.error({ err: error, call }, 'hub call failed');
      }),
    );
  };

  return {
    wake() {
      background('wake', stub.wake());
    },
    publish(memberIds: readonly string[], event: RealtimeEvent) {
      if (memberIds.length === 0) return;
      background('publish', stub.publish([...memberIds], event));
    },
    async runJob<N extends JobName>(name: N, params: JobParams[N]): Promise<JobResults[N]> {
      const outcome = (await stub.runJob(name, params)) as unknown as RunJobOutcome<N>;
      if (outcome.ok) return outcome.result;
      // Domain errors cross the RPC boundary as data and become the same AppError again, so
      // a route answers 403 or 404 exactly as it would have without the hub in between.
      throw new AppError(outcome.error.code, {
        params: outcome.error.params,
        details: outcome.error.details,
      });
    },
    issueTicket(memberId: string) {
      return stub.issueTicket(memberId);
    },
    upgrade(request: Request) {
      return stub.fetch(request);
    },
  };
}
