import { describe, expect, it, afterEach } from "vitest";
import { QmdProcessPool } from "./qmd-pool.js";

const env = { ...process.env };
const cwd = process.cwd();

describe("QmdProcessPool", () => {
  const pools: QmdProcessPool[] = [];
  const createPool = (opts?: { maxWorkers?: number; maxQueueSize?: number }) => {
    const pool = new QmdProcessPool({ command: "echo", ...opts });
    pools.push(pool);
    return pool;
  };

  afterEach(async () => {
    for (const pool of pools) {
      await pool.close();
    }
    pools.length = 0;
  });

  it("executes a simple command", async () => {
    const pool = createPool();
    const result = await pool.exec(["hello"], { env, cwd });
    expect(result.stdout.trim()).toBe("hello");
  });

  it("reports correct stats after completion", async () => {
    const pool = createPool();
    await pool.exec(["test1"], { env, cwd });
    await pool.exec(["test2"], { env, cwd });
    const stats = pool.stats();
    expect(stats.totalCompleted).toBe(2);
    expect(stats.active).toBe(0);
    expect(stats.queued).toBe(0);
  });

  it("enforces concurrency limit", async () => {
    createPool({ maxWorkers: 1 }); // just adds to pools for cleanup
    // Use sleep to create a slow process
    const slowPool = new QmdProcessPool({ command: "sleep", maxWorkers: 1 });
    pools.push(slowPool);

    // Start two overlapping commands
    const p1 = slowPool.exec(["0.1"], { env, cwd });
    const p2 = slowPool.exec(["0.1"], { env, cwd });

    // While both are in flight, one should be queued
    const statsWhileRunning = slowPool.stats();
    // active should be 1 (second one may or may not be queued yet depending on timing)
    expect(statsWhileRunning.active).toBeLessThanOrEqual(1);

    await Promise.all([p1, p2]);
    const stats = slowPool.stats();
    expect(stats.totalCompleted).toBe(2);
  });

  it("rejects when queue is full", async () => {
    const pool = new QmdProcessPool({
      command: "sleep",
      maxWorkers: 1,
      maxQueueSize: 1,
    });
    pools.push(pool);

    // Fill the worker
    const p1 = pool.exec(["0.5"], { env, cwd });

    // Fill the queue
    const p2 = pool.exec(["0.1"], { env, cwd });

    // This should fail — queue full
    await expect(pool.exec(["0.1"], { env, cwd })).rejects.toThrow("queue full");

    await Promise.all([p1, p2]);
  });

  it("rejects after close", async () => {
    const pool = createPool();
    await pool.close();
    await expect(pool.exec(["test"], { env, cwd })).rejects.toThrow("closed");
  });

  it("handles process failures", async () => {
    const pool = new QmdProcessPool({ command: "false" });
    pools.push(pool);
    await expect(pool.exec([], { env, cwd })).rejects.toThrow("failed");
    const stats = pool.stats();
    expect(stats.totalFailed).toBe(1);
  });

  it("handles timeouts", async () => {
    const pool = new QmdProcessPool({ command: "sleep" });
    pools.push(pool);
    await expect(pool.exec(["10"], { env, cwd, timeoutMs: 100 })).rejects.toThrow("timed out");
    const stats = pool.stats();
    expect(stats.totalTimedOut).toBe(1);
  });
});
