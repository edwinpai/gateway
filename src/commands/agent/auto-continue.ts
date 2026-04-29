import type {
  SessionAutoContinueState,
  SessionAutoContinueStopReason,
  SessionTaskState,
  SessionTaskStatus,
} from "../../config/sessions/types.js";

const DONE_RE = /\b(done|completed|complete|finished|all set|resolved)\b/i;
const BLOCKED_RE = /\b(blocked|can't continue|cannot continue|stuck|hard blocker)\b/i;
const NEEDS_USER_RE =
  /\b(need your input|need you to|waiting on you|please (confirm|approve|provide)|can you|could you)\b/i;

export const AUTO_CONTINUE_PROMPT =
  "Continue the active task. If done, summarize completion. If blocked or you need user input, report that instead of continuing.";

export function resolveAutoContinueState(
  state: SessionAutoContinueState | undefined,
): Required<
  Pick<
    SessionAutoContinueState,
    "enabled" | "maxIterations" | "delayMs" | "iterationCount" | "active"
  >
> &
  Pick<SessionAutoContinueState, "lastStopReason" | "lastRunAt"> {
  return {
    enabled: state?.enabled === true,
    maxIterations: Math.max(1, Math.min(100, state?.maxIterations ?? 8)),
    delayMs: Math.max(0, Math.min(3_600_000, state?.delayMs ?? 1000)),
    iterationCount: Math.max(0, state?.iterationCount ?? 0),
    active: state?.active === true,
    lastStopReason: state?.lastStopReason,
    lastRunAt: state?.lastRunAt,
  };
}

export function classifyAutoContinueStopReason(text: string): SessionAutoContinueStopReason {
  const cleaned = text.trim();
  if (!cleaned) {
    return "continue";
  }
  if (BLOCKED_RE.test(cleaned)) {
    return "blocked";
  }
  if (NEEDS_USER_RE.test(cleaned)) {
    return "needs_user";
  }
  if (DONE_RE.test(cleaned)) {
    return "done";
  }
  return "continue";
}

export function getAutoContinueText(payloads: Array<{ text?: string | null }> | undefined): string {
  return (payloads ?? [])
    .map((payload) => (typeof payload?.text === "string" ? payload.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function nextAutoContinueState(params: {
  state: SessionAutoContinueState | undefined;
  stopReason: SessionAutoContinueStopReason;
  ranAt?: number;
}): SessionAutoContinueState {
  const current = resolveAutoContinueState(params.state);
  const nextCount = current.iterationCount + 1;
  return {
    enabled: current.enabled,
    maxIterations: current.maxIterations,
    delayMs: current.delayMs,
    iterationCount: nextCount,
    active: params.stopReason === "continue" && nextCount < current.maxIterations,
    lastStopReason:
      params.stopReason === "continue" && nextCount >= current.maxIterations
        ? "max_iterations"
        : params.stopReason,
    lastRunAt: params.ranAt ?? Date.now(),
  };
}

export function resolveTaskState(
  state: SessionTaskState | undefined,
): Required<
  Pick<
    SessionTaskState,
    "autoContinueEnabled" | "maxIterations" | "delayMs" | "iterationCount" | "active"
  >
> &
  Pick<
    SessionTaskState,
    | "id"
    | "goal"
    | "definitionOfDone"
    | "status"
    | "lastStopReason"
    | "lastRunAt"
    | "criteria"
    | "completedCriteria"
    | "blockedReason"
    | "needsUserReason"
    | "lastEvaluationReason"
  > {
  return {
    id: state?.id,
    goal: state?.goal,
    definitionOfDone: state?.definitionOfDone,
    status: state?.status,
    autoContinueEnabled: state?.autoContinueEnabled === true,
    maxIterations: Math.max(1, Math.min(100, state?.maxIterations ?? 8)),
    delayMs: Math.max(0, Math.min(3_600_000, state?.delayMs ?? 1000)),
    iterationCount: Math.max(0, state?.iterationCount ?? 0),
    active: state?.active === true,
    lastStopReason: state?.lastStopReason,
    lastRunAt: state?.lastRunAt,
    criteria: Array.isArray(state?.criteria)
      ? state.criteria.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0,
        )
      : [],
    completedCriteria: Array.isArray(state?.completedCriteria)
      ? state.completedCriteria.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0,
        )
      : [],
    blockedReason: state?.blockedReason,
    needsUserReason: state?.needsUserReason,
    lastEvaluationReason: state?.lastEvaluationReason,
  };
}

export function mapStopReasonToTaskStatus(
  reason: SessionAutoContinueStopReason,
): SessionTaskStatus {
  if (reason === "done") return "done";
  if (reason === "blocked") return "blocked";
  if (reason === "needs_user") return "needs_user";
  return "active";
}

export function buildTaskContinuationPrompt(task: SessionTaskState | undefined): string {
  const resolved = resolveTaskState(task);
  const remaining = getRemainingTaskCriteria(resolved);
  const lines = [
    "Continue the active task.",
    resolved.goal ? `TASK_GOAL: ${resolved.goal}` : undefined,
    resolved.definitionOfDone ? `TASK_DEFINITION_OF_DONE: ${resolved.definitionOfDone}` : undefined,
    resolved.criteria.length > 0 ? `TASK_CRITERIA_TOTAL: ${resolved.criteria.length}` : undefined,
    remaining.length > 0 ? `TASK_CRITERIA_REMAINING: ${remaining.join(" | ")}` : undefined,
    "Update the task state deterministically via session metadata as criteria are completed or blocked.",
  ];
  return lines.filter(Boolean).join("\n");
}

export function getRemainingTaskCriteria(task: SessionTaskState | undefined): string[] {
  const resolved = resolveTaskState(task);
  const completed = new Set(resolved.completedCriteria.map((item) => item.trim()));
  return resolved.criteria.filter((item) => !completed.has(item.trim()));
}

export function evaluateTaskState(task: SessionTaskState | undefined): {
  stopReason: SessionAutoContinueStopReason;
  reason: string;
  status: SessionTaskStatus;
} {
  const resolved = resolveTaskState(task);
  if (resolved.blockedReason?.trim()) {
    return {
      stopReason: "blocked",
      reason: resolved.blockedReason.trim(),
      status: "blocked",
    };
  }
  if (resolved.needsUserReason?.trim()) {
    return {
      stopReason: "needs_user",
      reason: resolved.needsUserReason.trim(),
      status: "needs_user",
    };
  }
  const remaining = getRemainingTaskCriteria(resolved);
  if (remaining.length === 0) {
    return {
      stopReason: "done",
      reason:
        resolved.definitionOfDone?.trim() ||
        resolved.goal?.trim() ||
        "All task criteria have been completed.",
      status: "done",
    };
  }
  return {
    stopReason: "continue",
    reason: `Remaining criteria: ${remaining.join("; ")}`,
    status: "active",
  };
}

export function nextTaskState(params: {
  state: SessionTaskState | undefined;
  stopReason: SessionAutoContinueStopReason;
  ranAt?: number;
  evaluationReason?: string;
}): SessionTaskState {
  const current = resolveTaskState(params.state);
  const nextCount = current.iterationCount + 1;
  const hitMax = params.stopReason === "continue" && nextCount >= current.maxIterations;
  return {
    id: current.id,
    goal: current.goal,
    definitionOfDone: current.definitionOfDone,
    criteria: current.criteria,
    completedCriteria: current.completedCriteria,
    blockedReason: current.blockedReason,
    needsUserReason: current.needsUserReason,
    lastEvaluationReason: params.evaluationReason,
    status: hitMax ? "blocked" : mapStopReasonToTaskStatus(params.stopReason),
    autoContinueEnabled: current.autoContinueEnabled,
    maxIterations: current.maxIterations,
    delayMs: current.delayMs,
    iterationCount: nextCount,
    active: params.stopReason === "continue" && !hitMax,
    lastStopReason: hitMax ? "max_iterations" : params.stopReason,
    lastRunAt: params.ranAt ?? Date.now(),
  };
}
