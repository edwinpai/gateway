import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTaskStateTool } from "./task-state-tool.js";

const loadConfigMock = vi.fn();
vi.mock("../../config/config.js", () => ({
  loadConfig: () => loadConfigMock(),
}));

afterEach(() => {
  loadConfigMock.mockReset();
});

describe("task_state tool", () => {
  it("persists deterministic task state into the session store", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edwin-task-tool-"));
    const storePath = path.join(dir, "sessions.json");
    loadConfigMock.mockReturnValue({
      session: { store: storePath },
    });

    const tool = createTaskStateTool({ agentSessionKey: "agent:main:main" });
    const result = await tool.execute("call-1", {
      goal: "Sweep the desktop UI",
      definitionOfDone:
        "Entire Desktop UI has been clicked-through, tested, debugged, and verified.",
      criteria: ["all reachable views tested", "all fixes verified"],
      completeCriteria: ["all reachable views tested"],
      autoContinueEnabled: true,
      maxIterations: 20,
      delayMs: 750,
    });

    const details = result.details as { ok: boolean; activeTask?: Record<string, unknown> };
    expect(details.ok).toBe(true);
    expect(details.activeTask).toMatchObject({
      goal: "Sweep the desktop UI",
      definitionOfDone:
        "Entire Desktop UI has been clicked-through, tested, debugged, and verified.",
      criteria: ["all reachable views tested", "all fixes verified"],
      completedCriteria: ["all reachable views tested"],
      autoContinueEnabled: true,
      maxIterations: 20,
      delayMs: 750,
    });

    const stored = JSON.parse(await fs.readFile(storePath, "utf-8"));
    expect(stored["agent:main:main"].activeTask).toMatchObject({
      goal: "Sweep the desktop UI",
      completedCriteria: ["all reachable views tested"],
    });
  });
});

it("resets stale runtime fields when redefining an active task", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edwin-task-tool-reset-"));
  const storePath = path.join(dir, "sessions.json");
  await fs.writeFile(
    storePath,
    JSON.stringify({
      "agent:main:main": {
        sessionId: "sess-1",
        updatedAt: 1,
        activeTask: {
          id: "old-task",
          goal: "Old task",
          definitionOfDone: "Old done",
          criteria: ["old"],
          completedCriteria: ["old"],
          autoContinueEnabled: false,
          status: "done",
          active: false,
          iterationCount: 19,
          lastStopReason: "done",
          lastRunAt: 123,
          lastEvaluationReason: "Remaining criteria: old",
          blockedReason: "Old block",
        },
      },
    }),
    "utf-8",
  );
  loadConfigMock.mockReturnValue({
    session: { store: storePath },
  });

  const tool = createTaskStateTool({ agentSessionKey: "agent:main:main" });
  const result = await tool.execute("call-2", {
    taskId: "queue-work",
    goal: "Implement queue model",
    definitionOfDone: "Queued tasks advance automatically.",
    criteria: ["queue model", "scheduler"],
    status: "active",
    autoContinueEnabled: true,
    maxIterations: 25,
    delayMs: 1000,
  });

  const details = result.details as { ok: boolean; activeTask?: Record<string, unknown> };
  expect(details.ok).toBe(true);
  expect(details.activeTask).toMatchObject({
    id: "queue-work",
    goal: "Implement queue model",
    status: "active",
    autoContinueEnabled: true,
    active: true,
    criteria: ["queue model", "scheduler"],
    completedCriteria: [],
  });
  expect(details.activeTask).not.toHaveProperty("iterationCount");
  expect(details.activeTask).not.toHaveProperty("lastStopReason");
  expect(details.activeTask).not.toHaveProperty("lastRunAt");
  expect(details.activeTask).not.toHaveProperty("lastEvaluationReason");
  expect(details.activeTask).not.toHaveProperty("blockedReason");
});

