import type { Logger } from '../logger.js';

/**
 * ARCH §9: jobs are plain async functions on a fixed cadence inside the one server process,
 * each wrapped in a mutex so a slow run is never overlapped by the next tick. The next run
 * is scheduled when the previous one finishes, so a job cannot pile up on itself.
 */
export interface JobReport {
  /** Whatever the job wants in its one-line log: counts, mostly. */
  [key: string]: number | string | boolean | undefined;
}

export interface Job {
  name: string;
  everyMs: number;
  run: () => Promise<JobReport | void>;
}

export interface Scheduler {
  add(job: Job): void;
  start(): void;
  /** Resolves once no run is in flight. */
  stop(): Promise<void>;
  /** Run one job now, awaiting it; used by boot ("on boot") and by tests. */
  runNow(name: string): Promise<JobReport | void>;
}

export function createScheduler(logger: Logger): Scheduler {
  const jobs = new Map<string, Job>();
  const timers = new Map<string, NodeJS.Timeout>();
  const running = new Map<string, Promise<JobReport | void>>();
  let started = false;

  async function execute(job: Job): Promise<JobReport | void> {
    const inFlight = running.get(job.name);
    if (inFlight) return inFlight;
    const startedAt = Date.now();
    const promise = job
      .run()
      .then((report) => {
        const durationMs = Date.now() - startedAt;
        if (report && Object.keys(report).length > 0) {
          logger.debug({ job: job.name, durationMs, ...report }, 'job ran');
        }
        return report;
      })
      .catch((error: unknown) => {
        logger.error({ job: job.name, err: error }, 'job failed');
        return undefined;
      })
      .finally(() => {
        running.delete(job.name);
      });
    running.set(job.name, promise);
    return promise;
  }

  function schedule(job: Job): void {
    if (!started) return;
    const timer = setTimeout(() => {
      timers.delete(job.name);
      void execute(job).finally(() => schedule(job));
    }, job.everyMs);
    timer.unref();
    timers.set(job.name, timer);
  }

  return {
    add(job) {
      if (jobs.has(job.name)) throw new Error(`job ${job.name} registered twice`);
      jobs.set(job.name, job);
      schedule(job);
    },
    start() {
      if (started) return;
      started = true;
      for (const job of jobs.values()) schedule(job);
      logger.info({ jobs: [...jobs.keys()] }, 'scheduler started');
    },
    async stop() {
      started = false;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      await Promise.all(running.values());
    },
    async runNow(name) {
      const job = jobs.get(name);
      if (!job) throw new Error(`unknown job ${name}`);
      return execute(job);
    },
  };
}
