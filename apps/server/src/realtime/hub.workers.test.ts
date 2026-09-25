import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Bindings } from '../env.js';
import { AppError } from '../errors.js';
import type { JobName, JobOutcome, JobParams } from '../jobs/types.js';
import { hubStub } from './client.js';
import { JOB_RETRY_DELAYS_MS, type AgroBotHub, type HubJobRunner } from './hub.js';

/**
 * The hub under workerd (ARCH §16, ADR-0017): real SQLite storage, real alarms, real
 * hibernating sockets. Jobs are a fake runner; the job functions have their own tests against
 * Postgres. Time is a fake clock the tests move by hand.
 */
const bindings = env as unknown as Bindings;

/**
 * The fake clock's origin. It must lie in the future for real: the runtime fires an alarm set
 * in the past at once, and these tests want to inspect a parked alarm and fire it by hand.
 */
const T0 = Date.UTC(2100, 6, 1, 10, 0, 0);
const MINUTE = 60_000;
const MEMBER = '11111111-1111-4111-8111-111111111111';
const RESERVATION = '22222222-2222-4222-8222-222222222222';

interface Run {
  name: JobName;
  params: unknown;
  at: number;
}

type Script = {
  [N in JobName]?: (
    params: JobParams[N],
    at: number,
    hub: Parameters<HubJobRunner['run']>[3],
  ) => JobOutcome<N> | Promise<JobOutcome<N>>;
};

function fakeRunner(script: Script) {
  const runs: Run[] = [];
  const runner: HubJobRunner = {
    async run(name, params, clock, hub) {
      const at = clock().getTime();
      runs.push({ name, params, at });
      const handler = script[name] as
        | ((
            p: unknown,
            at: number,
            hub: unknown,
          ) => JobOutcome<JobName> | Promise<JobOutcome<JobName>>)
        | undefined;
      if (!handler) return { result: {}, nextDueAt: null } as never;
      return (await handler(params, at, hub)) as never;
    },
  };
  return { runner, runs };
}

/**
 * A hub with this test's clock and runner, and empty storage: the one instance outlives a
 * test, so the schedule, tickets, counters and alarm of the previous test are wiped first.
 */
async function hubWith(clock: { now: number }, runner: HubJobRunner) {
  const stub = hubStub(bindings.HUB);
  await runInDurableObject(stub, async (hub: AgroBotHub, state) => {
    for (const table of ['schedule', 'tickets', 'counters']) {
      state.storage.sql.exec(`DELETE FROM ${table}`);
    }
    await state.storage.deleteAlarm();
    hub.useClock(() => clock.now);
    hub.useJobRunner(runner);
  });
  return stub;
}

const alarmOf = (stub: ReturnType<typeof hubStub>) =>
  runInDurableObject(stub, (_hub: AgroBotHub, state) => state.storage.getAlarm());

const dueMap = async (stub: ReturnType<typeof hubStub>) =>
  Object.fromEntries((await stub.schedule()).map((row) => [row.job, row.dueAt]));

