import { DurableObject } from 'cloudflare:workers';
import {
  EVENTS_TICKET_TTL_SECONDS,
  socketClientMessageSchema,
  type ErrorCode,
  type MessageParams,
  type RealtimeEvent,
} from '@agrobot/shared';
import { createJobDeps, openDatabase } from '../deps.js';
import type { HubPort } from '../domain/ports.js';
import { parseEnv, type Bindings } from '../env.js';
import { isAppError } from '../errors.js';
import { DEADLINE_JOBS, JOB_NAMES, jobs } from '../jobs/index.js';
import type { JobName, JobOutcome, JobParams, JobResults } from '../jobs/types.js';
import { LOG_LEVELS, createLogger, type LogLevel, type Logger } from '../logger.js';

/**
 * `AgroBotHub`: the one Durable Object (ADR-0017), and the only long-lived thing in AgroBot.
 *
 * **Jobs (ARCH §9).** A `schedule(job, due_at)` table in the object's SQLite and a single
 * alarm set to the earliest `due_at`. When the alarm fires, every due job runs, says when it
 * wants to run next, and the alarm is re-armed. `wake()` makes the deadline jobs (the outbox
 * dispatcher, the reservation reminder and expiry) due now; the Worker calls it after any
 * commit that enqueued a notification or created a deadline, so the outbox is drained within a
 * second and a deadline is never missed without anything polling Postgres. `ensureArmed()` is
 * the 15-minute heartbeat's liveness check and touches only this storage.
 *
 * **Realtime (ARCH §7).** Tickets issued by `POST /api/events/ticket` are redeemed on the
 * WebSocket upgrade; sockets are accepted with the Hibernation API, tagged by member id, so an
 * idle socket costs nothing. `publish()` writes a frame to every socket of the given members;
 * `isViewing()` answers the chat throttle from the socket attachments.
 *
 * **Rate counters (ARCH §17).** Fixed windows per key in the same SQLite; one instance, exact.
 */
export const HUB_NAME = 'hub';

/** Retry delays after a job throws: the same 1 m, 5 m, 30 m as a notification (ARCH §8). */
export const JOB_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;

/** Rate-counter rows older than this are pruned; no window is longer. */
const COUNTER_RETENTION_MS = 60 * 60_000;

/** Runs one job with fresh dependencies. Tests swap it for a fake; production opens Postgres. */
export interface HubJobRunner {
  run<N extends JobName>(
    name: N,
    params: JobParams[N],
    clock: () => Date,
    hub: HubPort,
  ): Promise<JobOutcome<N>>;
}

/** What `runJob` returns over RPC: a domain error travels as data and is rethrown by the client. */
export type RunJobOutcome<N extends JobName> =
  | { ok: true; result: JobResults[N] }
  | { ok: false; error: { code: ErrorCode; params: MessageParams; details: unknown } };

export interface ScheduleEntry {
  job: string;
  /** Epoch milliseconds, or `null` when the job has nothing due (deadline jobs). */
  dueAt: number | null;
  /** Consecutive failures, which set the retry delay. */
  failures: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until the window resets; 0 when allowed. */
  retryAfterMs: number;
}

interface ScheduleRow extends Record<string, SqlStorageValue> {
  job: string;
  due_at: number | null;
  failures: number;
}

interface TicketRow extends Record<string, SqlStorageValue> {
  member_id: string;
  expires_at: number;
}

interface CounterRow extends Record<string, SqlStorageValue> {
  window_start: number;
  count: number;
}

interface SocketAttachment {
  memberId: string;
  viewing: string | null;
}

function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

function isJobName(value: string): value is JobName {
  return (JOB_NAMES as readonly string[]).includes(value);
}

/** ARCH §3: the job opens its own client over Hyperdrive and closes it when it is done. */
function productionRunner(bindings: Bindings, logger: Logger): HubJobRunner {
  return {
    async run(name, params, clock, hub) {
      const env = parseEnv(bindings);
      const database = openDatabase(bindings);
      try {
        const deps = createJobDeps({ db: database.db, env, logger, hub, now: clock });
        return await jobs[name].run(deps, params);
      } finally {
        await database.close();
      }
    },
  };
}

