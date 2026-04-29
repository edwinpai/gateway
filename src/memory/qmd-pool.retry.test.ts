import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: spawnMock };
});

import { QmdProcessPool } from "./qmd-pool.js";

function createMockChild() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => void;
  };
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = () => {
    child.emit("close", 0);
  };
  return child;
}

describe("QmdProcessPool bash fallback", () => {
  const pools: QmdProcessPool[] = [];

  afterEach(async () => {
    spawnMock.mockReset();
    for (const pool of pools) {
      await pool.close();
    }
    pools.length = 0;
  });

  it("retries absolute qmd commands via bash after ENOENT", async () => {
    spawnMock
      .mockImplementationOnce((command: string) => {
        expect(command).toBe("/tmp/qmd");
        const child = createMockChild();
        setImmediate(() => {
          const err = Object.assign(new Error("spawn /tmp/qmd ENOENT"), { code: "ENOENT" });
          child.emit("error", err);
        });
        return child;
      })
      .mockImplementationOnce((command: string, args: string[]) => {
        expect(command).toBe("/bin/bash");
        expect(args).toEqual(["/tmp/qmd", "collection", "list", "--json"]);
        const child = createMockChild();
        setImmediate(() => {
          child.stdout.emit("data", Buffer.from("ok"));
          child.emit("close", 0);
        });
        return child;
      });

    const pool = new QmdProcessPool({ command: "/tmp/qmd" });
    pools.push(pool);

    const result = await pool.exec(["collection", "list", "--json"], {
      env: { ...process.env },
      cwd: process.cwd(),
    });

    expect(result.stdout).toBe("ok");
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });
});
