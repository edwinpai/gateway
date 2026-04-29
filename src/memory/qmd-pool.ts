/**
 * QMD Process Pool — bounded concurrency for qmd subprocess invocations.
 *
 * Instead of spawning unlimited concurrent `qmd` processes (each consuming
 * 6-8% CPU with cold-start overhead), this pool enforces a hard cap on
 * concurrent workers and queues excess requests.
 *
 * Think of it like a restaurant: keep N kitchens running, queue customers
 * when all kitchens are busy, never build kitchen N+1.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("qmd-pool");

export type QmdProcessResult = {
  stdout: string;
  stderr: string;
};

type QueuedJob = {
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  timeoutMs?: number;
  resolve: (result: QmdProcessResult) => void;
  reject: (error: Error) => void;
  queuedAt: number;
};

export type QmdPoolStats = {
  active: number;
  queued: number;
  maxWorkers: number;
  totalCompleted: number;
  totalFailed: number;
  totalTimedOut: number;
  avgDurationMs: number;
};

export class QmdProcessPool {
  private readonly command: string;
  private readonly maxWorkers: number;
  private readonly maxQueueSize: number;
  private active = 0;
  private readonly queue: QueuedJob[] = [];
  private totalCompleted = 0;
  private totalFailed = 0;
  private totalTimedOut = 0;
  private totalDurationMs = 0;
  private closed = false;
  private readonly activeProcesses = new Set<ChildProcess>();

  constructor(opts: { command: string; maxWorkers?: number; maxQueueSize?: number }) {
    this.command = opts.command;
    this.maxWorkers = Math.max(1, opts.maxWorkers ?? 3);
    this.maxQueueSize = Math.max(0, opts.maxQueueSize ?? 20);
  }

  /**
   * Execute a qmd command, respecting pool concurrency limits.
   * If all workers are busy, the request is queued.
   * If the queue is full, the request is rejected immediately.
   */
  async exec(
    args: string[],
    opts: { env: NodeJS.ProcessEnv; cwd: string; timeoutMs?: number },
  ): Promise<QmdProcessResult> {
    if (this.closed) {
      throw new Error("QMD pool is closed");
    }

    // If we have capacity, run immediately
    if (this.active < this.maxWorkers) {
      return this.runProcess(args, opts);
    }

    // Otherwise, queue the request
    if (this.queue.length >= this.maxQueueSize) {
      throw new Error(
        `QMD pool queue full (${this.queue.length}/${this.maxQueueSize}). ` +
          `${this.active} workers busy. Try again later.`,
      );
    }

    return new Promise<QmdProcessResult>((resolve, reject) => {
      this.queue.push({
        args,
        env: opts.env,
        cwd: opts.cwd,
        timeoutMs: opts.timeoutMs,
        resolve,
        reject,
        queuedAt: Date.now(),
      });
      log.info(
        `qmd queued (active=${this.active}/${this.maxWorkers}, queue=${this.queue.length}): ${args.join(" ")}`,
      );
    });
  }

  /** Get current pool statistics. */
  stats(): QmdPoolStats {
    return {
      active: this.active,
      queued: this.queue.length,
      maxWorkers: this.maxWorkers,
      totalCompleted: this.totalCompleted,
      totalFailed: this.totalFailed,
      totalTimedOut: this.totalTimedOut,
      avgDurationMs:
        this.totalCompleted > 0 ? Math.round(this.totalDurationMs / this.totalCompleted) : 0,
    };
  }

  /** Shut down the pool, killing any active processes and draining the queue. */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;

    // Reject all queued jobs
    for (const job of this.queue) {
      job.reject(new Error("QMD pool closed"));
    }
    this.queue.length = 0;

    // Kill active processes
    for (const proc of this.activeProcesses) {
      proc.kill("SIGKILL");
    }
    this.activeProcesses.clear();
  }

  private async runProcess(
    args: string[],
    opts: { env: NodeJS.ProcessEnv; cwd: string; timeoutMs?: number },
  ): Promise<QmdProcessResult> {
    this.active += 1;
    const startTime = Date.now();

    try {
      const result = await this.spawnProcess(args, opts);
      this.totalCompleted += 1;
      this.totalDurationMs += Date.now() - startTime;
      return result;
    } catch (err) {
      if (err instanceof Error && err.message.includes("timed out")) {
        this.totalTimedOut += 1;
      } else {
        this.totalFailed += 1;
      }
      throw err;
    } finally {
      this.active -= 1;
      this.drainQueue();
    }
  }

  private spawnProcess(
    args: string[],
    opts: { env: NodeJS.ProcessEnv; cwd: string; timeoutMs?: number },
  ): Promise<QmdProcessResult> {
    return this.spawnProcessAttempt(this.command, args, opts, false);
  }

  private spawnProcessAttempt(
    command: string,
    args: string[],
    opts: { env: NodeJS.ProcessEnv; cwd: string; timeoutMs?: number },
    viaBash: boolean,
  ): Promise<QmdProcessResult> {
    return new Promise((resolve, reject) => {
      const spawnCommand = viaBash ? "/bin/bash" : command;
      const spawnArgs = viaBash ? [command, ...args] : args;
      const child = spawn(spawnCommand, spawnArgs, {
        env: opts.env,
        cwd: opts.cwd,
      });

      this.activeProcesses.add(child);

      let stdout = "";
      let stderr = "";
      let settled = false;

      const timer = opts.timeoutMs
        ? setTimeout(() => {
            if (!settled) {
              settled = true;
              child.kill("SIGKILL");
              this.activeProcesses.delete(child);
              reject(new Error(`qmd ${args.join(" ")} timed out after ${opts.timeoutMs}ms`));
            }
          }, opts.timeoutMs)
        : null;

      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("error", (err: NodeJS.ErrnoException) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        this.activeProcesses.delete(child);
        if (!viaBash && err.code === "ENOENT" && command.includes("/")) {
          log.warn(
            `qmd exec ENOENT for ${command}; cwd=${opts.cwd}; path=${opts.env.PATH ?? "<missing>"}; retrying via /bin/bash`,
          );
          this.spawnProcessAttempt(command, args, opts, true).then(resolve, reject);
          return;
        }
        reject(err);
      });

      child.on("close", (code: number | null) => {
        if (!settled) {
          settled = true;
          if (timer) {
            clearTimeout(timer);
          }
          this.activeProcesses.delete(child);
          if (code === 0) {
            resolve({ stdout, stderr });
          } else {
            reject(new Error(`qmd ${args.join(" ")} failed (code ${code}): ${stderr || stdout}`));
          }
        }
      });
    });
  }

  private drainQueue(): void {
    while (this.queue.length > 0 && this.active < this.maxWorkers && !this.closed) {
      const job = this.queue.shift();
      if (!job) {
        break;
      }

      const waitTime = Date.now() - job.queuedAt;
      log.info(
        `qmd dequeued after ${waitTime}ms wait (active=${this.active + 1}/${this.maxWorkers})`,
      );

      // Run the queued job, piping results back to the original promise
      this.runProcess(job.args, {
        env: job.env,
        cwd: job.cwd,
        timeoutMs: job.timeoutMs,
      }).then(job.resolve, job.reject);
    }
  }
}