async function waitFor<T>(probe: () => Promise<T> | T, ok: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const value = await probe();
    if (ok(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition not met in time');
}

describe('schedule and alarm (ARCH §9)', () => {
  it('seeds every job due now on first contact and arms the alarm', async () => {
    const clock = { now: T0 };
    const stub = await hubWith(clock, fakeRunner({}).runner);

    expect(await stub.ensureArmed()).toEqual({ seeded: true, nextAlarmAt: T0 });
    const schedule = await stub.schedule();
    expect(schedule.map((row) => row.job).sort()).toEqual([
      'catalog.sync',
      'notifications.dispatch',
      'offers.expire',
      'offers.nudge',
      'reservations.expire',
      'reservations.remind',
    ]);
    expect(schedule.every((row) => row.dueAt === T0 && row.failures === 0)).toBe(true);
    expect(await alarmOf(stub)).toBe(T0);

    // A second heartbeat changes nothing.
    expect(await stub.ensureArmed()).toEqual({ seeded: false, nextAlarmAt: T0 });
  });

  it('runs what is due, stores each next due and re-arms to the earliest', async () => {
    const clock = { now: T0 };
    const { runner, runs } = fakeRunner({
      'notifications.dispatch': () => ({
        result: { sent: 3, retried: 0, failed: 0 },
        nextDueAt: new Date(T0 + 5 * MINUTE),
      }),
      'catalog.sync': () => ({ result: {} as never, nextDueAt: new Date(T0 + 67 * MINUTE) }),
    });
    const stub = await hubWith(clock, runner);
    await stub.ensureArmed();

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(runs.map((run) => run.name).sort()).toEqual([
      'catalog.sync',
      'notifications.dispatch',
      'offers.expire',
      'offers.nudge',
      'reservations.expire',
      'reservations.remind',
    ]);
    expect(runs.every((run) => run.params === undefined && run.at === T0)).toBe(true);
    expect(await dueMap(stub)).toEqual({
      'notifications.dispatch': T0 + 5 * MINUTE,
      'catalog.sync': T0 + 67 * MINUTE,
      // Unscripted in this test: the fake runner answers "nothing due".
      'offers.expire': null,
      'offers.nudge': null,
      'reservations.expire': null,
      'reservations.remind': null,
    });
    expect(await alarmOf(stub)).toBe(T0 + 5 * MINUTE);

    // An alarm before anything is due runs nothing and keeps the schedule.
    clock.now = T0 + MINUTE;
    await runInDurableObject(stub, (hub: AgroBotHub) => hub.alarm());
    expect(runs).toHaveLength(6);
    expect(await alarmOf(stub)).toBe(T0 + 5 * MINUTE);
  });

  it('wake() brings the dispatcher forward to now and never pushes it back', async () => {
    const clock = { now: T0 };
    const { runner } = fakeRunner({
      'notifications.dispatch': () => ({
        result: { sent: 0, retried: 0, failed: 0 },
        nextDueAt: new Date(T0 + 30 * MINUTE),
      }),
      'catalog.sync': () => ({ result: {} as never, nextDueAt: null }),
    });
    const stub = await hubWith(clock, runner);
    await stub.ensureArmed();
    await runDurableObjectAlarm(stub);
    expect((await dueMap(stub))['notifications.dispatch']).toBe(T0 + 30 * MINUTE);

    clock.now = T0 + 2 * MINUTE;
    await stub.wake();
    expect((await dueMap(stub))['notifications.dispatch']).toBe(T0 + 2 * MINUTE);
    expect(await alarmOf(stub)).toBe(T0 + 2 * MINUTE);

    // Later wake: the earlier due stays.
    clock.now = T0 + 3 * MINUTE;
    await stub.wake();
    expect((await dueMap(stub))['notifications.dispatch']).toBe(T0 + 2 * MINUTE);
  });

  it('a full batch makes the dispatcher due again at once (ARCH §8 step 2)', async () => {
    const clock = { now: T0 };
    const { runner } = fakeRunner({
      'notifications.dispatch': (_params, at) => ({
        result: { sent: 20, retried: 0, failed: 0 },
        nextDueAt: new Date(at),
      }),
      'catalog.sync': () => ({ result: {} as never, nextDueAt: null }),
    });
    const stub = await hubWith(clock, runner);
    await stub.ensureArmed();
    await runDurableObjectAlarm(stub);
    expect(await dueMap(stub)).toEqual({
      'notifications.dispatch': T0,
      'catalog.sync': null,
      'offers.expire': null,
      'offers.nudge': null,
      'reservations.expire': null,
      'reservations.remind': null,
    });
    expect(await alarmOf(stub)).toBe(T0);
  });

  it('clears the alarm when nothing is due and sets it again on wake', async () => {
    const clock = { now: T0 };
    const { runner } = fakeRunner({
      'notifications.dispatch': () => ({
        result: { sent: 0, retried: 0, failed: 0 },
        nextDueAt: null,
      }),
      'catalog.sync': () => ({ result: {} as never, nextDueAt: null }),
    });
    const stub = await hubWith(clock, runner);
    await stub.ensureArmed();
    await runDurableObjectAlarm(stub);
    expect(await alarmOf(stub)).toBeNull();
    expect(await stub.ensureArmed()).toEqual({ seeded: false, nextAlarmAt: null });
    await stub.wake();
    expect(await alarmOf(stub)).toBe(T0);
  });

  it('a job that throws is retried with backoff and does not block the others', async () => {
    const clock = { now: T0 };
    let failing = true;
    const { runner, runs } = fakeRunner({
      'notifications.dispatch': (_params, at) => ({
        result: { sent: 0, retried: 0, failed: 0 },
        nextDueAt: new Date(at + 60 * MINUTE),
      }),
      'catalog.sync': (_params, at) => {
        if (failing) throw new Error('sheet on fire');
        return { result: {} as never, nextDueAt: new Date(at + 60 * MINUTE) };
      },
    });
    const stub = await hubWith(clock, runner);
    await stub.ensureArmed();

    await runDurableObjectAlarm(stub);
    let schedule = await stub.schedule();
    expect(schedule.find((row) => row.job === 'notifications.dispatch')).toMatchObject({
      dueAt: T0 + 60 * MINUTE,
      failures: 0,
    });
    expect(schedule.find((row) => row.job === 'catalog.sync')).toMatchObject({
      dueAt: T0 + JOB_RETRY_DELAYS_MS[0],
      failures: 1,
    });
    expect(await alarmOf(stub)).toBe(T0 + JOB_RETRY_DELAYS_MS[0]);

    // Keeps failing: 5 minutes, then 30, then 30 again.
    for (const [index, delay] of [
      JOB_RETRY_DELAYS_MS[1],
      JOB_RETRY_DELAYS_MS[2],
      JOB_RETRY_DELAYS_MS[2],
    ].entries()) {
      clock.now = (await dueMap(stub))['catalog.sync']!;
      await runDurableObjectAlarm(stub);
      expect((await stub.schedule()).find((row) => row.job === 'catalog.sync')).toMatchObject({
        dueAt: clock.now + delay,
        failures: index + 2,
      });
    }

    // Recovers: the failure count resets and the job's own next due is stored.
    failing = false;
    clock.now = (await dueMap(stub))['catalog.sync']!;
    await runDurableObjectAlarm(stub);
    schedule = await stub.schedule();
    expect(schedule.find((row) => row.job === 'catalog.sync')).toMatchObject({
      dueAt: clock.now + 60 * MINUTE,
      failures: 0,
    });
    expect(runs.filter((run) => run.name === 'catalog.sync')).toHaveLength(5);
  });

  it('a job that wakes the hub from inside its run makes the dispatcher due now', async () => {
    const clock = { now: T0 };
    const { runner } = fakeRunner({
      'notifications.dispatch': () => ({
        result: { sent: 0, retried: 0, failed: 0 },
        nextDueAt: new Date(T0 + 60 * MINUTE),
      }),
      'catalog.sync': (_params, at, hub) => {
        hub.wake(); // the sync enqueued N12
        return { result: {} as never, nextDueAt: new Date(at + 60 * MINUTE) };
      },
    });
    const stub = await hubWith(clock, runner);
    await stub.ensureArmed();
    await runDurableObjectAlarm(stub); // both run; dispatch is rescheduled an hour out
    clock.now = T0 + 10 * MINUTE;
    await runInDurableObject(stub, (hub: AgroBotHub) => hub.useClock(() => clock.now));
    // Only the sync is due now; its wake must pull the dispatcher forward.
    await stub.runJob('catalog.sync', undefined);
    expect((await dueMap(stub))['notifications.dispatch']).toBe(T0 + 10 * MINUTE);
    expect(await alarmOf(stub)).toBe(T0 + 10 * MINUTE);
  });

  it('runJob runs on demand, returns the result and reschedules the job', async () => {
    const clock = { now: T0 };
    const { runner, runs } = fakeRunner({
      'catalog.sync': (params, at) => ({
        result: { id: 'sync-1', trigger: params ? params.trigger : 'schedule' } as never,
        nextDueAt: new Date(at + 67 * MINUTE),
      }),
    });
    const stub = await hubWith(clock, runner);

    const outcome = await stub.runJob('catalog.sync', { trigger: 'manual', actorId: MEMBER });
    expect(outcome).toEqual({ ok: true, result: { id: 'sync-1', trigger: 'manual' } });
    expect(runs).toEqual([
      { name: 'catalog.sync', params: { trigger: 'manual', actorId: MEMBER }, at: T0 },
    ]);
    expect((await dueMap(stub))['catalog.sync']).toBe(T0 + 67 * MINUTE);
  });

  it('runJob hands a domain error back as data and leaves the schedule alone', async () => {
    const clock = { now: T0 };
    const { runner } = fakeRunner({
      'catalog.sync': () => {
        throw new AppError('FORBIDDEN', { details: { reason: 'admin_required' } });
      },
    });
    const stub = await hubWith(clock, runner);
    await stub.ensureArmed();
    const before = await dueMap(stub);
    const outcome = await stub.runJob('catalog.sync', { trigger: 'command', actorId: MEMBER });
    expect(outcome).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', params: {}, details: { reason: 'admin_required' } },
    });
    expect(await dueMap(stub)).toEqual(before);
  });
});

