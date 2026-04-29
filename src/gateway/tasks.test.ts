import { describe, expect, test } from "vitest";
import type { SessionEntry } from "../config/sessions.js";
import {
  applyTaskAction,
  advanceToNextRunnableTask,
  canTaskAutoRun,
  deleteTask,
  enqueueTask,
  getActiveTask,
  getTask,
  patchTask,
  reconcileActiveTask,
  reconcileTaskQueue,
  reorderTasks,
  selectTask,
  shouldContinueTask,
  shouldKickoffTask,
} from "./tasks.js";

describe("gateway task actions", () => {
  test("reconciles completed criteria to known criteria", () => {
    const entry = reconcileActiveTask({
      sessionId: "sess",
      updatedAt: 1,
      activeTask: {
        criteria: ["a", "b"],
        completedCriteria: ["a", "ghost"],
        autoContinueEnabled: true,
      },
    } as SessionEntry);
    expect(entry.activeTask?.completedCriteria).toEqual(["a"]);
    expect(entry.activeTask?.status).toBe("active");
  });

  test("blocks completing unknown criteria", () => {
    const res = applyTaskAction({
      entry: {
        sessionId: "sess",
        updatedAt: 1,
        activeTask: { criteria: ["a"] },
      } as SessionEntry,
      action: "complete_criteria",
      criteria: ["b"],
    });
    expect(res.ok).toBe(false);
  });

  test("finishes when all criteria are completed", () => {
    const res = applyTaskAction({
      entry: {
        sessionId: "sess",
        updatedAt: 1,
        activeTask: { criteria: ["a", "b"], completedCriteria: ["a"] },
      } as SessionEntry,
      action: "complete_criteria",
      criteria: ["b"],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.entry.activeTask).toMatchObject({
      status: "done",
      active: false,
      completedCriteria: ["a", "b"],
    });
  });
});

test("kicks off a fresh active auto-continue task", () => {
  expect(
    shouldKickoffTask({
      sessionId: "sess",
      updatedAt: 1,
      activeTask: {
        goal: "Sweep desktop",
        criteria: ["a", "b"],
        completedCriteria: [],
        autoContinueEnabled: true,
        active: true,
        status: "active",
      },
    } as SessionEntry),
  ).toBe(true);
});

test("does not kick off tasks that already ran once", () => {
  expect(
    shouldKickoffTask({
      sessionId: "sess",
      updatedAt: 1,
      activeTask: {
        goal: "Sweep desktop",
        criteria: ["a"],
        completedCriteria: [],
        autoContinueEnabled: true,
        active: true,
        status: "active",
        iterationCount: 1,
        lastRunAt: Date.now(),
      },
    } as SessionEntry),
  ).toBe(false);
});

test("reconcile forces terminal tasks inactive and stopped", () => {
  const entry = reconcileActiveTask({
    sessionId: "sess",
    updatedAt: 1,
    activeTask: {
      criteria: ["a"],
      completedCriteria: ["a"],
      autoContinueEnabled: false,
      active: true,
      status: "done",
      lastStopReason: "continue",
    },
  } as SessionEntry);
  expect(entry.activeTask).toMatchObject({
    status: "done",
    active: false,
    lastStopReason: "done",
  });
});

test("shouldContinueTask rejects done or disabled tasks", () => {
  expect(
    shouldContinueTask({
      sessionId: "sess",
      updatedAt: 1,
      activeTask: {
        criteria: ["a"],
        completedCriteria: ["a"],
        autoContinueEnabled: true,
        active: true,
        status: "active",
      },
    } as SessionEntry),
  ).toBe(false);

  expect(
    shouldContinueTask({
      sessionId: "sess",
      updatedAt: 1,
      activeTask: {
        criteria: ["a"],
        completedCriteria: [],
        autoContinueEnabled: false,
        active: true,
        status: "active",
      },
    } as SessionEntry),
  ).toBe(false);
});

test("migrates legacy activeTask into queued task state", () => {
  const entry = reconcileTaskQueue({
    sessionId: "sess",
    updatedAt: 1,
    activeTask: {
      goal: "Legacy task",
      criteria: ["a"],
      completedCriteria: [],
      autoContinueEnabled: true,
      active: true,
      status: "active",
    },
  } as SessionEntry);
  expect(entry.tasks).toHaveLength(1);
  expect(entry.activeTaskId).toBe(entry.tasks?.[0]?.id);
  expect(getActiveTask(entry)).toMatchObject({
    goal: "Legacy task",
    status: "active",
  });
});

test("start action creates a fresh queued task and resets stale runtime fields", () => {
  const res = applyTaskAction({
    entry: {
      sessionId: "sess",
      updatedAt: 1,
      activeTask: {
        id: "old",
        goal: "Old task",
        criteria: ["old"],
        completedCriteria: ["old"],
        autoContinueEnabled: false,
        active: false,
        status: "done",
        iterationCount: 9,
        lastStopReason: "done",
        lastRunAt: 123,
      },
    } as SessionEntry,
    action: "start",
    taskId: "new-task",
    taskGoal: "New task",
    taskDefinitionOfDone: "Ship queue model",
    taskCriteria: ["a", "b"],
    taskAutoContinueEnabled: true,
    taskMaxIterations: 12,
    taskDelayMs: 500,
  });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.entry.tasks).toHaveLength(2);
  expect(res.entry.activeTaskId).toBe("new-task");
  expect(res.entry.activeTask).toMatchObject({
    id: "new-task",
    goal: "New task",
    definitionOfDone: "Ship queue model",
    criteria: ["a", "b"],
    completedCriteria: [],
    autoContinueEnabled: true,
    status: "active",
    active: true,
    iterationCount: 0,
  });
  expect(res.entry.activeTask?.lastRunAt).toBeUndefined();
  expect(res.entry.activeTask?.lastStopReason).toBeUndefined();
});

