import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { GatewayRequestHandlers } from "./types.js";
import { abortEmbeddedPiRun, waitForEmbeddedPiRunEnd } from "../../agents/pi-embedded.js";
import { stopSubagentsForRequester } from "../../auto-reply/reply/abort.js";
import { clearSessionQueues } from "../../auto-reply/reply/queue.js";
import { agentCommand } from "../../commands/agent.js";
import { buildTaskContinuationPrompt } from "../../commands/agent/auto-continue.js";
import { loadConfig } from "../../config/config.js";
import {
  loadSessionStore,
  snapshotSessionOrigin,
  resolveMainSessionKey,
  type SessionEntry,
  updateSessionStore,
} from "../../config/sessions.js";
import { logSessionStateChange } from "../../logging/diagnostic.js";
import { defaultRuntime } from "../../runtime.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateSessionsCompactParams,
  validateSessionsDeleteParams,
  validateSessionsListParams,
  validateSessionsPatchParams,
  validateSessionsTasksListParams,
  validateSessionsTasksCreateParams,
  validateSessionsTasksUpdateParams,
  validateSessionsTasksDeleteParams,
  validateSessionsTasksExecuteParams,
  validateSessionsTasksSelectParams,
  validateSessionsTasksReorderParams,
  validateSessionsTaskGetParams,
  validateSessionsTaskUpdateParams,
  validateSessionsTaskActionParams,
  validateSessionsPreviewParams,
  validateSessionsResetParams,
  validateSessionsResolveParams,
} from "../protocol/index.js";
import {
  archiveFileOnDisk,
  listSessionsFromStore,
  loadCombinedSessionStoreForGateway,
  loadSessionEntry,
  readSessionPreviewItemsFromTranscript,
  resolveGatewaySessionStoreTarget,
  resolveSessionTranscriptCandidates,
  type SessionsPatchResult,
  type SessionsPreviewEntry,
  type SessionsPreviewResult,
} from "../session-utils.js";
import { applySessionsPatchToStore } from "../sessions-patch.js";
import { resolveSessionKeyFromResolveParams } from "../sessions-resolve.js";
import {
  advanceToNextRunnableTask,
  applyTaskAction,
  canTaskAutoRun,
  deleteTask,
  enqueueTask,
  getActiveTask,
  listTasks,
  patchTask,
  reconcileTaskQueue,
  reorderTasks,
  selectTask,
  shouldContinueTask,
  shouldKickoffTask,
} from "../tasks.js";

const scheduledTaskKickoffs = new Set<string>();

function taskQueueSnapshot(entry: SessionEntry | undefined) {
  const reconciled = entry ? reconcileTaskQueue(entry) : undefined;
  return {
    activeTaskId: reconciled?.activeTaskId,
    activeTask: reconciled?.activeTask,
    tasks: listTasks(reconciled),
  };
}

function loadLatestTaskKickoffEntry(sessionKey: string): SessionEntry | undefined {
  const cfg = loadConfig();
  const target = resolveGatewaySessionStoreTarget({ cfg, key: sessionKey });
  const store = loadSessionStore(target.storePath);
  return (
    target.storeKeys.map((candidate) => store[candidate]).find(Boolean) ??
    store[target.canonicalKey]
  );
}

