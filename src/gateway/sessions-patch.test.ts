import { describe, expect, test } from "vitest";
import type { EdwinPAIConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions.js";
import { applySessionsPatchToStore } from "./sessions-patch.js";

describe("gateway sessions patch", () => {
  test("persists elevatedLevel=off (does not clear)", async () => {
    const store: Record<string, SessionEntry> = {};
    const res = await applySessionsPatchToStore({
      cfg: {} as EdwinPAIConfig,
      store,
      storeKey: "agent:main:main",
      patch: { elevatedLevel: "off" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.entry.elevatedLevel).toBe("off");
  });

  test("persists elevatedLevel=on", async () => {
    const store: Record<string, SessionEntry> = {};
    const res = await applySessionsPatchToStore({
      cfg: {} as EdwinPAIConfig,
      store,
      storeKey: "agent:main:main",
      patch: { elevatedLevel: "on" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.entry.elevatedLevel).toBe("on");
  });

  test("clears elevatedLevel when patch sets null", async () => {
    const store: Record<string, SessionEntry> = {
      "agent:main:main": { elevatedLevel: "off" } as SessionEntry,
    };
    const res = await applySessionsPatchToStore({
      cfg: {} as EdwinPAIConfig,
      store,
      storeKey: "agent:main:main",
      patch: { elevatedLevel: null },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.entry.elevatedLevel).toBeUndefined();
  });

  test("rejects invalid elevatedLevel values", async () => {
    const store: Record<string, SessionEntry> = {};
    const res = await applySessionsPatchToStore({
      cfg: {} as EdwinPAIConfig,
      store,
      storeKey: "agent:main:main",
      patch: { elevatedLevel: "maybe" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.error.message).toContain("invalid elevatedLevel");
  });

  test("clears auth overrides when model patch changes", async () => {
    const store: Record<string, SessionEntry> = {
      "agent:main:main": {
        sessionId: "sess",
        updatedAt: 1,
        providerOverride: "anthropic",
        modelOverride: "claude-opus-4-5",
        authProfileOverride: "anthropic:default",
        authProfileOverrideSource: "user",
        authProfileOverrideCompactionCount: 3,
      } as SessionEntry,
    };
    const res = await applySessionsPatchToStore({
      cfg: {} as EdwinPAIConfig,
      store,
      storeKey: "agent:main:main",
      patch: { model: "openai/gpt-5.2" },
      loadGatewayModelCatalog: async () => [{ provider: "openai", id: "gpt-5.2" }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.entry.providerOverride).toBe("openai");
    expect(res.entry.modelOverride).toBe("gpt-5.2");
    expect(res.entry.authProfileOverride).toBeUndefined();
    expect(res.entry.authProfileOverrideSource).toBeUndefined();
    expect(res.entry.authProfileOverrideCompactionCount).toBeUndefined();
  });

  test("persists auto-continue settings", async () => {
    const store: Record<string, SessionEntry> = {};
    const res = await applySessionsPatchToStore({
      cfg: {} as EdwinPAIConfig,
      store,
      storeKey: "agent:main:main",
      patch: {
        autoContinueEnabled: true,
        autoContinueMaxIterations: 12,
        autoContinueDelayMs: 1500,
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.entry.autoContinue).toMatchObject({
      enabled: true,
      maxIterations: 12,
      delayMs: 1500,
    });
  });

  test("disabling auto-continue clears active loop state", async () => {
    const store: Record<string, SessionEntry> = {
      "agent:main:main": {
        sessionId: "sess",
        updatedAt: 1,
        autoContinue: {
          enabled: true,
          active: true,
          iterationCount: 4,
          lastStopReason: "continue",
        },
      } as SessionEntry,
    };
    const res = await applySessionsPatchToStore({
      cfg: {} as EdwinPAIConfig,
      store,
      storeKey: "agent:main:main",
      patch: { autoContinueEnabled: false },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.entry.autoContinue).toMatchObject({
      enabled: false,
      active: false,
      iterationCount: 0,
    });
  });

  test("persists active task settings", async () => {
    const store: Record<string, SessionEntry> = {};
    const res = await applySessionsPatchToStore({
      cfg: {} as EdwinPAIConfig,
      store,
      storeKey: "agent:main:main",
      patch: {
        taskId: "desktop-sweep",
        taskGoal: "Completely sweep the edwin-desktop app",
        taskDefinitionOfDone:
          "Entire Desktop UI has been clicked-through, tested, debugged, and verified.",
        taskStatus: "active",
        taskAutoContinueEnabled: true,
        taskMaxIterations: 20,
        taskDelayMs: 750,
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.entry.activeTask).toMatchObject({
      id: "desktop-sweep",
      goal: "Completely sweep the edwin-desktop app",
      definitionOfDone:
        "Entire Desktop UI has been clicked-through, tested, debugged, and verified.",
      status: "active",
      autoContinueEnabled: true,
      maxIterations: 20,
      delayMs: 750,
    });
    expect(res.entry.tasks).toHaveLength(1);
    expect(res.entry.activeTaskId).toBe("desktop-sweep");
  });
});
