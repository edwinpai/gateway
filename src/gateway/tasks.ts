import crypto from "node:crypto";
import type { SessionEntry, SessionTaskState } from "../config/sessions.js";
import type { ErrorShape } from "./protocol/index.js";
import { ErrorCodes, errorShape } from "./protocol/index.js";

function invalid(message: string): { ok: false; error: ErrorShape } {
  return { ok: false, error: errorShape(ErrorCodes.INVALID_REQUEST, message) };
}

function normalizeTaskId(raw: string | undefined): string {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed || crypto.randomUUID();
}

function getRemainingCriteria(task: SessionTaskState | undefined): string[] {
  const criteria = Array.isArray(task?.criteria)
    ? task.criteria.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const completed = new Set(
    Array.isArray(task?.completedCriteria)
      ? task.completedCriteria.map((item) => String(item).trim()).filter(Boolean)
      : [],
  );
  return criteria.filter((item) => !completed.has(item));
}

export function canTaskAutoRun(task: SessionTaskState | undefined): boolean {
  const resolved = reconcileTaskState(task);
  if (!resolved) {
    return false;
  }
  if (resolved.autoContinueEnabled !== true) {
    return false;
  }
  if ((resolved.status ?? "active") !== "active") {
    return false;
  }
  if (resolved.blockedReason?.trim() || resolved.needsUserReason?.trim()) {
    return false;
  }
  return getRemainingCriteria(resolved).length > 0;
}

export function reconcileTaskState(
  task: SessionTaskState | undefined,
): SessionTaskState | undefined {
  if (!task) {
    return undefined;
  }
  const next: SessionTaskState = { ...task, id: normalizeTaskId(task.id) };
  const criteria = Array.isArray(next.criteria)
    ? Array.from(new Set(next.criteria.map((v) => String(v).trim()).filter(Boolean)))
    : [];
  const completed = Array.isArray(next.completedCriteria)
    ? Array.from(new Set(next.completedCriteria.map((v) => String(v).trim()).filter(Boolean)))
    : [];
  const completedSet = new Set(completed);
  const validCompleted =
    criteria.length > 0 ? criteria.filter((item) => completedSet.has(item)) : completed;

  next.criteria = criteria;
  next.completedCriteria = validCompleted;

  if (next.autoContinueEnabled !== true) {
    next.active = false;
  }

  if (next.status === "done" || next.status === "blocked" || next.status === "needs_user") {
    next.active = false;
  }

  if (next.blockedReason?.trim()) {
    next.status = "blocked";
    next.active = false;
    next.lastStopReason = "blocked";
  } else if (next.needsUserReason?.trim()) {
    next.status = "needs_user";
    next.active = false;
    next.lastStopReason = "needs_user";
  } else if (criteria.length > 0 && validCompleted.length >= criteria.length) {
    next.status = "done";
    next.active = false;
    next.lastStopReason = "done";
  } else if (next.autoContinueEnabled) {
    next.status = "active";
  }

  return next;
}

function taskFingerprint(task: SessionTaskState): string | undefined {
  const goal = task.goal?.trim().toLowerCase();
  if (!goal) {
    return undefined;
  }
  const definitionOfDone = task.definitionOfDone?.trim().toLowerCase() ?? "";
  const criteria = Array.isArray(task.criteria)
    ? task.criteria.map((item) => item.trim().toLowerCase()).filter(Boolean)
    : [];
  return JSON.stringify({ goal, definitionOfDone, criteria });
}

function mergeDuplicateTasks(
  tasks: SessionTaskState[],
  preferredActiveId: string | undefined,
): SessionTaskState[] {
  const merged: SessionTaskState[] = [];
  const byFingerprint = new Map<string, number>();

  for (const task of tasks) {
    const fingerprint = taskFingerprint(task);
    if (!fingerprint) {
      merged.push(task);
      continue;
    }

    const existingIndex = byFingerprint.get(fingerprint);
    if (existingIndex === undefined) {
      byFingerprint.set(fingerprint, merged.length);
      merged.push(task);
      continue;
    }

    const existing = merged[existingIndex]!;
    const existingCompleted = existing.completedCriteria?.length ?? 0;
    const taskCompleted = task.completedCriteria?.length ?? 0;
    const preferTask =
      task.id === preferredActiveId ||
      (existing.id !== preferredActiveId && task.active === true && existing.active !== true) ||
      (existing.id !== preferredActiveId && taskCompleted > existingCompleted);
    const base = preferTask ? task : existing;
    const other = preferTask ? existing : task;
    const criteria = base.criteria ?? other.criteria ?? [];
    const completed = Array.from(
      new Set([...(other.completedCriteria ?? []), ...(base.completedCriteria ?? [])]),
    ).filter((item) => criteria.includes(item));

    merged[existingIndex] = reconcileTaskState({
      ...other,
      ...base,
      criteria,
      completedCriteria: completed,
      active: base.active === true,
    })!;
  }

  return merged;
}