function scheduleTaskKickoff(
  params: {
    sessionKey: string;
    entry: SessionEntry | undefined;
    context: import("./types.js").GatewayRequestContext;
  },
  opts?: { allowResume?: boolean; immediate?: boolean; reason?: string },
) {
  const sessionKey = params.sessionKey.trim();
  const entry = params.entry ? advanceToNextRunnableTask(params.entry) : undefined;
  const ready = opts?.allowResume ? shouldContinueTask(entry) : shouldKickoffTask(entry);
  if (!sessionKey || !entry || !ready) {
    return;
  }
  if (scheduledTaskKickoffs.has(sessionKey)) {
    return;
  }
  scheduledTaskKickoffs.add(sessionKey);
  const activeTask = reconcileTaskQueue(entry).activeTask;
  const delayMs = opts?.immediate ? 0 : Math.max(0, activeTask?.delayMs ?? 0);
  logSessionStateChange({
    sessionId: entry.sessionId,
    sessionKey,
    state: "continuing",
    reason:
      opts?.reason ?? (opts?.allowResume ? "task_execute_requested" : "task_kickoff_scheduled"),
  });
  const timer = setTimeout(() => {
    const latestStored = loadLatestTaskKickoffEntry(sessionKey);
    const latestEntry = latestStored ? advanceToNextRunnableTask(latestStored) : undefined;
    const stillReady = opts?.allowResume
      ? shouldContinueTask(latestEntry)
      : shouldKickoffTask(latestEntry);
    const latestActiveTask = latestEntry ? reconcileTaskQueue(latestEntry).activeTask : undefined;

    if (!latestEntry || !stillReady || !latestActiveTask) {
      logSessionStateChange({
        sessionId: latestStored?.sessionId ?? entry.sessionId,
        sessionKey,
        state: "idle",
        reason: "task_kickoff_skipped_stale",
      });
      scheduledTaskKickoffs.delete(sessionKey);
      return;
    }

    void agentCommand(
      {
        message: buildTaskContinuationPrompt(latestActiveTask),
        sessionKey,
        runId: randomUUID(),
      },
      defaultRuntime,
      params.context.deps,
    )
      .catch((err) => {
        defaultRuntime.error?.(`Task kickoff failed for ${sessionKey}: ${String(err)}`);
        logSessionStateChange({
          sessionId: latestEntry.sessionId,
          sessionKey,
          state: "idle",
          reason: "task_kickoff_failed",
        });
      })
      .finally(() => {
        scheduledTaskKickoffs.delete(sessionKey);
      });
  }, delayMs);
  timer.unref?.();
}

