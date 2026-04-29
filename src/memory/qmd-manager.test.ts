import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const spawn = vi.fn((_cmd: string, _args: string[]) => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = new EventEmitter() as {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
      emit: (event: string, code: number) => boolean;
    };
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = () => {
      child.emit("close", 0);
    };
    setImmediate(() => {
      stdout.emit("data", "");
      stderr.emit("data", "");
      child.emit("close", 0);
    });
    return child;
  });
  return { ...actual, spawn };
});

import { spawn as mockedSpawn } from "node:child_process";
import type { EdwinPAIConfig } from "../config/config.js";
import { resolveMemoryBackendConfig } from "./backend-config.js";
import { QmdMemoryManager } from "./qmd-manager.js";

const spawnMock = mockedSpawn as unknown as vi.Mock;

describe("QmdMemoryManager", () => {
  let tmpRoot: string;
  let workspaceDir: string;
  let stateDir: string;
  let cfg: EdwinPAIConfig;
  const agentId = "main";

  beforeEach(async () => {
    spawnMock.mockClear();
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "qmd-manager-test-"));
    workspaceDir = path.join(tmpRoot, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });
    stateDir = path.join(tmpRoot, "state");
    await fs.mkdir(stateDir, { recursive: true });
    process.env.EDWINPAI_STATE_DIR = stateDir;
    cfg = {
      agents: {
        list: [{ id: agentId, default: true, workspace: workspaceDir }],
      },
      memory: {
        backend: "qmd",
        qmd: {
          includeDefaultMemory: false,
          update: { interval: "0s", debounceMs: 60_000, onBoot: false },
          paths: [{ path: workspaceDir, pattern: "**/*.md", name: "workspace" }],
        },
      },
    } as EdwinPAIConfig;
  });

  afterEach(async () => {
    delete process.env.EDWINPAI_STATE_DIR;
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("debounces back-to-back sync calls", async () => {
    const resolved = resolveMemoryBackendConfig({ cfg, agentId });
    const manager = await QmdMemoryManager.create({ cfg, agentId, resolved });
    expect(manager).toBeTruthy();
    if (!manager) {
      throw new Error("manager missing");
    }

    const baselineCalls = spawnMock.mock.calls.length;

    await manager.sync({ reason: "manual" });
    expect(spawnMock.mock.calls.length).toBe(baselineCalls + 2);

    await manager.sync({ reason: "manual-again" });
    expect(spawnMock.mock.calls.length).toBe(baselineCalls + 2);

    (manager as unknown as { lastUpdateAt: number | null }).lastUpdateAt =
      Date.now() - (resolved.qmd?.update.debounceMs ?? 0) - 10;

    await manager.sync({ reason: "after-wait" });
    // By default we refresh embeddings less frequently than index updates.
    expect(spawnMock.mock.calls.length).toBe(baselineCalls + 3);

    await manager.close();
  });

  it("scopes by channel for agent-prefixed session keys", async () => {
    cfg = {
      ...cfg,
      memory: {
        backend: "qmd",
        qmd: {
          includeDefaultMemory: false,
          update: { interval: "0s", debounceMs: 60_000, onBoot: false },
          paths: [{ path: workspaceDir, pattern: "**/*.md", name: "workspace" }],
          scope: {
            default: "deny",
            rules: [{ action: "allow", match: { channel: "slack" } }],
          },
        },
      },
    } as EdwinPAIConfig;
    const resolved = resolveMemoryBackendConfig({ cfg, agentId });
    const manager = await QmdMemoryManager.create({ cfg, agentId, resolved });
    expect(manager).toBeTruthy();
    if (!manager) {
      throw new Error("manager missing");
    }

    const isAllowed = (key?: string) =>
      (manager as unknown as { isScopeAllowed: (key?: string) => boolean }).isScopeAllowed(key);
    expect(isAllowed("agent:main:slack:channel:c123")).toBe(true);
    expect(isAllowed("agent:main:discord:channel:c123")).toBe(false);

    await manager.close();
  });

  it("blocks non-markdown or symlink reads for qmd paths", async () => {
    const resolved = resolveMemoryBackendConfig({ cfg, agentId });
    const manager = await QmdMemoryManager.create({ cfg, agentId, resolved });
    expect(manager).toBeTruthy();
    if (!manager) {
      throw new Error("manager missing");
    }

    const textPath = path.join(workspaceDir, "secret.txt");
    await fs.writeFile(textPath, "nope", "utf-8");
    await expect(manager.readFile({ relPath: "qmd/workspace/secret.txt" })).rejects.toThrow(
      "path required",
    );

    const target = path.join(workspaceDir, "target.md");
    await fs.writeFile(target, "ok", "utf-8");
    const link = path.join(workspaceDir, "link.md");
    await fs.symlink(target, link);
    await expect(manager.readFile({ relPath: "qmd/workspace/link.md" })).rejects.toThrow(
      "path required",
    );

    await manager.close();
  });

  it("enforces allowedCollections for workspace-relative qmd reads", async () => {
    const resolved = resolveMemoryBackendConfig({ cfg, agentId });
    const manager = await QmdMemoryManager.create({ cfg, agentId, resolved });
    expect(manager).toBeTruthy();
    if (!manager) {
      throw new Error("manager missing");
    }

    await fs.writeFile(path.join(workspaceDir, "notes.md"), "Scoped note", "utf-8");

    await expect(
      manager.readFile({
        relPath: "notes.md",
        accessScope: {
          agentId,
          actorType: "subagent",
          sessionKey: "agent:main:subagent:test",
          allowedCollections: ["division-reports"],
        },
      }),
    ).rejects.toThrow("memory path is outside allowed collections");

    await expect(
      manager.readFile({
        relPath: "notes.md",
        accessScope: {
          agentId,
          actorType: "subagent",
          sessionKey: "agent:main:subagent:test",
          allowedCollections: ["workspace"],
        },
      }),
    ).resolves.toEqual({ path: "notes.md", text: "Scoped note" });

    await manager.close();
  });

  it("blocks qmd memory_get direct reads for attach-on-demand profiles", async () => {
    const resolved = resolveMemoryBackendConfig({ cfg, agentId });
    const manager = await QmdMemoryManager.create({ cfg, agentId, resolved });
    expect(manager).toBeTruthy();
    if (!manager) {
      throw new Error("manager missing");
    }

    await fs.writeFile(path.join(workspaceDir, "notes.md"), "Scoped note", "utf-8");

    await expect(
      manager.readFile({
        relPath: "notes.md",
        accessScope: {
          agentId,
          actorType: "subagent",
          sessionKey: "agent:main:subagent:test",
          allowedCollections: ["workspace"],
          runtimeAttachmentPolicy: "attach-on-demand",
        },
      }),
    ).rejects.toThrow("memory_get is disabled by runtime attachment policy attach-on-demand");

    await manager.close();
  });

  it("reports qmd embed scheduler state in status", async () => {
    const resolved = resolveMemoryBackendConfig({ cfg, agentId });
    const manager = await QmdMemoryManager.create({ cfg, agentId, resolved });
    expect(manager).toBeTruthy();
    if (!manager) {
      throw new Error("manager missing");
    }

    (manager as unknown as { lastUpdateAt: number | null }).lastUpdateAt = 1_700_000_000_000;
    (manager as unknown as { lastEmbedAt: number | null }).lastEmbedAt = 1_700_000_100_000;
    (manager as unknown as { newTokensSinceLastEmbed: number }).newTokensSinceLastEmbed = 321;
    (manager as unknown as { pendingEmbed: Promise<void> | null }).pendingEmbed = Promise.resolve();

    const status = manager.status();
    expect(status.custom?.qmd).toMatchObject({
      collections: 1,
      lastUpdateAt: 1_700_000_000_000,
      lastEmbedAt: 1_700_000_100_000,
      embedPending: true,
      newTokensSinceLastEmbed: 321,
      embedTokenThreshold: resolved.qmd?.update.embedTokenThreshold,
      embedMinIntervalMs: resolved.qmd?.update.embedMinIntervalMs,
      embedMaxIntervalMs: resolved.qmd?.update.embedMaxIntervalMs,
    });

    await manager.close();
  });

  it("injects configured embedding API key into qmd subprocess env", async () => {
    cfg = {
      ...cfg,
      memory: {
        backend: "qmd",
        qmd: {
          includeDefaultMemory: false,
          embeddingApiKey: "qmd-test-key",
          update: { interval: "0s", debounceMs: 60_000, onBoot: false },
          paths: [{ path: workspaceDir, pattern: "**/*.md", name: "workspace" }],
        },
      },
    } as EdwinPAIConfig;

    const resolved = resolveMemoryBackendConfig({ cfg, agentId });
    const manager = await QmdMemoryManager.create({ cfg, agentId, resolved });
    expect(manager).toBeTruthy();
    if (!manager) {
      throw new Error("manager missing");
    }

    const spawnEnvs = spawnMock.mock.calls
      .map((call) => call[2]?.env)
      .filter((env): env is NodeJS.ProcessEnv => Boolean(env));
    expect(spawnEnvs.some((env) => env.OPENAI_API_KEY === "qmd-test-key")).toBe(true);
    expect(spawnEnvs.some((env) => env.QMD_OPENAI === "1")).toBe(true);

    await manager.close();
  });
});