export function reconcileTaskQueue(entry: SessionEntry): SessionEntry {
  const next: SessionEntry = { ...entry };
  let tasks = Array.isArray(entry.tasks)
    ? entry.tasks
        .map((task) => reconcileTaskState(task))
        .filter((task): task is SessionTaskState => Boolean(task))
    : [];

  if (tasks.length === 0 && entry.activeTask) {
    const migrated = reconcileTaskState(entry.activeTask);
    if (migrated) {
      tasks = [migrated];
    }
  }

  const requestedActiveId =
    (typeof entry.activeTaskId === "string" && entry.activeTaskId.trim()) ||
    (typeof entry.activeTask?.id === "string" && entry.activeTask.id.trim()) ||
    undefined;

  tasks = mergeDuplicateTasks(tasks, requestedActiveId);
  const activeTask =
    (requestedActiveId ? tasks.find((task) => task.id === requestedActiveId) : undefined) ??
    tasks[0];

  if (tasks.length === 0) {
    delete next.tasks;
    delete next.activeTaskId;
    delete next.activeTask;
    return next;
  }

  next.tasks = tasks;
  next.activeTaskId = activeTask?.id;
  next.activeTask = activeTask ? { ...activeTask } : undefined;
  return next;
}

export function listTasks(entry: SessionEntry | undefined): SessionTaskState[] {
  if (!entry) {
    return [];
  }
  const reconciled = reconcileTaskQueue(entry);
  return Array.isArray(reconciled.tasks) ? [...reconciled.tasks] : [];
}

export function getTask(
  entry: SessionEntry | undefined,
  taskId: string | undefined,
): SessionTaskState | undefined {
  const reconciled = entry ? reconcileTaskQueue(entry) : undefined;
  if (!reconciled) return undefined;
  const trimmed = typeof taskId === "string" ? taskId.trim() : "";
  if (!trimmed) return reconciled.activeTask;
  return (reconciled.tasks ?? []).find((task) => task.id === trimmed);
}

export function getActiveTask(entry: SessionEntry | undefined): SessionTaskState | undefined {
  return getTask(entry, entry?.activeTaskId ?? entry?.activeTask?.id);
}

function applyTaskSelection(
  entry: SessionEntry,
  taskId: string | undefined,
  opts?: { activateSelected?: boolean },
): SessionEntry {
  const reconciled = reconcileTaskQueue(entry);
  const selectedId = typeof taskId === "string" ? taskId.trim() : "";
  let selectedTask: SessionTaskState | undefined;
  const tasks = (reconciled.tasks ?? [])
    .map((task) => {
      const nextTask: SessionTaskState = { ...task };
      if (selectedId && nextTask.id === selectedId) {
        nextTask.active = opts?.activateSelected === true && canTaskAutoRun(nextTask);
      } else {
        nextTask.active = false;
      }
      const resolved = reconcileTaskState(nextTask);
      if (resolved?.id === selectedId) {
        selectedTask = resolved;
      }
      return resolved;
    })
    .filter((task): task is SessionTaskState => Boolean(task));

  if (!selectedTask) {
    selectedTask = tasks[0];
  }

  return reconcileTaskQueue({
    ...reconciled,
    tasks,
    activeTaskId: selectedTask?.id,
    activeTask: selectedTask,
  });
}

function upsertTask(
  entry: SessionEntry,
  task: SessionTaskState,
  opts?: { select?: boolean; activateSelected?: boolean },
): SessionEntry {
  const reconciled = reconcileTaskQueue(entry);
  const nextTask = reconcileTaskState(task) ?? { id: crypto.randomUUID() };
  const id = normalizeTaskId(nextTask.id);
  nextTask.id = id;
  const tasks = Array.isArray(reconciled.tasks) ? [...reconciled.tasks] : [];
  const index = tasks.findIndex((item) => item.id === id);
  if (index >= 0) {
    tasks[index] = nextTask;
  } else {
    tasks.push(nextTask);
  }

  if (opts?.select === false && reconciled.activeTaskId) {
    return applyTaskSelection({ ...reconciled, tasks }, reconciled.activeTaskId, {
      activateSelected: reconciled.activeTask?.active === true,
    });
  }

  return applyTaskSelection({ ...reconciled, tasks }, id, {
    activateSelected: opts?.activateSelected ?? nextTask.active === true,
  });
}