it("updates the selected queued task instead of creating a duplicate when activeTask snapshot is missing", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edwin-task-tool-queue-"));
  const storePath = path.join(dir, "sessions.json");
  await fs.writeFile(
    storePath,
    JSON.stringify({
      "agent:main:main": {
        sessionId: "sess-queue",
        updatedAt: 1,
        tasks: [
          {
            id: "task-1",
            goal: "Diagnose and fix remaining task bug",
            definitionOfDone: "Task queue no longer duplicates current work.",
            criteria: ["root cause identified", "fix landed", "tests added"],
            completedCriteria: ["root cause identified"],
            autoContinueEnabled: true,
            status: "active",
            active: true,
          },
          {
            id: "task-2",
            goal: "Another queued task",
            criteria: ["later"],
            completedCriteria: [],
            autoContinueEnabled: true,
            status: "active",
            active: false,
          },
        ],
        activeTaskId: "task-1",
      },
    }),
    "utf-8",
  );
  loadConfigMock.mockReturnValue({
    session: { store: storePath },
  });

  const tool = createTaskStateTool({ agentSessionKey: "agent:main:main" });
  const result = await tool.execute("call-queue-1", {
    completeCriteria: ["fix landed"],
  });

  const details = result.details as { ok: boolean; activeTask?: Record<string, unknown> };
  expect(details.ok).toBe(true);
  expect(details.activeTask).toMatchObject({
    id: "task-1",
    goal: "Diagnose and fix remaining task bug",
    completedCriteria: ["root cause identified", "fix landed"],
  });

  const stored = JSON.parse(await fs.readFile(storePath, "utf-8"));
  const tasks = stored["agent:main:main"].tasks;
  expect(tasks).toHaveLength(2);
  expect(tasks.map((task: { id: string }) => task.id)).toEqual(["task-1", "task-2"]);
  expect(tasks.find((task: { id: string }) => task.id === "task-1")).toMatchObject({
    completedCriteria: ["root cause identified", "fix landed"],
  });
});

it("starts a fresh task when redefining a terminal selected task without an explicit id", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edwin-task-tool-terminal-"));
  const storePath = path.join(dir, "sessions.json");
  await fs.writeFile(
    storePath,
    JSON.stringify({
      "agent:main:main": {
        sessionId: "sess-terminal",
        updatedAt: 1,
        tasks: [
          {
            id: "docs-task",
            goal: "Old docs reconciliation",
            criteria: ["inventory", "commit"],
            completedCriteria: ["inventory", "commit"],
            autoContinueEnabled: false,
            status: "done",
            active: false,
            lastStopReason: "done",
          },
        ],
        activeTaskId: "docs-task",
      },
    }),
    "utf-8",
  );
  loadConfigMock.mockReturnValue({
    session: { store: storePath },
  });

  const tool = createTaskStateTool({ agentSessionKey: "agent:main:main" });
  const result = await tool.execute("call-terminal-1", {
    goal: "Fix task replay",
    criteria: ["find bug", "add tests"],
    autoContinueEnabled: true,
    status: "active",
  });

  const details = result.details as { ok: boolean; activeTask?: Record<string, unknown> };
  expect(details.ok).toBe(true);
  expect(details.activeTask).toMatchObject({
    goal: "Fix task replay",
    criteria: ["find bug", "add tests"],
    completedCriteria: [],
    autoContinueEnabled: true,
    status: "active",
    active: true,
  });
  expect(details.activeTask?.id).not.toBe("docs-task");

  const stored = JSON.parse(await fs.readFile(storePath, "utf-8"));
  const tasks = stored["agent:main:main"].tasks;
  expect(tasks).toHaveLength(2);
  expect(tasks.find((task: { id: string }) => task.id === "docs-task")).toMatchObject({
    status: "done",
    active: false,
    lastStopReason: "done",
  });
  expect(stored["agent:main:main"].activeTaskId).not.toBe("docs-task");
});
