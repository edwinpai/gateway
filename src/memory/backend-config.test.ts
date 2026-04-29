import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { EdwinPAIConfig } from "../config/config.js";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { resolveMemoryBackendConfig, resolveQmdCommand } from "./backend-config.js";

describe("resolveMemoryBackendConfig", () => {
  it("defaults to qmd backend when config missing", () => {
    const cfg = { agents: { defaults: { workspace: "/tmp/memory-test" } } } as EdwinPAIConfig;
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    expect(resolved.backend).toBe("qmd");
    expect(resolved.citations).toBe("auto");
    expect(resolved.qmd).toBeDefined();
  });

  it("resolves qmd backend with default collections", () => {
    const cfg = {
      agents: { defaults: { workspace: "/tmp/memory-test" } },
      memory: {
        backend: "qmd",
        qmd: {},
      },
    } as EdwinPAIConfig;
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    expect(resolved.backend).toBe("qmd");
    expect(resolved.qmd?.collections.length).toBeGreaterThanOrEqual(3);
    expect(resolved.qmd?.command?.endsWith("/qmd") || resolved.qmd?.command === "qmd").toBe(true);
    expect(resolved.qmd?.update.intervalMs).toBeGreaterThan(0);
  });

  it("parses quoted qmd command paths", () => {
    const cfg = {
      agents: { defaults: { workspace: "/tmp/memory-test" } },
      memory: {
        backend: "qmd",
        qmd: {
          command: '"/Applications/QMD Tools/qmd" --flag',
        },
      },
    } as EdwinPAIConfig;
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    expect(resolved.qmd?.command).toBe("/Applications/QMD Tools/qmd");
  });

  it("prefers qmd embeddingApiKey from config", () => {
    const cfg = {
      agents: { defaults: { workspace: "/tmp/memory-test" } },
      memory: {
        backend: "qmd",
        qmd: {
          embeddingApiKey: "qmd-test-key",
        },
      },
      plugins: {
        entries: {
          "shad-context": {
            config: {
              embeddingApiKey: "plugin-test-key",
            },
          },
        },
      },
    } as EdwinPAIConfig;
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    expect(resolved.qmd?.embeddingApiKey).toBe("qmd-test-key");
  });

  it("falls back to shad-context embeddingApiKey for qmd", () => {
    const cfg = {
      agents: { defaults: { workspace: "/tmp/memory-test" } },
      memory: {
        backend: "qmd",
        qmd: {},
      },
      plugins: {
        entries: {
          "shad-context": {
            config: {
              embeddingApiKey: "plugin-test-key",
            },
          },
        },
      },
    } as EdwinPAIConfig;
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    expect(resolved.qmd?.embeddingApiKey).toBe("plugin-test-key");
  });

  it("resolves bare qmd commands to an executable path when available", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qmd-path-test-"));
    const binDir = path.join(tmpRoot, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    const qmdPath = path.join(binDir, "qmd");
    fs.writeFileSync(qmdPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

    const resolved = resolveQmdCommand("qmd", { pathEnv: binDir, homeDir: tmpRoot });
    expect(resolved).toBe(qmdPath);
  });

  it("resolves custom paths relative to workspace", () => {
    const cfg = {
      agents: {
        defaults: { workspace: "/workspace/root" },
        list: [{ id: "main", workspace: "/workspace/root" }],
      },
      memory: {
        backend: "qmd",
        qmd: {
          paths: [
            {
              path: "notes",
              name: "custom-notes",
              pattern: "**/*.md",
            },
          ],
        },
      },
    } as EdwinPAIConfig;
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    const custom = resolved.qmd?.collections.find((c) => c.name.startsWith("custom-notes"));
    expect(custom).toBeDefined();
    const workspaceRoot = resolveAgentWorkspaceDir(cfg, "main");
    expect(custom?.path).toBe(path.resolve(workspaceRoot, "notes"));
  });
});