describe('tickets and sockets (ARCH §7)', () => {
  const connect = (stub: ReturnType<typeof hubStub>, ticket: string) =>
    stub.fetch(`https://hub/api/events?ticket=${ticket}`, { headers: { Upgrade: 'websocket' } });

  it('accepts a fresh ticket exactly once and tags the socket with the member', async () => {
    const clock = { now: T0 };
    const stub = await hubWith(clock, fakeRunner({}).runner);
    const ticket = await stub.issueTicket(MEMBER);
    expect(ticket).toMatch(/^[0-9a-f]{32}$/);

    const response = await connect(stub, ticket);
    expect(response.status).toBe(101);
    expect(response.webSocket).not.toBeNull();
    response.webSocket!.accept();
    expect(await stub.connectionCount(MEMBER)).toBe(1);
    expect(await stub.connectionCount()).toBe(1);

    // Single use.
    expect((await connect(stub, ticket)).status).toBe(401);
    response.webSocket!.close();
  });

  it('refuses an expired ticket, an unknown one and a plain request', async () => {
    const clock = { now: T0 };
    const stub = await hubWith(clock, fakeRunner({}).runner);
    const ticket = await stub.issueTicket(MEMBER);
    clock.now = T0 + 31_000;
    expect((await connect(stub, ticket)).status).toBe(401);
    expect((await connect(stub, 'not-a-ticket')).status).toBe(401);
    expect((await stub.fetch('https://hub/api/events?ticket=x')).status).toBe(426);
  });

  it('publishes frames to the member and tracks the thread they are viewing', async () => {
    const clock = { now: T0 };
    const stub = await hubWith(clock, fakeRunner({}).runner);
    const response = await connect(stub, await stub.issueTicket(MEMBER));
    const socket = response.webSocket!;
    const frames: string[] = [];
    socket.addEventListener('message', (event) => frames.push(String(event.data)));
    socket.accept();

    expect(await stub.publish([MEMBER, MEMBER, 'nobody'], { type: 'me.changed' })).toBe(1);
    await waitFor(
      () => frames,
      (value) => value.length === 1,
    );
    expect(JSON.parse(frames[0]!)).toEqual({ type: 'me.changed' });
    expect(await stub.publish(['nobody'], { type: 'board.changed' })).toBe(0);

    expect(await stub.isViewing(MEMBER, RESERVATION)).toBe(false);
    socket.send(JSON.stringify({ viewing: RESERVATION }));
    await waitFor(
      () => stub.isViewing(MEMBER, RESERVATION),
      (value) => value,
    );
    socket.send('not json at all');
    socket.send(JSON.stringify({ viewing: 'not a uuid' }));
    expect(await stub.isViewing(MEMBER, RESERVATION)).toBe(true);
    socket.send(JSON.stringify({ viewing: null }));
    await waitFor(
      () => stub.isViewing(MEMBER, RESERVATION),
      (value) => !value,
    );
    socket.close();
  });
});