test("can select and update a non-active queued task", () => {
  const base = reconcileTaskQueue({
    sessionId: "sess",
    updatedAt: 1,
    tasks: [
      { id: "a", goal: "Task A", status: "active", autoContinueEnabled: true, active: true },
      { id: "b", goal: "Task B", status: "active", autoContinueEnabled: false, active: false },
    ],
    activeTaskId: "a",
  } as SessionEntry);
  const selected = selectTask(base, "b");
  expect(selected.ok).toBe(true);
  if (!selected.ok) return;
  expect(selected.entry.activeTaskId).toBe("b");
  const updated = patchTask(selected.entry, {
    taskId: "b",
    taskGoal: "Task Bee",
    taskCompletedCriteria: [],
  });
  expect(updated.ok).toBe(true);
  if (!updated.ok) return;
  expect(getTask(updated.entry, "b")).toMatchObject({ goal: "Task Bee" });
  expect(updated.entry.activeTaskId).toBe("b");
});

test("can reorder and delete queued tasks", () => {
  const base = reconcileTaskQueue({
    sessionId: "sess",
    updatedAt: 1,
    tasks: [
      { id: "a", goal: "Task A" },
      { id: "b", goal: "Task B" },
      { id: "c", goal: "Task C" },
    ],
    activeTaskId: "b",
  } as SessionEntry);
  const reordered = reorderTasks(base, ["c", "b", "a"]);
  expect(reordered.ok).toBe(true);
  if (!reordered.ok) return;
  expect((reordered.entry.tasks ?? []).map((task) => task.id)).toEqual(["c", "b", "a"]);
  const deleted = deleteTask(reordered.entry, "b");
  expect(deleted.ok).toBe(true);
  if (!deleted.ok) return;
  expect((deleted.entry.tasks ?? []).map((task) => task.id)).toEqual(["c", "a"]);
  expect(deleted.entry.activeTaskId).toBe("c");
});

test("enqueueTask preserves current runnable task and queues the new one", () => {
  const entry = enqueueTask(
    {
      sessionId: "sess",
      updatedAt: 1,
      tasks: [
        {
          id: "a",
          goal: "Task A",
          criteria: ["a"],
          completedCriteria: [],
          autoContinueEnabled: true,
          status: "active",
          active: true,
        },
      ],
      activeTaskId: "a",
    } as SessionEntry,
    {
      id: "b",
      goal: "Task B",
      criteria: ["b"],
      completedCriteria: [],
      autoContinueEnabled: true,
      status: "active",
    },
  );
  expect(entry.activeTaskId).toBe("a");
  expect(getTask(entry, "b")).toMatchObject({ active: false, status: "active" });
});

test("advanceToNextRunnableTask promotes the next queued runnable task", () => {
  const entry = advanceToNextRunnableTask(
    {
      sessionId: "sess",
      updatedAt: 1,
      tasks: [
        {
          id: "a",
          goal: "Task A",
          criteria: ["a"],
          completedCriteria: ["a"],
          autoContinueEnabled: true,
          status: "done",
          active: false,
        },
        {
          id: "b",
          goal: "Task B",
          criteria: ["b"],
          completedCriteria: [],
          autoContinueEnabled: true,
          status: "active",
          active: false,
        },
      ],
      activeTaskId: "a",
    } as SessionEntry,
    { excludeTaskId: "a" },
  );
  expect(entry.activeTaskId).toBe("b");
  expect(getActiveTask(entry)).toMatchObject({ id: "b", active: true });
  expect(shouldContinueTask(entry)).toBe(true);
});

test("selectTask activates queued runnable tasks", () => {
  const selected = selectTask(
    {
      sessionId: "sess",
      updatedAt: 1,
      tasks: [
        {
          id: "a",
          goal: "Task A",
          criteria: ["a"],
          completedCriteria: [],
          autoContinueEnabled: true,
          status: "active",
          active: true,
        },
        {
          id: "b",
          goal: "Task B",
          criteria: ["b"],
          completedCriteria: [],
          autoContinueEnabled: true,
          status: "active",
          active: false,
        },
      ],
      activeTaskId: "a",
    } as SessionEntry,
    "b",
  );
  expect(selected.ok).toBe(true);
  if (!selected.ok) return;
  expect(getActiveTask(selected.entry)).toMatchObject({ id: "b", active: true });
  expect(getTask(selected.entry, "a")).toMatchObject({ active: false });
});

test("canTaskAutoRun rejects queued tasks that are already complete", () => {
  expect(
    canTaskAutoRun({
      id: "done",
      criteria: ["a"],
      completedCriteria: ["a"],
      autoContinueEnabled: true,
      status: "active",
    }),
  ).toBe(false);
});