export const sessionsHandlers: GatewayRequestHandlers = {
  "sessions.list": ({ params, respond }) => {
    if (!validateSessionsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.list params: ${formatValidationErrors(validateSessionsListParams.errors)}`,
        ),
      );
      return;
    }
    const p = params;
    const cfg = loadConfig();
    const { storePath, store } = loadCombinedSessionStoreForGateway(cfg);
    const result = listSessionsFromStore({
      cfg,
      storePath,
      store,
      opts: p,
    });
    respond(true, result, undefined);
  },
  "sessions.preview": ({ params, respond }) => {
    if (!validateSessionsPreviewParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.preview params: ${formatValidationErrors(
            validateSessionsPreviewParams.errors,
          )}`,
        ),
      );
      return;
    }
    const p = params;
    const keysRaw = Array.isArray(p.keys) ? p.keys : [];
    const keys = keysRaw
      .map((key) => String(key ?? "").trim())
      .filter(Boolean)
      .slice(0, 64);
    const limit =
      typeof p.limit === "number" && Number.isFinite(p.limit) ? Math.max(1, p.limit) : 12;
    const maxChars =
      typeof p.maxChars === "number" && Number.isFinite(p.maxChars)
        ? Math.max(20, p.maxChars)
        : 240;

    if (keys.length === 0) {
      respond(true, { ts: Date.now(), previews: [] } satisfies SessionsPreviewResult, undefined);
      return;
    }

    const cfg = loadConfig();
    const storeCache = new Map<string, Record<string, SessionEntry>>();
    const previews: SessionsPreviewEntry[] = [];

    for (const key of keys) {
      try {
        const target = resolveGatewaySessionStoreTarget({ cfg, key });
        const store = storeCache.get(target.storePath) ?? loadSessionStore(target.storePath);
        storeCache.set(target.storePath, store);
        const entry =
          target.storeKeys.map((candidate) => store[candidate]).find(Boolean) ??
          store[target.canonicalKey];
        if (!entry?.sessionId) {
          previews.push({ key, status: "missing", items: [] });
          continue;
        }
        const items = readSessionPreviewItemsFromTranscript(
          entry.sessionId,
          target.storePath,
          entry.sessionFile,
          target.agentId,
          limit,
          maxChars,
        );
        previews.push({
          key,
          status: items.length > 0 ? "ok" : "empty",
          items,
        });
      } catch {
        previews.push({ key, status: "error", items: [] });
      }
    }

    respond(true, { ts: Date.now(), previews } satisfies SessionsPreviewResult, undefined);
  },
  // Task RPCs are intentionally split:
  // - sessions.tasks.* => queue-wide CRUD, ordering, selection, and explicit execution
  // - sessions.task.* => mutations on the currently selected active task state
  "sessions.tasks.list": ({ params, respond }) => {
    if (!validateSessionsTasksListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.tasks.list params: ${formatValidationErrors(validateSessionsTasksListParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const key = String(params.key ?? "").trim();
    const target = resolveGatewaySessionStoreTarget({ cfg, key });
    const store = loadSessionStore(target.storePath);
    const entry =
      target.storeKeys.map((candidate) => store[candidate]).find(Boolean) ??
      store[target.canonicalKey];
    respond(true, { ok: true, key: target.canonicalKey, ...taskQueueSnapshot(entry) }, undefined);
  },
  "sessions.tasks.create": async ({ params, respond, context }) => {
    if (!validateSessionsTasksCreateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.tasks.create params: ${formatValidationErrors(validateSessionsTasksCreateParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const key = String(params.key ?? "").trim();
    const target = resolveGatewaySessionStoreTarget({ cfg, key });
    const storePath = target.storePath;
    const applied = await updateSessionStore(storePath, async (store) => {
      const primaryKey = target.storeKeys[0] ?? key;
      const existingKey = target.storeKeys.find((candidate) => store[candidate]);
      if (existingKey && existingKey !== primaryKey && !store[primaryKey]) {
        store[primaryKey] = store[existingKey];
        delete store[existingKey];
      }
      const current = store[primaryKey] ?? { sessionId: randomUUID(), updatedAt: Date.now() };
      const selectedTask = getActiveTask(current);
      const created = enqueueTask(
        { ...current, updatedAt: Date.now() },
        {
          id: typeof params.taskId === "string" ? params.taskId : undefined,
          goal: typeof params.taskGoal === "string" ? params.taskGoal : undefined,
          definitionOfDone:
            typeof params.taskDefinitionOfDone === "string"
              ? params.taskDefinitionOfDone
              : undefined,
          criteria: Array.isArray(params.taskCriteria) ? params.taskCriteria.map(String) : [],
          completedCriteria: [],
          status: "active",
          autoContinueEnabled:
            typeof params.taskAutoContinueEnabled === "boolean"
              ? params.taskAutoContinueEnabled
              : true,
          maxIterations:
            typeof params.taskMaxIterations === "number" ? params.taskMaxIterations : undefined,
          delayMs: typeof params.taskDelayMs === "number" ? params.taskDelayMs : undefined,
          iterationCount: 0,
          active: !canTaskAutoRun(selectedTask),
        },
        { select: !canTaskAutoRun(selectedTask) },
      );
      store[primaryKey] = created;
      return { ok: true, entry: created };
    });
    if (!applied.ok) {
      respond(false, undefined, applied.error);
      return;
    }
    respond(
      true,
      { ok: true, key: target.canonicalKey, ...taskQueueSnapshot(applied.entry) },
      undefined,
    );
    scheduleTaskKickoff({ sessionKey: target.canonicalKey, entry: applied.entry, context });
  },
  "sessions.tasks.update": async ({ params, respond, context }) => {
    if (!validateSessionsTasksUpdateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.tasks.update params: ${formatValidationErrors(validateSessionsTasksUpdateParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const key = String(params.key ?? "").trim();
    const target = resolveGatewaySessionStoreTarget({ cfg, key });
    const storePath = target.storePath;
    const applied = await updateSessionStore(storePath, async (store) => {
      const primaryKey = target.storeKeys[0] ?? key;
      const existingKey = target.storeKeys.find((candidate) => store[candidate]);
      if (existingKey && existingKey !== primaryKey && !store[primaryKey]) {
        store[primaryKey] = store[existingKey];
        delete store[existingKey];
      }
      const current = store[primaryKey] ?? { sessionId: randomUUID(), updatedAt: Date.now() };
      const result = patchTask(current, {
        taskId: String(params.taskId ?? ""),
        taskGoal: typeof params.taskGoal === "string" ? params.taskGoal : null,
        taskDefinitionOfDone:
          typeof params.taskDefinitionOfDone === "string" ? params.taskDefinitionOfDone : null,
        taskCriteria: Array.isArray(params.taskCriteria) ? params.taskCriteria.map(String) : null,
        taskCompletedCriteria: Array.isArray(params.taskCompletedCriteria)
          ? params.taskCompletedCriteria.map(String)
          : null,
        taskBlockedReason:
          typeof params.taskBlockedReason === "string" ? params.taskBlockedReason : null,
        taskNeedsUserReason:
          typeof params.taskNeedsUserReason === "string" ? params.taskNeedsUserReason : null,
        taskStatus: params.taskStatus ?? null,
        taskAutoContinueEnabled:
          typeof params.taskAutoContinueEnabled === "boolean"
            ? params.taskAutoContinueEnabled
            : null,
        taskMaxIterations:
          typeof params.taskMaxIterations === "number" ? params.taskMaxIterations : null,
        taskDelayMs: typeof params.taskDelayMs === "number" ? params.taskDelayMs : null,
      });
      if (!result.ok) return result;
      store[primaryKey] = result.entry;
      return result;
    });
    if (!applied.ok) {
      respond(false, undefined, applied.error);
      return;
    }
    respond(
      true,
      { ok: true, key: target.canonicalKey, ...taskQueueSnapshot(applied.entry) },
      undefined,
    );
    scheduleTaskKickoff({ sessionKey: target.canonicalKey, entry: applied.entry, context });
  },
  "sessions.tasks.execute": async ({ params, respond, context }) => {
    if (!validateSessionsTasksExecuteParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.tasks.execute params: ${formatValidationErrors(validateSessionsTasksExecuteParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const key = String(params.key ?? "").trim();
    const target = resolveGatewaySessionStoreTarget({ cfg, key });
    const storePath = target.storePath;
    const applied = await updateSessionStore(storePath, async (store) => {
      const primaryKey = target.storeKeys[0] ?? key;
      const existingKey = target.storeKeys.find((candidate) => store[candidate]);
      if (existingKey && existingKey !== primaryKey && !store[primaryKey]) {
        store[primaryKey] = store[existingKey];
        delete store[existingKey];
      }
      const current = store[primaryKey] ?? { sessionId: randomUUID(), updatedAt: Date.now() };
      const executable = advanceToNextRunnableTask(current);
      if (!shouldContinueTask(executable)) {
        return {
          ok: false,
          error: errorShape(
            ErrorCodes.INVALID_REQUEST,
            "no runnable queued tasks for this session",
          ),
        };
      }
      store[primaryKey] = executable;
      return { ok: true, entry: executable };
    });
    if (!applied.ok) {
      respond(false, undefined, applied.error);
      return;
    }
    respond(
      true,
      { ok: true, key: target.canonicalKey, ...taskQueueSnapshot(applied.entry) },
      undefined,
    );
    scheduleTaskKickoff(
      { sessionKey: target.canonicalKey, entry: applied.entry, context },
      { allowResume: true, immediate: true, reason: "task_execute_requested" },
    );
  },
  "sessions.tasks.delete": async ({ params, respond }) => {
    if (!validateSessionsTasksDeleteParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.tasks.delete params: ${formatValidationErrors(validateSessionsTasksDeleteParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const key = String(params.key ?? "").trim();
    const target = resolveGatewaySessionStoreTarget({ cfg, key });
    const storePath = target.storePath;
    const applied = await updateSessionStore(storePath, async (store) => {
      const primaryKey = target.storeKeys[0] ?? key;
      const existingKey = target.storeKeys.find((candidate) => store[candidate]);
      if (existingKey && existingKey !== primaryKey && !store[primaryKey]) {
        store[primaryKey] = store[existingKey];
        delete store[existingKey];
      }
      const current = store[primaryKey] ?? { sessionId: randomUUID(), updatedAt: Date.now() };
      const result = deleteTask(current, String(params.taskId ?? ""));
      if (!result.ok) return result;
      store[primaryKey] = result.entry;
      return result;
    });
    if (!applied.ok) {
      respond(false, undefined, applied.error);
      return;
    }
    respond(
      true,
      { ok: true, key: target.canonicalKey, ...taskQueueSnapshot(applied.entry) },
      undefined,
    );
  },
  "sessions.tasks.select": async ({ params, respond, context }) => {
    if (!validateSessionsTasksSelectParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.tasks.select params: ${formatValidationErrors(validateSessionsTasksSelectParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const key = String(params.key ?? "").trim();
    const target = resolveGatewaySessionStoreTarget({ cfg, key });
    const storePath = target.storePath;
    const applied = await updateSessionStore(storePath, async (store) => {
      const primaryKey = target.storeKeys[0] ?? key;
      const existingKey = target.storeKeys.find((candidate) => store[candidate]);
      if (existingKey && existingKey !== primaryKey && !store[primaryKey]) {
        store[primaryKey] = store[existingKey];
        delete store[existingKey];
      }
      const current = store[primaryKey] ?? { sessionId: randomUUID(), updatedAt: Date.now() };
      const result = selectTask(current, String(params.taskId ?? ""));
      if (!result.ok) return result;
      store[primaryKey] = result.entry;
      return result;
    });
    if (!applied.ok) {
      respond(false, undefined, applied.error);
      return;
    }
    respond(
      true,
      { ok: true, key: target.canonicalKey, ...taskQueueSnapshot(applied.entry) },
      undefined,
    );
    scheduleTaskKickoff({ sessionKey: target.canonicalKey, entry: applied.entry, context });
  },
  "sessions.tasks.reorder": async ({ params, respond }) => {
    if (!validateSessionsTasksReorderParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.tasks.reorder params: ${formatValidationErrors(validateSessionsTasksReorderParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const key = String(params.key ?? "").trim();
    const target = resolveGatewaySessionStoreTarget({ cfg, key });
    const storePath = target.storePath;
    const applied = await updateSessionStore(storePath, async (store) => {
      const primaryKey = target.storeKeys[0] ?? key;
      const existingKey = target.storeKeys.find((candidate) => store[candidate]);
      if (existingKey && existingKey !== primaryKey && !store[primaryKey]) {
        store[primaryKey] = store[existingKey];
        delete store[existingKey];
      }
      const current = store[primaryKey] ?? { sessionId: randomUUID(), updatedAt: Date.now() };
      const result = reorderTasks(
        current,
        Array.isArray(params.taskIds) ? params.taskIds.map(String) : [],
      );
      if (!result.ok) return result;
      store[primaryKey] = result.entry;
      return result;
    });
    if (!applied.ok) {
      respond(false, undefined, applied.error);
      return;
    }
    respond(
      true,
      { ok: true, key: target.canonicalKey, ...taskQueueSnapshot(applied.entry) },
      undefined,
    );
  },

  "sessions.resolve": ({ params, respond }) => {
    if (!validateSessionsResolveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.resolve params: ${formatValidationErrors(validateSessionsResolveParams.errors)}`,
        ),
      );
      return;
    }
    const p = params;
    const cfg = loadConfig();

    const resolved = resolveSessionKeyFromResolveParams({ cfg, p });
    if (!resolved.ok) {
      respond(false, undefined, resolved.error);
      return;
    }
    respond(true, { ok: true, key: resolved.key }, undefined);
  },
  "sessions.task.get": ({ params, respond }) => {
    if (!validateSessionsTaskGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.task.get params: ${formatValidationErrors(validateSessionsTaskGetParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const key = String(params.key ?? "").trim();
    const target = resolveGatewaySessionStoreTarget({ cfg, key });
    const store = loadSessionStore(target.storePath);
    const entry =
      target.storeKeys.map((candidate) => store[candidate]).find(Boolean) ??
      store[target.canonicalKey];
    const reconciled = entry ? reconcileTaskQueue(entry) : undefined;
    respond(
      true,
      { ok: true, key: target.canonicalKey, activeTask: reconciled?.activeTask },
      undefined,
    );
  },
  "sessions.task.update": async ({ params, respond, context }) => {
    if (!validateSessionsTaskUpdateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.task.update params: ${formatValidationErrors(validateSessionsTaskUpdateParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const key = String(params.key ?? "").trim();
    const target = resolveGatewaySessionStoreTarget({ cfg, key });
    const storePath = target.storePath;
    const applied = await updateSessionStore(storePath, async (store) => {
      const primaryKey = target.storeKeys[0] ?? key;
      const existingKey = target.storeKeys.find((candidate) => store[candidate]);
      if (existingKey && existingKey !== primaryKey && !store[primaryKey]) {
        store[primaryKey] = store[existingKey];
        delete store[existingKey];
      }
      return await applySessionsPatchToStore({
        cfg,
        store,
        storeKey: primaryKey,
        patch: params,
        loadGatewayModelCatalog: context.loadGatewayModelCatalog,
      });
    });
    if (!applied.ok) {
      respond(false, undefined, applied.error);
      return;
    }
    respond(
      true,
      { ok: true, key: target.canonicalKey, activeTask: applied.entry.activeTask },
      undefined,
    );
    scheduleTaskKickoff({ sessionKey: target.canonicalKey, entry: applied.entry, context });
  },
  "sessions.task.action": async ({ params, respond }) => {
    if (!validateSessionsTaskActionParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.task.action params: ${formatValidationErrors(validateSessionsTaskActionParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const key = String(params.key ?? "").trim();
    const target = resolveGatewaySessionStoreTarget({ cfg, key });
    const storePath = target.storePath;
    const applied = await updateSessionStore(storePath, async (store) => {
      const primaryKey = target.storeKeys[0] ?? key;
      const existingKey = target.storeKeys.find((candidate) => store[candidate]);
      if (existingKey && existingKey != primaryKey && !store[primaryKey]) {
        store[primaryKey] = store[existingKey];
        delete store[existingKey];
      }
      const current = store[primaryKey] ?? { sessionId: randomUUID(), updatedAt: Date.now() };
      const result = applyTaskAction({
        entry: current,
        action: String(params.action ?? ""),
        taskId: typeof params.taskId === "string" ? params.taskId : null,
        taskGoal: typeof params.taskGoal === "string" ? params.taskGoal : null,
        taskDefinitionOfDone:
          typeof params.taskDefinitionOfDone === "string" ? params.taskDefinitionOfDone : null,
        taskCriteria: Array.isArray(params.taskCriteria) ? params.taskCriteria.map(String) : null,
        criteria: Array.isArray(params.criteria) ? params.criteria.map(String) : null,
        reason: typeof params.reason === "string" ? params.reason : null,
        taskAutoContinueEnabled:
          typeof params.taskAutoContinueEnabled === "boolean"
            ? params.taskAutoContinueEnabled
            : null,
        taskMaxIterations:
          typeof params.taskMaxIterations === "number" ? params.taskMaxIterations : null,
        taskDelayMs: typeof params.taskDelayMs === "number" ? params.taskDelayMs : null,
      });
      if (!result.ok) {
        return result;
      }
      store[primaryKey] = result.entry;
      return result;
    });
    if (!applied.ok) {
      respond(false, undefined, applied.error);
      return;
    }
    respond(
      true,
      { ok: true, key: target.canonicalKey, activeTask: applied.entry.activeTask },
      undefined,
    );
    scheduleTaskKickoff({ sessionKey: target.canonicalKey, entry: applied.entry, context });
  },
  "sessions.patch": async ({ params, respond, context }) => {
    if (!validateSessionsPatchParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.patch params: ${formatValidationErrors(validateSessionsPatchParams.errors)}`,
        ),
      );
      return;
    }
    const p = params;
    const key = String(p.key ?? "").trim();
    if (!key) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "key required"));
      return;
    }

    const cfg = loadConfig();
    const target = resolveGatewaySessionStoreTarget({ cfg, key });
    const storePath = target.storePath;
    const applied = await updateSessionStore(storePath, async (store) => {
      const primaryKey = target.storeKeys[0] ?? key;
      const existingKey = target.storeKeys.find((candidate) => store[candidate]);
      if (existingKey && existingKey !== primaryKey && !store[primaryKey]) {
        store[primaryKey] = store[existingKey];
        delete store[existingKey];
      }
      return await applySessionsPatchToStore({
        cfg,
        store,
        storeKey: primaryKey,
        patch: p,
        loadGatewayModelCatalog: context.loadGatewayModelCatalog,
      });
    });
    if (!applied.ok) {
      respond(false, undefined, applied.error);
      return;
    }
    const result: SessionsPatchResult = {
      ok: true,
      path: storePath,
      key: target.canonicalKey,
      entry: applied.entry,
    };
    respond(true, result, undefined);
  },
  "sessions.reset": async ({ params, respond }) => {
    if (!validateSessionsResetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.reset params: ${formatValidationErrors(validateSessionsResetParams.errors)}`,
        ),
      );
      return;
    }
    const p = params;
    const key = String(p.key ?? "").trim();
    if (!key) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "key required"));
      return;
    }

    const cfg = loadConfig();
    const target = resolveGatewaySessionStoreTarget({ cfg, key });
    const storePath = target.storePath;
    const next = await updateSessionStore(storePath, (store) => {
      const primaryKey = target.storeKeys[0] ?? key;
      const existingKey = target.storeKeys.find((candidate) => store[candidate]);
      if (existingKey && existingKey !== primaryKey && !store[primaryKey]) {
        store[primaryKey] = store[existingKey];
        delete store[existingKey];
      }
      const entry = store[primaryKey];
      const now = Date.now();
      const nextEntry: SessionEntry = {
        sessionId: randomUUID(),
        updatedAt: now,
        systemSent: false,
        abortedLastRun: false,
        thinkingLevel: entry?.thinkingLevel,
        verboseLevel: entry?.verboseLevel,
        reasoningLevel: entry?.reasoningLevel,
        responseUsage: entry?.responseUsage,
        model: entry?.model,
        contextTokens: entry?.contextTokens,
        sendPolicy: entry?.sendPolicy,
        label: entry?.label,
        origin: snapshotSessionOrigin(entry),
        lastChannel: entry?.lastChannel,
        lastTo: entry?.lastTo,
        skillsSnapshot: entry?.skillsSnapshot,
        // Reset token counts to 0 on session reset (#1523)
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      };
      store[primaryKey] = nextEntry;
      return nextEntry;
    });
    respond(true, { ok: true, key: target.canonicalKey, entry: next }, undefined);
  },
  "sessions.delete": async ({ params, respond }) => {
    if (!validateSessionsDeleteParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.delete params: ${formatValidationErrors(validateSessionsDeleteParams.errors)}`,
        ),
      );
      return;
    }
    const p = params;
    const key = String(p.key ?? "").trim();
    if (!key) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "key required"));
      return;
    }

    const cfg = loadConfig();
    const mainKey = resolveMainSessionKey(cfg);
    const target = resolveGatewaySessionStoreTarget({ cfg, key });
    if (target.canonicalKey === mainKey) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `Cannot delete the main session (${mainKey}).`),
      );
      return;
    }

    const deleteTranscript = typeof p.deleteTranscript === "boolean" ? p.deleteTranscript : true;

    const storePath = target.storePath;
    const { entry } = loadSessionEntry(key);
    const sessionId = entry?.sessionId;
    const existed = Boolean(entry);
    const queueKeys = new Set<string>(target.storeKeys);
    queueKeys.add(target.canonicalKey);
    if (sessionId) {
      queueKeys.add(sessionId);
    }
    clearSessionQueues([...queueKeys]);
    stopSubagentsForRequester({ cfg, requesterSessionKey: target.canonicalKey });
    if (sessionId) {
      abortEmbeddedPiRun(sessionId);
      const ended = await waitForEmbeddedPiRunEnd(sessionId, 15_000);
      if (!ended) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.UNAVAILABLE,
            `Session ${key} is still active; try again in a moment.`,
          ),
        );
        return;
      }
    }
    await updateSessionStore(storePath, (store) => {
      const primaryKey = target.storeKeys[0] ?? key;
      const existingKey = target.storeKeys.find((candidate) => store[candidate]);
      if (existingKey && existingKey !== primaryKey && !store[primaryKey]) {
        store[primaryKey] = store[existingKey];
        delete store[existingKey];
      }
      if (store[primaryKey]) {
        delete store[primaryKey];
      }
    });

    const archived: string[] = [];
    if (deleteTranscript && sessionId) {
      for (const candidate of resolveSessionTranscriptCandidates(
        sessionId,
        storePath,
        entry?.sessionFile,
        target.agentId,
      )) {
        if (!fs.existsSync(candidate)) {
          continue;
        }
        try {
          archived.push(archiveFileOnDisk(candidate, "deleted"));
        } catch {
          // Best-effort.
        }
      }
    }

    respond(true, { ok: true, key: target.canonicalKey, deleted: existed, archived }, undefined);
  },
  "sessions.compact": async ({ params, respond }) => {
    if (!validateSessionsCompactParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.compact params: ${formatValidationErrors(validateSessionsCompactParams.errors)}`,
        ),
      );
      return;
    }
    const p = params;
    const key = String(p.key ?? "").trim();
    if (!key) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "key required"));
      return;
    }

    const maxLines =
      typeof p.maxLines === "number" && Number.isFinite(p.maxLines)
        ? Math.max(1, Math.floor(p.maxLines))
        : 400;

    const cfg = loadConfig();
    const target = resolveGatewaySessionStoreTarget({ cfg, key });
    const storePath = target.storePath;
    // Lock + read in a short critical section; transcript work happens outside.
    const compactTarget = await updateSessionStore(storePath, (store) => {
      const primaryKey = target.storeKeys[0] ?? key;
      const existingKey = target.storeKeys.find((candidate) => store[candidate]);
      if (existingKey && existingKey !== primaryKey && !store[primaryKey]) {
        store[primaryKey] = store[existingKey];
        delete store[existingKey];
      }
      return { entry: store[primaryKey], primaryKey };
    });
    const entry = compactTarget.entry;
    const sessionId = entry?.sessionId;
    if (!sessionId) {
      respond(
        true,
        {
          ok: true,
          key: target.canonicalKey,
          compacted: false,
          reason: "no sessionId",
        },
        undefined,
      );
      return;
    }

    const filePath = resolveSessionTranscriptCandidates(
      sessionId,
      storePath,
      entry?.sessionFile,
      target.agentId,
    ).find((candidate) => fs.existsSync(candidate));
    if (!filePath) {
      respond(
        true,
        {
          ok: true,
          key: target.canonicalKey,
          compacted: false,
          reason: "no transcript",
        },
        undefined,
      );
      return;
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length <= maxLines) {
      respond(
        true,
        {
          ok: true,
          key: target.canonicalKey,
          compacted: false,
          kept: lines.length,
        },
        undefined,
      );
      return;
    }

    const archived = archiveFileOnDisk(filePath, "bak");
    const keptLines = lines.slice(-maxLines);
    fs.writeFileSync(filePath, `${keptLines.join("\n")}\n`, "utf-8");

    await updateSessionStore(storePath, (store) => {
      const entryKey = compactTarget.primaryKey;
      const entryToUpdate = store[entryKey];
      if (!entryToUpdate) {
        return;
      }
      delete entryToUpdate.inputTokens;
      delete entryToUpdate.outputTokens;
      delete entryToUpdate.totalTokens;
      entryToUpdate.updatedAt = Date.now();
    });

    respond(
      true,
      {
        ok: true,
        key: target.canonicalKey,
        compacted: true,
        archived,
        kept: keptLines.length,
      },
      undefined,
    );
  },
};
