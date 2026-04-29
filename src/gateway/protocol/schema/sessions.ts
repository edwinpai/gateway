import { Type } from "@sinclair/typebox";
import { NonEmptyString, SessionLabelString } from "./primitives.js";

export const SessionsListParamsSchema = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1 })),
    activeMinutes: Type.Optional(Type.Integer({ minimum: 1 })),
    includeGlobal: Type.Optional(Type.Boolean()),
    includeUnknown: Type.Optional(Type.Boolean()),
    /**
     * Read first 8KB of each session transcript to derive title from first user message.
     * Performs a file read per session - use `limit` to bound result set on large stores.
     */
    includeDerivedTitles: Type.Optional(Type.Boolean()),
    /**
     * Read last 16KB of each session transcript to extract most recent message preview.
     * Performs a file read per session - use `limit` to bound result set on large stores.
     */
    includeLastMessage: Type.Optional(Type.Boolean()),
    label: Type.Optional(SessionLabelString),
    spawnedBy: Type.Optional(NonEmptyString),
    agentId: Type.Optional(NonEmptyString),
    search: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const SessionsPreviewParamsSchema = Type.Object(
  {
    keys: Type.Array(NonEmptyString, { minItems: 1 }),
    limit: Type.Optional(Type.Integer({ minimum: 1 })),
    maxChars: Type.Optional(Type.Integer({ minimum: 20 })),
  },
  { additionalProperties: false },
);

export const SessionsResolveParamsSchema = Type.Object(
  {
    key: Type.Optional(NonEmptyString),
    sessionId: Type.Optional(NonEmptyString),
    label: Type.Optional(SessionLabelString),
    agentId: Type.Optional(NonEmptyString),
    spawnedBy: Type.Optional(NonEmptyString),
    includeGlobal: Type.Optional(Type.Boolean()),
    includeUnknown: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const SessionsPatchParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    label: Type.Optional(Type.Union([SessionLabelString, Type.Null()])),
    thinkingLevel: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    verboseLevel: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    reasoningLevel: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    responseUsage: Type.Optional(
      Type.Union([
        Type.Literal("off"),
        Type.Literal("tokens"),
        Type.Literal("full"),
        // Backward compat with older clients/stores.
        Type.Literal("on"),
        Type.Null(),
      ]),
    ),
    elevatedLevel: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    execHost: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    execSecurity: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    execAsk: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    execNode: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    model: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    spawnedBy: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    sendPolicy: Type.Optional(
      Type.Union([Type.Literal("allow"), Type.Literal("deny"), Type.Null()]),
    ),
    groupActivation: Type.Optional(
      Type.Union([Type.Literal("mention"), Type.Literal("always"), Type.Null()]),
    ),
    autoContinueEnabled: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
    autoContinueMaxIterations: Type.Optional(
      Type.Union([Type.Integer({ minimum: 1, maximum: 100 }), Type.Null()]),
    ),
    autoContinueDelayMs: Type.Optional(
      Type.Union([Type.Integer({ minimum: 0, maximum: 3_600_000 }), Type.Null()]),
    ),
    taskId: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    taskGoal: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    taskDefinitionOfDone: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    taskCriteria: Type.Optional(Type.Union([Type.Array(NonEmptyString), Type.Null()])),
    taskCompletedCriteria: Type.Optional(Type.Union([Type.Array(NonEmptyString), Type.Null()])),
    taskBlockedReason: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    taskNeedsUserReason: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    taskStatus: Type.Optional(
      Type.Union([
        Type.Literal("active"),
        Type.Literal("done"),
        Type.Literal("blocked"),
        Type.Literal("needs_user"),
        Type.Null(),
      ]),
    ),
    taskAutoContinueEnabled: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
    taskMaxIterations: Type.Optional(
      Type.Union([Type.Integer({ minimum: 1, maximum: 100 }), Type.Null()]),
    ),
    taskDelayMs: Type.Optional(
      Type.Union([Type.Integer({ minimum: 0, maximum: 3_600_000 }), Type.Null()]),
    ),
  },
  { additionalProperties: false },
);

export const SessionsResetParamsSchema = Type.Object(
  { key: NonEmptyString },
  { additionalProperties: false },
);

export const SessionsDeleteParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    deleteTranscript: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const SessionsCompactParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    maxLines: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const SessionsTaskGetParamsSchema = Type.Object(
  {
    key: NonEmptyString,
  },
  { additionalProperties: false },
);