export function setActiveTask(
  entry: SessionEntry,
  task: SessionTaskState | undefined,
): SessionEntry {
  const reconciled = reconcileTaskQueue(entry);
  if (!task) {
    return applyTaskSelection(reconciled, reconciled.activeTaskId, {
      activateSelected: false,
    });
  }
  return upsertTask(reconciled, task, { select: true, activateSelected: task.active === true });
}

export function enqueueTask(
  entry: SessionEntry,
  task: SessionTaskState,
  opts?: { select?: boolean },
): SessionEntry {
  const reconciled = reconcileTaskQueue(entry);
  const shouldSelect =
    typeof opts?.select === "boolean" ? opts.select : !canTaskAutoRun(getActiveTask(reconciled));
  const nextTask: SessionTaskState = {
    ...task,
    active: shouldSelect ? task.active === true || canTaskAutoRun(task) : false,
  };
  return upsertTask(reconciled, nextTask, {
    select: shouldSelect,
    activateSelected: shouldSelect && canTaskAutoRun(nextTask),
  });
}

export function reconcileActiveTask(entry: SessionEntry): SessionEntry {
  return reconcileTaskQueue(entry);
}

export function findNextRunnableTask(
  entry: SessionEntry | undefined,
  opts?: { excludeTaskId?: string },
): SessionTaskState | undefined {
  const excluded = typeof opts?.excludeTaskId === "string" ? opts.excludeTaskId.trim() : "";
  return listTasks(entry).find((task) => task.id !== excluded && canTaskAutoRun(task));
}

export function advanceToNextRunnableTask(
  entry: SessionEntry,
  opts?: { excludeTaskId?: string },
): SessionEntry {
  const nextTask = findNextRunnableTask(entry, opts);
  if (!nextTask) {
    const reconciled = reconcileTaskQueue(entry);
    return applyTaskSelection(reconciled, reconciled.activeTaskId, { activateSelected: false });
  }
  return applyTaskSelection(entry, nextTask.id, { activateSelected: true });
}

export function shouldContinueTask(entry: SessionEntry | undefined): boolean {
  const task = getActiveTask(entry);
  if (!task) return false;
  if (task.active !== true) return false;
  return canTaskAutoRun(task);
}

export function shouldKickoffTask(entry: SessionEntry | undefined): boolean {
  const task = getActiveTask(entry);
  if (!shouldContinueTask(entry)) {
    return false;
  }
  if ((task?.iterationCount ?? 0) > 0) {
    return false;
  }
  if (typeof task?.lastRunAt === "number" && Number.isFinite(task.lastRunAt)) {
    return false;
  }
  return true;
}

