import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSessionStore, updateSessionStore, type SessionEntry } from "../../config/sessions.js";
import { clearSessionStoreCacheForTest } from "../../config/sessions/store.js";
import { updateSessionStoreAfterAgentRun } from "./session-store.js";

const tempDirs: string[] = [];

async function makeStorePath() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "edwin-session-store-test-"));
  tempDirs.push(dir);
  return path.join(dir, "sessions.json");
}

afterEach(async () => {
  clearSessionStoreCacheForTest();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("updateSessionStoreAfterAgentRun", () => {
  it("merges run metadata into the latest on-disk entry instead of clobbering task_state updates", async () => {
    const storePath = await makeStorePath();
    const sessionKey = "agent:main:main";
    const sessionId = "session-1";

    const staleSessionStore: Record<string, SessionEntry> = {
      [sessionKey]: {
        sessionId,
        updatedAt: 1,
      },
    };

    await updateSessionStore(storePath, (store) => {
      store[sessionKey] = {
        sessionId,
        updatedAt: 2,
        activeTaskId: "task-1",
        activeTask: {
          id: "task-1",
          goal: "Finish the docs cleanup",
          criteria: ["audit", "patch", "test"],
          completedCriteria: ["audit"],
          autoContinueEnabled: true,
          active: true,
          status: "active",
        },
        tasks: [
          {
            id: "task-1",
            goal: "Finish the docs cleanup",
            criteria: ["audit", "patch", "test"],
            completedCriteria: ["audit"],
            autoContinueEnabled: true,
            active: true,
            status: "active",
          },
        ],
      };
    });

    const next = await updateSessionStoreAfterAgentRun({
      cfg: {},
      sessionId,
      sessionKey,
      storePath,
      sessionStore: staleSessionStore,
      defaultProvider: "openai",
      defaultModel: "gpt-4o-mini",
      result: {
        payloads: [],
        meta: {
          aborted: false,
          agentMeta: {
            provider: "openai",
            model: "gpt-4o-mini",
            usage: { input: 10, output: 5, total: 15 },
          },
        },
      } as never,
    });

    expect(next.activeTask).toMatchObject({
      id: "task-1",
      completedCriteria: ["audit"],
      autoContinueEnabled: true,
      active: true,
      status: "active",
    });
    expect(next.tasks?.[0]).toMatchObject({
      id: "task-1",
      completedCriteria: ["audit"],
      autoContinueEnabled: true,
      active: true,
      status: "active",
    });
    expect(next.modelProvider).toBe("openai");
    expect(next.model).toBe("gpt-4o-mini");
    expect(next.inputTokens).toBe(10);
    expect(next.outputTokens).toBe(5);

    expect(staleSessionStore[sessionKey].activeTask).toMatchObject({ id: "task-1" });

    const persisted = loadSessionStore(storePath, { skipCache: true })[sessionKey];
    expect(persisted.activeTask).toMatchObject({ id: "task-1", completedCriteria: ["audit"] });
    expect(persisted.model).toBe("gpt-4o-mini");
  });
});