describe('rate counters (ARCH §17)', () => {
  it('admits exactly the limit under concurrent calls and keeps thread parties independent', async () => {
    const stub = await hubWith({ now: T0 }, fakeRunner({}).runner);
    const decisions = await Promise.all(
      Array.from({ length: 61 }, () => stub.hit(`member:${MEMBER}`, 60, MINUTE)),
    );
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(60);
    const messages = await Promise.all(
      Array.from({ length: 21 }, () => stub.hit(`thread:${RESERVATION}:${MEMBER}`, 20, MINUTE)),
    );
    expect(messages.filter((decision) => decision.allowed)).toHaveLength(20);
    expect(await stub.hit(`thread:${RESERVATION}:other-member`, 20, MINUTE)).toMatchObject({
      allowed: true,
    });
  });
  it('counts hits in a fixed window and resets after it', async () => {
    const clock = { now: T0 };
    const stub = await hubWith(clock, fakeRunner({}).runner);
    const key = `member:${MEMBER}:mutations`;
    expect(await stub.hit(key, 3, MINUTE)).toEqual({
      allowed: true,
      remaining: 2,
      retryAfterMs: 0,
    });
    expect(await stub.hit(key, 3, MINUTE)).toEqual({
      allowed: true,
      remaining: 1,
      retryAfterMs: 0,
    });
    clock.now = T0 + 20_000;
    expect(await stub.hit(key, 3, MINUTE)).toEqual({
      allowed: true,
      remaining: 0,
      retryAfterMs: 0,
    });
    expect(await stub.hit(key, 3, MINUTE)).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterMs: 40_000,
    });
    // Another key is another window.
    expect(await stub.hit('other', 3, MINUTE)).toMatchObject({ allowed: true });
    clock.now = T0 + MINUTE;
    expect(await stub.hit(key, 3, MINUTE)).toEqual({
      allowed: true,
      remaining: 2,
      retryAfterMs: 0,
    });
  });
});