export class AgroBotHub extends DurableObject<Bindings> {
  private readonly sql: SqlStorage;
  private readonly logger: Logger;
  private clock: () => number = () => Date.now();
  private runner: HubJobRunner;
  private jobNames: readonly string[] = JOB_NAMES;

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.logger = createLogger({
      level: isLogLevel(env['LOG_LEVEL']) ? env['LOG_LEVEL'] : 'info',
      bindings: { component: 'hub' },
    });
    this.runner = productionRunner(env, this.logger);
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS schedule (
         job TEXT PRIMARY KEY,
         due_at INTEGER,
         failures INTEGER NOT NULL DEFAULT 0
       )`,
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS tickets (
         ticket TEXT PRIMARY KEY,
         member_id TEXT NOT NULL,
         expires_at INTEGER NOT NULL
       )`,
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS counters (
         key TEXT PRIMARY KEY,
         window_start INTEGER NOT NULL,
         count INTEGER NOT NULL
       )`,
    );
    // Keep-alives are answered by the runtime without waking the object (ARCH §7).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  // ── Test seams ─────────────────────────────────────────────────────────────────────────

  /** Replace the clock; only reachable through `runInDurableObject` (ARCH §16). */
  useClock(clock: () => number): void {
    this.clock = clock;
  }

  /** Replace the job runner and, optionally, the set of jobs the schedule knows. */
  useJobRunner(runner: HubJobRunner, jobNames?: readonly string[]): void {
    this.runner = runner;
    if (jobNames) this.jobNames = jobNames;
  }

  // ── Schedule (ARCH §9) ─────────────────────────────────────────────────────────────────

  /** The schedule as stored, for `/status` and the tests. */
  async schedule(): Promise<ScheduleEntry[]> {
    return this.scheduleRows();
  }

  /**
   * ARCH §8 step 2, §9: a commit enqueued a notification or created or moved a deadline. Make
   * the deadline jobs due now and set the alarm, which fires within about a second; each job
   * then does its work or reads from Postgres when it is next due, while the database is awake.
   */
  async wake(): Promise<void> {
    const now = this.clock();
    this.seedIfEmpty(now);
    this.markDeadlinesDue(now);
    await this.arm();
  }

  /**
   * ARCH §9 heartbeat: seed the schedule the first time the hub exists (every job due now,
   * which is also how the catalogue is imported right after a deploy) and make sure an alarm
   * is set whenever something is due. Reads only this object's storage.
   */
  async ensureArmed(): Promise<{ seeded: boolean; nextAlarmAt: number | null }> {
    const seeded = this.seedIfEmpty(this.clock());
    const nextAlarmAt = await this.arm();
    return { seeded, nextAlarmAt };
  }

  /**
   * ARCH §9: run one job now, on the hub's CPU budget, and return its result. Used by `/sync`
   * and *Sync now*. A domain error (a demoted actor) comes back as data, not as a failure of
   * the RPC; the job's scheduled slot is left alone in that case.
   */
  async runJob<N extends JobName>(name: N, params: JobParams[N]): Promise<RunJobOutcome<N>> {
    this.seedIfEmpty(this.clock());
    try {
      const outcome = await this.execute(name, params);
      this.setDue(name, outcome.nextDueAt?.getTime() ?? null, 0);
      return { ok: true, result: outcome.result };
    } catch (error) {
      if (isAppError(error)) {
        return {
          ok: false,
          error: { code: error.code, params: error.params, details: error.details },
        };
      }
      throw error;
    } finally {
      await this.arm();
    }
  }

  /**
   * The alarm: every due job runs, stores its next `due_at`, and the alarm is re-armed to the
   * earliest one. A job that throws is logged and retried with backoff; the other jobs' rows
   * are untouched. Alarms are at-least-once, which every job tolerates (ADR-0004, ADR-0009).
   */
  override async alarm(): Promise<void> {
    const now = this.clock();
    const due = this.scheduleRows().filter((row) => row.dueAt !== null && row.dueAt <= now);
    for (const row of due) {
      if (!isJobName(row.job)) {
        // Left over from a deploy that knew a job this one does not: forget it.
        this.sql.exec('DELETE FROM schedule WHERE job = ?', row.job);
        continue;
      }
      try {
        const outcome = await this.execute(row.job, undefined);
        this.setDue(row.job, outcome.nextDueAt?.getTime() ?? null, 0);
      } catch (error) {
        const delay = JOB_RETRY_DELAYS_MS[Math.min(row.failures, JOB_RETRY_DELAYS_MS.length - 1)]!;
        this.setDue(row.job, this.clock() + delay, row.failures + 1);
        this.logger.error({ job: row.job, err: error, retryInMs: delay }, 'job failed');
      }
    }
    await this.arm();
  }

  private async execute<N extends JobName>(name: N, params: JobParams[N]): Promise<JobOutcome<N>> {
    const startedAt = this.clock();
    const outcome = await this.runner.run(
      name,
      params,
      () => new Date(this.clock()),
      this.localPort(),
    );
    this.logger.info(
      {
        job: name,
        durationMs: this.clock() - startedAt,
        nextDueAt: outcome.nextDueAt?.toISOString() ?? null,
        result: outcome.result,
      },
      'job ran',
    );
    return outcome;
  }

  /** The hub as the domain sees it from inside a job: no RPC, just the schedule table. */
  private localPort(): HubPort {
    return {
      wake: () => {
        this.markDeadlinesDue(this.clock());
      },
      publish: (memberIds, event) => {
        void this.publish([...memberIds], event);
      },
      isViewing: (memberId, reservationId) => this.isViewing(memberId, reservationId),
    };
  }

  private scheduleRows(): ScheduleEntry[] {
    return this.sql
      .exec<ScheduleRow>('SELECT job, due_at, failures FROM schedule ORDER BY job')
      .toArray()
      .map((row) => ({ job: row.job, dueAt: row.due_at, failures: row.failures }));
  }

  private seedIfEmpty(now: number): boolean {
    const { n } = this.sql.exec<{ n: number }>('SELECT count(*) AS n FROM schedule').one();
    if (n > 0) return false;
    for (const job of this.jobNames) {
      this.sql.exec('INSERT INTO schedule (job, due_at, failures) VALUES (?, ?, 0)', job, now);
    }
    return true;
  }

  private setDue(job: string, dueAt: number | null, failures: number): void {
    this.sql.exec(
      `INSERT INTO schedule (job, due_at, failures) VALUES (?, ?, ?)
       ON CONFLICT(job) DO UPDATE SET due_at = excluded.due_at, failures = excluded.failures`,
      job,
      dueAt,
      failures,
    );
  }

  private markDeadlinesDue(at: number): void {
    for (const job of DEADLINE_JOBS) {
      if (this.jobNames.includes(job)) this.markDue(job, at);
    }
  }

  /** Bring a job's `due_at` forward to `at` if it is later or unset; never push it back. */
  private markDue(job: string, at: number): void {
    this.sql.exec(
      `INSERT INTO schedule (job, due_at, failures) VALUES (?, ?, 0)
       ON CONFLICT(job) DO UPDATE SET
         due_at = CASE WHEN due_at IS NULL OR due_at > excluded.due_at THEN excluded.due_at ELSE due_at END`,
      job,
      at,
    );
  }

  /** Set the single alarm to the earliest `due_at`, or clear it when nothing is due. */
  private async arm(): Promise<number | null> {
    const { due } = this.sql
      .exec<{ due: number | null }>('SELECT min(due_at) AS due FROM schedule')
      .one();
    const current = await this.ctx.storage.getAlarm();
    if (due === null) {
      if (current !== null) await this.ctx.storage.deleteAlarm();
    } else if (current !== due) {
      await this.ctx.storage.setAlarm(due);
    }
    return due;
  }

  // ── Tickets and sockets (ARCH §7) ──────────────────────────────────────────────────────

  /** A random 128-bit, single-use ticket that lives 30 seconds (ARCH §17). */
  async issueTicket(memberId: string): Promise<string> {
    const now = this.clock();
    this.sql.exec('DELETE FROM tickets WHERE expires_at <= ?', now);
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const ticket = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    this.sql.exec(
      'INSERT INTO tickets (ticket, member_id, expires_at) VALUES (?, ?, ?)',
      ticket,
      memberId,
      now + EVENTS_TICKET_TTL_SECONDS * 1000,
    );
    return ticket;
  }

  private redeemTicket(ticket: string, now: number): string | null {
    const [row] = this.sql
      .exec<TicketRow>('SELECT member_id, expires_at FROM tickets WHERE ticket = ?', ticket)
      .toArray();
    this.sql.exec('DELETE FROM tickets WHERE ticket = ?', ticket);
    if (!row || row.expires_at <= now) return null;
    return row.member_id;
  }

  /** The WebSocket upgrade, forwarded by the Worker after its `Origin` check. */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    const ticket = new URL(request.url).searchParams.get('ticket');
    const memberId = ticket ? this.redeemTicket(ticket, this.clock()) : null;
    if (!memberId) return new Response('Invalid or expired ticket', { status: 401 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [memberId]);
    server.serializeAttachment({ memberId, viewing: null } satisfies SocketAttachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** ARCH §7 presence: `{viewing: reservationId | null}` is stored on the socket. */
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    const result = socketClientMessageSchema.safeParse(parsed);
    const attachment = this.attachmentOf(ws);
    if (!result.success || !attachment) return;
    ws.serializeAttachment({
      ...attachment,
      viewing: result.data.viewing,
    } satisfies SocketAttachment);
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  override async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    this.logger.warn({ err: error }, 'socket error');
    try {
      ws.close(1011, 'error');
    } catch {
      /* already closed */
    }
  }

  private attachmentOf(ws: WebSocket): SocketAttachment | null {
    const attachment: unknown = ws.deserializeAttachment();
    if (attachment === null || typeof attachment !== 'object') return null;
    const { memberId, viewing } = attachment as Record<string, unknown>;
    if (typeof memberId !== 'string') return null;
    return { memberId, viewing: typeof viewing === 'string' ? viewing : null };
  }

  /** ARCH §7: one frame to every socket of these members; returns how many received it. */
  async publish(memberIds: string[], event: RealtimeEvent): Promise<number> {
    const frame = JSON.stringify(event);
    let delivered = 0;
    for (const memberId of new Set(memberIds)) {
      for (const ws of this.ctx.getWebSockets(memberId)) {
        try {
          ws.send(frame);
          delivered += 1;
        } catch (error) {
          this.logger.debug({ err: error, memberId }, 'socket send failed');
        }
      }
    }
    return delivered;
  }

  /** ARCH §8 step 3: is this member looking at this thread right now? */
  async isViewing(memberId: string, reservationId: string): Promise<boolean> {
    return this.ctx
      .getWebSockets(memberId)
      .some((ws) => this.attachmentOf(ws)?.viewing === reservationId);
  }

  /** Open sockets, for one member or in total. */
  async connectionCount(memberId?: string): Promise<number> {
    return this.ctx.getWebSockets(memberId).length;
  }

  // ── Rate counters (ARCH §17) ───────────────────────────────────────────────────────────

  /** Count one hit on `key` in a fixed window and say whether it is within `limit`. */
  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
    const now = this.clock();
    const [row] = this.sql
      .exec<CounterRow>('SELECT window_start, count FROM counters WHERE key = ?', key)
      .toArray();
    const fresh = !row || row.window_start + windowMs <= now;
    const windowStart = fresh ? now : row.window_start;
    const count = (fresh ? 0 : row.count) + 1;
    this.sql.exec(
      `INSERT INTO counters (key, window_start, count) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = excluded.count`,
      key,
      windowStart,
      count,
    );
    if (fresh)
      this.sql.exec('DELETE FROM counters WHERE window_start <= ?', now - COUNTER_RETENTION_MS);
    const allowed = count <= limit;
    return {
      allowed,
      remaining: Math.max(0, limit - count),
      retryAfterMs: allowed ? 0 : Math.max(0, windowStart + windowMs - now),
    };
  }
}
