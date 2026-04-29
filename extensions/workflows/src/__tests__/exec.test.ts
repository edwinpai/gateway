import { describe, expect, it } from "vitest";
import type { ExecStep, StepContext } from "../types.js";
import { executeExecStep } from "../steps/exec.js";

function makeContext(overrides?: Partial<StepContext>): StepContext {
  return {
    workflowName: "test-workflow",
    stepId: "test-step",
    env: { ...(process.env as Record<string, string>) },
    previousOutputs: {},
    state: {
      workflowName: "test-workflow",
      lastRun: { timestamp: new Date().toISOString(), success: true },
      stepOutputs: {},
      diffSnapshots: {},
    },
    ...overrides,
  };
}

describe("executeExecStep", () => {
  it("executes a simple command", async () => {
    const step: ExecStep = { id: "test", exec: "echo hello" };
    const result = await executeExecStep(step, makeContext());

    expect(result.success).toBe(true);
    expect(result.data?.stdout).toBe("hello");
    expect(result.data?.exitCode).toBe(0);
  });

  it("captures stderr", async () => {
    const step: ExecStep = { id: "test", exec: "echo err >&2" };
    const result = await executeExecStep(step, makeContext());

    expect(result.success).toBe(true);
    expect(result.data?.stderr).toBe("err");
  });

  it("fails on non-zero exit code", async () => {
    const step: ExecStep = { id: "test", exec: "exit 1" };
    const result = await executeExecStep(step, makeContext());

    expect(result.success).toBe(false);
    expect(result.data?.exitCode).toBe(1);
    expect(result.error).toContain("exited with code");
  });

  it("resolves environment variables in command", async () => {
    const step: ExecStep = { id: "test", exec: "echo $TEST_VAR" };
    const ctx = makeContext({
      env: { ...(process.env as Record<string, string>), TEST_VAR: "resolved" },
    });
    const result = await executeExecStep(step, ctx);

    expect(result.success).toBe(true);
    expect(result.data?.stdout).toBe("resolved");
  });

  it("resolves step output variables in command", async () => {
    const step: ExecStep = { id: "test", exec: "echo $prev.stdout" };
    const ctx = makeContext({
      previousOutputs: {
        prev: {
          success: true,
          data: { stdout: "from-prev", stderr: "", exitCode: 0 },
          timestamp: new Date().toISOString(),
        },
      },
    });
    const result = await executeExecStep(step, ctx);

    expect(result.success).toBe(true);
    expect(result.data?.stdout).toBe("from-prev");
  });

  it("respects timeout", async () => {
    const step: ExecStep = { id: "test", exec: "sleep 10", timeout: "1s" };
    const result = await executeExecStep(step, makeContext());

    expect(result.success).toBe(false);
    expect(result.error).toContain("killed");
  }, 10000);

  it("respects cwd", async () => {
    const step: ExecStep = { id: "test", exec: "pwd", cwd: "/tmp" };
    const result = await executeExecStep(step, makeContext());

    expect(result.success).toBe(true);
    expect(result.data?.stdout).toContain("/tmp");
  });

  it("handles command not found", async () => {
    const step: ExecStep = { id: "test", exec: "nonexistent_command_xyz" };
    const result = await executeExecStep(step, makeContext());

    expect(result.success).toBe(false);
  });
});