export function applyTaskAction(params: {
  entry: SessionEntry;
  action: string;
  taskId?: string | null;
  taskGoal?: string | null;
  taskDefinitionOfDone?: string | null;
  taskCriteria?: string[] | null;
  criteria?: string[] | null;
  reason?: string | null;
  taskAutoContinueEnabled?: boolean | null;
  taskMaxIterations?: number | null;
  taskDelayMs?: number | null;
}): { ok: true; entry: SessionEntry } | { ok: false; error: ErrorShape } {
  const base = reconcileTaskQueue({ ...params.entry, updatedAt: Date.now() });
  const task: SessionTaskState = params.action === "start" ? {} : { ...(base.activeTask ?? {}) };
  const criteria = Array.isArray(params.criteria)
    ? Array.from(new Set(params.criteria.map((v) => String(v).trim()).filter(Boolean)))
    : undefined;

  switch (params.action) {
    case "start": {
      task.id = normalizeTaskId(params.taskId ?? undefined);
      if (params.taskGoal) task.goal = params.taskGoal;
      if (params.taskDefinitionOfDone) task.definitionOfDone = params.taskDefinitionOfDone;
      task.criteria = Array.isArray(params.taskCriteria)
        ? Array.from(new Set(params.taskCriteria.map((v) => String(v).trim()).filter(Boolean)))
        : [];
      task.completedCriteria = [];
      delete task.blockedReason;
      delete task.needsUserReason;
      delete task.lastEvaluationReason;
      delete task.lastStopReason;
      delete task.lastRunAt;
      task.iterationCount = 0;
      if (typeof params.taskAutoContinueEnabled === "boolean") {
        task.autoContinueEnabled = params.taskAutoContinueEnabled;
      }
      if (
        typeof params.taskMaxIterations === "number" &&
        Number.isFinite(params.taskMaxIterations)
      ) {
        task.maxIterations = Math.max(1, Math.floor(params.taskMaxIterations));
      }
      if (typeof params.taskDelayMs === "number" && Number.isFinite(params.taskDelayMs)) {
        task.delayMs = Math.max(0, Math.floor(params.taskDelayMs));
      }
      task.status = "active";
      task.active = task.autoContinueEnabled === true;
      break;
    }
    case "complete_criteria": {
      if (!criteria || criteria.length === 0) {
        return invalid("criteria required for complete_criteria");
      }
      const existingCriteria = Array.isArray(task.criteria) ? task.criteria : [];
      const missing = criteria.filter((item) => !existingCriteria.includes(item));
      if (missing.length > 0) {
        return invalid(`cannot complete unknown criteria: ${missing.join(", ")}`);
      }
      const current = Array.isArray(task.completedCriteria) ? task.completedCriteria : [];
      task.completedCriteria = Array.from(new Set([...current, ...criteria]));
      if (task.completedCriteria.length >= existingCriteria.length && existingCriteria.length > 0) {
        task.status = "done";
        task.active = false;
      }
      break;
    }
    case "block": {
      if (!params.reason?.trim()) {
        return invalid("reason required for block");
      }
      task.blockedReason = params.reason.trim();
      task.status = "blocked";
      task.active = false;
      break;
    }
    case "needs_user": {
      if (!params.reason?.trim()) {
        return invalid("reason required for needs_user");
      }
      task.needsUserReason = params.reason.trim();
      task.status = "needs_user";
      task.active = false;
      break;
    }
    case "clear_block": {
      delete task.blockedReason;
      if (task.status === "blocked") task.status = "active";
      break;
    }
    case "clear_needs_user": {
      delete task.needsUserReason;
      if (task.status === "needs_user") task.status = "active";
      break;
    }
    case "finish": {
      task.status = "done";
      task.active = false;
      if (Array.isArray(task.criteria) && task.criteria.length > 0) {
        task.completedCriteria = [...task.criteria];
      }
      break;
    }
    default:
      return invalid(`unsupported task action: ${params.action}`);
  }

  return { ok: true, entry: setActiveTask(base, task) };
}

