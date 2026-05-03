import { Type } from "@sinclair/typebox";
import crypto from "node:crypto";
import type { SessionTaskState } from "../../config/sessions/types.js";
import type { AnyAgentTool } from "./common.js";
import { loadConfig } from "../../config/config.js";
import {
  loadSessionStore,
  resolveStorePath,
  type SessionEntry,
  updateSessionStore,
} from "../../config/sessions.js";
import { getActiveTask, reconcileTaskQueue, setActiveTask } from "../../gateway/tasks.js";
import { resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import { jsonResult, readStringArrayParam, readStringParam } from "./common.js";

const TaskStateToolSchema = Type.Object({
  sessionKey: Type.Optional(Type.String()),
  taskId: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  goal: Type.Optional(Type.String()),
  definitionOfDone: Type.Optional(Type.String()),
  criteria: Type.Optional(Type.Array(Type.String())),
  completedCriteria: Type.Optional(Type.Array(Type.String())),
  completeCriteria: Type.Optional(Type.Array(Type.String())),
  blockedReason: Type.Optional(Type.String()),
  needsUserReason: Type.Optional(Type.String()),
  clearBlocked: Type.Optional(Type.Boolean()),
  clearNeedsUser: Type.Optional(Type.Boolean()),
  status: Type.Optional(
    Type.Union([
      Type.Literal("active"),
      Type.Literal("done"),
      Type.Literal("blocked"),
      Type.Literal("needs_user"),
    ]),
  ),
  autoContinueEnabled: Type.Optional(Type.Boolean()),
  maxIterations: Type.Optional(Type.Number({ minimum: 1 })),
  delayMs: Type.Optional(Type.Number({ minimum: 0 })),
});

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

function resetRuntimeState(task: Record<string, unknown>) {
  delete task.iterationCount;
  delete task.lastStopReason;
  delete task.lastRunAt;
  delete task.lastEvaluationReason;
}

function isTerminalTask(task: SessionTaskState | undefined): boolean {
  if (!task) {
    return false;
  }
  if (task.status === "done" || task.status === "blocked" || task.status === "needs_user") {
    return true;
  }
  return (
    task.active === false &&
    (task.lastStopReason === "done" ||
      task.lastStopReason === "blocked" ||
      task.lastStopReason === "needs_user" ||
      task.lastStopReason === "max_iterations")
  );
}

export function createTaskStateTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Task State",
    name: "task_state",
    description:
      "Create or update structured task progress for the current session. Use this to set task criteria, mark completed criteria, set blocked/needs-user reasons, and control deterministic task auto-continue.",
    parameters: TaskStateToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const cfg = loadConfig();
      const sessionKey =
        readStringParam(params, "sessionKey") ?? opts?.agentSessionKey ?? undefined;
      if (!sessionKey?.trim()) {
        throw new Error("sessionKey required");
      }

      const agentId = resolveAgentIdFromSessionKey(sessionKey);
      const storePath = resolveStorePath(cfg.session?.store, { agentId });
      const store = loadSessionStore(storePath);
      const existing = (store[sessionKey] ?? {
        sessionId: crypto.randomUUID(),
        updatedAt: Date.now(),
      }) as SessionEntry;
      const reconciledExisting = reconcileTaskQueue(existing);
      const currentActiveTask = getActiveTask(reconciledExisting);
      const taskId = readStringParam(params, "taskId");
      const title = readStringParam(params, "title");
      const goal = readStringParam(params, "goal");
      const definitionOfDone = readStringParam(params, "definitionOfDone");
      const criteria = readStringArrayParam(params, "criteria");
      const completedCriteria = readStringArrayParam(params, "completedCriteria");
      const completeCriteria = readStringArrayParam(params, "completeCriteria");
      const blockedReason = readStringParam(params, "blockedReason", { allowEmpty: true });
      const needsUserReason = readStringParam(params, "needsUserReason", { allowEmpty: true });
      const status = readStringParam(params, "status");
      const redefiningTask = Boolean(taskId || title || goal || definitionOfDone || criteria);
      const rewritingProgress = Boolean(completedCriteria || completeCriteria);
      const shouldStartFreshTask = !taskId && redefiningTask && isTerminalTask(currentActiveTask);
      const next: SessionEntry = {
        ...reconciledExisting,
        sessionId: reconciledExisting.sessionId,
        updatedAt: Date.now(),
        activeTask: shouldStartFreshTask ? {} : { ...currentActiveTask },
      };

      const activeTask = next.activeTask ?? {};

      if (redefiningTask || rewritingProgress || status === "active") {
        resetRuntimeState(activeTask);
      }

      if (taskId) {
        activeTask.id = taskId;
      }
      if (title && !activeTask.goal) {
        activeTask.goal = title;
      }
      if (goal) {
        activeTask.goal = goal;
      }
      if (definitionOfDone) {
        activeTask.definitionOfDone = definitionOfDone;
      }
      if (criteria) {
        activeTask.criteria = unique(criteria);
      }
      if (completedCriteria) {
        activeTask.completedCriteria = unique(completedCriteria);
      }
      if (completeCriteria) {
        const prior = Array.isArray(activeTask.completedCriteria)
          ? activeTask.completedCriteria
          : [];
        activeTask.completedCriteria = unique([...prior, ...completeCriteria]);
      }
      if (blockedReason !== undefined) {
        activeTask.blockedReason = blockedReason || undefined;
      }
      if (needsUserReason !== undefined) {
        activeTask.needsUserReason = needsUserReason || undefined;
      }
      if (params.clearBlocked === true || status === "active") {
        delete activeTask.blockedReason;
      }
      if (params.clearNeedsUser === true || status === "active") {
        delete activeTask.needsUserReason;
      }
      if (
        status === "active" ||
        status === "done" ||
        status === "blocked" ||
        status === "needs_user"
      ) {
        activeTask.status = status;
      }
      if (typeof params.autoContinueEnabled === "boolean") {
        activeTask.autoContinueEnabled = params.autoContinueEnabled;
      }
      if (typeof params.maxIterations === "number" && Number.isFinite(params.maxIterations)) {
        activeTask.maxIterations = Math.max(1, Math.floor(params.maxIterations));
      }
      if (typeof params.delayMs === "number" && Number.isFinite(params.delayMs)) {
        activeTask.delayMs = Math.max(0, Math.floor(params.delayMs));
      }
      if (status === "active") {
        activeTask.active = activeTask.autoContinueEnabled === true;
      }
      if (status === "done" || status === "blocked" || status === "needs_user") {
        activeTask.active = false;
      }

      const reconciled = setActiveTask(next, activeTask);
      store[sessionKey] = reconciled;
      await updateSessionStore(storePath, (draft) => {
        draft[sessionKey] = reconciled;
      });

      return jsonResult({
        ok: true,
        sessionKey,
        activeTask: reconciled.activeTask,
      });
    },
  };
}