export const SessionsTasksListParamsSchema = Type.Object(
  {
    key: NonEmptyString,
  },
  { additionalProperties: false },
);

export const SessionsTasksCreateParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    taskId: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    taskGoal: NonEmptyString,
    taskDefinitionOfDone: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    taskCriteria: Type.Optional(Type.Union([Type.Array(NonEmptyString), Type.Null()])),
    taskAutoContinueEnabled: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
    taskMaxIterations: Type.Optional(
      Type.Union([Type.Integer({ minimum: 1, maximum: 100 }), Type.Null()]),
    ),
    taskDelayMs: Type.Optional(
      Type.Union([Type.Integer({ minimum: 0, maximum: 3_600_000 }), Type.Null()]),
    ),
  },
  { additionalProperties: false },
);

export const SessionsTasksUpdateParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    taskId: NonEmptyString,
    taskGoal: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    taskDefinitionOfDone: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    taskCriteria: Type.Optional(Type.Union([Type.Array(NonEmptyString), Type.Null()])),
    taskCompletedCriteria: Type.Optional(Type.Union([Type.Array(NonEmptyString), Type.Null()])),
    taskBlockedReason: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    taskNeedsUserReason: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    taskStatus: Type.Optional(
      Type.Union([
        Type.Literal("active"),
        Type.Literal("done"),
        Type.Literal("blocked"),
        Type.Literal("needs_user"),
        Type.Null(),
      ]),
    ),
    taskAutoContinueEnabled: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
    taskMaxIterations: Type.Optional(
      Type.Union([Type.Integer({ minimum: 1, maximum: 100 }), Type.Null()]),
    ),
    taskDelayMs: Type.Optional(
      Type.Union([Type.Integer({ minimum: 0, maximum: 3_600_000 }), Type.Null()]),
    ),
  },
  { additionalProperties: false },
);

export const SessionsTasksDeleteParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    taskId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const SessionsTasksSelectParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    taskId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const SessionsTasksExecuteParamsSchema = Type.Object(
  {
    key: NonEmptyString,
  },
  { additionalProperties: false },
);

export const SessionsTasksReorderParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    taskIds: Type.Array(NonEmptyString, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export const SessionsTaskUpdateParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    taskId: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    taskGoal: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    taskDefinitionOfDone: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    taskCriteria: Type.Optional(Type.Union([Type.Array(NonEmptyString), Type.Null()])),
    taskCompletedCriteria: Type.Optional(Type.Union([Type.Array(NonEmptyString), Type.Null()])),
    taskBlockedReason: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    taskNeedsUserReason: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    taskStatus: Type.Optional(
      Type.Union([
        Type.Literal("active"),
        Type.Literal("done"),
        Type.Literal("blocked"),
        Type.Literal("needs_user"),
        Type.Null(),
      ]),
    ),
    taskAutoContinueEnabled: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
    taskMaxIterations: Type.Optional(
      Type.Union([Type.Integer({ minimum: 1, maximum: 100 }), Type.Null()]),
    ),
    taskDelayMs: Type.Optional(
      Type.Union([Type.Integer({ minimum: 0, maximum: 3_600_000 }), Type.Null()]),
    ),
  },
  { additionalProperties: false },
);

export const SessionsTaskActionParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    action: Type.Union([
      Type.Literal("start"),
      Type.Literal("complete_criteria"),
      Type.Literal("block"),
      Type.Literal("needs_user"),
      Type.Literal("clear_block"),
      Type.Literal("clear_needs_user"),
      Type.Literal("finish"),
    ]),
    taskId: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    taskGoal: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    taskDefinitionOfDone: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    taskCriteria: Type.Optional(Type.Union([Type.Array(NonEmptyString), Type.Null()])),
    criteria: Type.Optional(Type.Union([Type.Array(NonEmptyString), Type.Null()])),
    reason: Type.Optional(Type.Union([NonEmptyString, Type.Null()])),
    taskAutoContinueEnabled: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])),
    taskMaxIterations: Type.Optional(
      Type.Union([Type.Integer({ minimum: 1, maximum: 100 }), Type.Null()]),
    ),
    taskDelayMs: Type.Optional(
      Type.Union([Type.Integer({ minimum: 0, maximum: 3_600_000 }), Type.Null()]),
    ),
  },
  { additionalProperties: false },
);