export function patchTask(
  entry: SessionEntry,
  params: {
    taskId: string;
    taskGoal?: string | null;
    taskDefinitionOfDone?: string | null;
    taskCriteria?: string[] | null;
    taskCompletedCriteria?: string[] | null;
    taskBlockedReason?: string | null;
    taskNeedsUserReason?: string | null;
    taskStatus?: "active" | "done" | "blocked" | "needs_user" | null;
    taskAutoContinueEnabled?: boolean | null;
    taskMaxIterations?: number | null;
    taskDelayMs?: number | null;
  },
): { ok: true; entry: SessionEntry } | { ok: false; error: ErrorShape } {
  const reconciled = reconcileTaskQueue(entry);
  const task = getTask(reconciled, params.taskId);
  if (!task) {
    return invalid(`unknown task: ${params.taskId}`);
  }
  const nextTask: SessionTaskState = { ...task };
  if ("taskGoal" in params) {
    if (params.taskGoal === null) delete nextTask.goal;
    else if (params.taskGoal !== undefined) nextTask.goal = params.taskGoal.trim();
  }
  if ("taskDefinitionOfDone" in params) {
    if (params.taskDefinitionOfDone === null) delete nextTask.definitionOfDone;
    else if (params.taskDefinitionOfDone !== undefined)
      nextTask.definitionOfDone = params.taskDefinitionOfDone.trim();
  }
  if ("taskCriteria" in params) {
    if (params.taskCriteria === null) delete nextTask.criteria;
    else if (params.taskCriteria !== undefined)
      nextTask.criteria = params.taskCriteria.map((v) => String(v).trim()).filter(Boolean);
  }
  if ("taskCompletedCriteria" in params) {
    if (params.taskCompletedCriteria === null) delete nextTask.completedCriteria;
    else if (params.taskCompletedCriteria !== undefined)
      nextTask.completedCriteria = params.taskCompletedCriteria
        .map((v) => String(v).trim())
        .filter(Boolean);
  }
  if ("taskBlockedReason" in params) {
    if (params.taskBlockedReason === null) delete nextTask.blockedReason;
    else if (params.taskBlockedReason !== undefined)
      nextTask.blockedReason = params.taskBlockedReason.trim();
  }
  if ("taskNeedsUserReason" in params) {
    if (params.taskNeedsUserReason === null) delete nextTask.needsUserReason;
    else if (params.taskNeedsUserReason !== undefined)
      nextTask.needsUserReason = params.taskNeedsUserReason.trim();
  }
  if ("taskStatus" in params) {
    if (params.taskStatus === null) delete nextTask.status;
    else if (params.taskStatus !== undefined) nextTask.status = params.taskStatus;
  }
  if ("taskAutoContinueEnabled" in params) {
    if (params.taskAutoContinueEnabled === null) {
      delete nextTask.autoContinueEnabled;
      nextTask.active = false;
    } else if (params.taskAutoContinueEnabled !== undefined) {
      nextTask.autoContinueEnabled = params.taskAutoContinueEnabled;
      if (!params.taskAutoContinueEnabled) nextTask.active = false;
    }
  }
  if ("taskMaxIterations" in params) {
    if (params.taskMaxIterations === null) delete nextTask.maxIterations;
    else if (
      typeof params.taskMaxIterations === "number" &&
      Number.isFinite(params.taskMaxIterations)
    )
      nextTask.maxIterations = Math.max(1, Math.floor(params.taskMaxIterations));
  }
  if ("taskDelayMs" in params) {
    if (params.taskDelayMs === null) delete nextTask.delayMs;
    else if (typeof params.taskDelayMs === "number" && Number.isFinite(params.taskDelayMs))
      nextTask.delayMs = Math.max(0, Math.floor(params.taskDelayMs));
  }
  return {
    ok: true,
    entry: upsertTask(reconciled, nextTask, {
      select: reconciled.activeTaskId === nextTask.id,
      activateSelected: reconciled.activeTaskId === nextTask.id && canTaskAutoRun(nextTask),
    }),
  };
}

export function selectTask(
  entry: SessionEntry,
  taskId: string,
): { ok: true; entry: SessionEntry } | { ok: false; error: ErrorShape } {
  const reconciled = reconcileTaskQueue(entry);
  const task = getTask(reconciled, taskId);
  if (!task) {
    return invalid(`unknown task: ${taskId}`);
  }
  return {
    ok: true,
    entry: applyTaskSelection(reconciled, task.id, { activateSelected: canTaskAutoRun(task) }),
  };
}

export function deleteTask(
  entry: SessionEntry,
  taskId: string,
): { ok: true; entry: SessionEntry } | { ok: false; error: ErrorShape } {
  const reconciled = reconcileTaskQueue(entry);
  const trimmed = taskId.trim();
  const tasks = (reconciled.tasks ?? []).filter((task) => task.id !== trimmed);
  if (tasks.length === (reconciled.tasks ?? []).length) {
    return invalid(`unknown task: ${taskId}`);
  }
  const nextActiveId = reconciled.activeTaskId === trimmed ? tasks[0]?.id : reconciled.activeTaskId;
  return {
    ok: true,
    entry: applyTaskSelection({ ...reconciled, tasks }, nextActiveId, {
      activateSelected:
        nextActiveId === reconciled.activeTaskId && reconciled.activeTask?.active === true,
    }),
  };
}

export function reorderTasks(
  entry: SessionEntry,
  orderedIds: string[],
): { ok: true; entry: SessionEntry } | { ok: false; error: ErrorShape } {
  const reconciled = reconcileTaskQueue(entry);
  const tasks = reconciled.tasks ?? [];
  const normalizedIds = orderedIds.map((id) => id.trim()).filter(Boolean);
  if (normalizedIds.length !== tasks.length) {
    return invalid("taskIds must include every task exactly once");
  }
  const existingIds = tasks.map((task) => task.id ?? "").sort();
  const requestedIds = [...normalizedIds].sort();
  if (JSON.stringify(existingIds) !== JSON.stringify(requestedIds)) {
    return invalid("taskIds must include every task exactly once");
  }
  const byId = new Map(tasks.map((task) => [task.id, task] as const));
  return {
    ok: true,
    entry: applyTaskSelection(
      {
        ...reconciled,
        tasks: normalizedIds.map((id) => byId.get(id)!).filter(Boolean),
      },
      reconciled.activeTaskId,
      { activateSelected: reconciled.activeTask?.active === true },
    ),
  };
}
