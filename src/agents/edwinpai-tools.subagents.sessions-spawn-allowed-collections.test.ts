import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callGatewayMock = vi.fn();
vi.mock("../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

let configOverride: ReturnType<(typeof import("../config/config.js"))["loadConfig"]> = {
  session: {
    mainKey: "main",
    scope: "per-sender",
  },
};

let previousStateDir: string | undefined;

function writeDisciplineRegistry(stateDir: string, disciplines: Array<Record<string, unknown>>) {
  const knowledgeDir = path.join(stateDir, "knowledge");
  fs.mkdirSync(knowledgeDir, { recursive: true });
  fs.writeFileSync(
    path.join(knowledgeDir, "disciplines.json"),
    JSON.stringify({ disciplines }, null, 2),
  );
}

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>("../config/config.js");
  return {
    ...actual,
    loadConfig: () => configOverride,
    resolveGatewayPort: () => 18789,
  };
});

import "./test-helpers/fast-core-tools.js";
import { createEdwinPAITools } from "./edwinpai-tools.js";
import { resetSubagentRegistryForTests } from "./subagent-registry.js";
import { getSubagentRunByChildSessionKey } from "./subagent-registry.js";

describe("sessions_spawn allowedCollections", () => {
  beforeEach(() => {
    previousStateDir = process.env.EDWINPAI_STATE_DIR;
    resetSubagentRegistryForTests();
    callGatewayMock.mockReset();
    configOverride = {
      session: {
        mainKey: "main",
        scope: "per-sender",
      },
    };
  });

  afterEach(() => {
    if (previousStateDir === undefined) {
      delete process.env.EDWINPAI_STATE_DIR;
    } else {
      process.env.EDWINPAI_STATE_DIR = previousStateDir;
    }
  });

  it("inherits default subagent allowedCollections from config", async () => {
    configOverride = {
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        defaults: { subagents: { allowedCollections: ["workspace", "division-reports"] } },
      },
    };

    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "agent") {
        return { runId: "run-default-collections", status: "accepted" };
      }
      return {};
    });

    const tool = createEdwinPAITools({
      agentSessionKey: "main",
      agentChannel: "discord",
    }).find((candidate) => candidate.name === "sessions_spawn");
    if (!tool) {
      throw new Error("missing sessions_spawn tool");
    }

    const result = await tool.execute("call-default-collections", { task: "do thing" });
    expect(result.details).toMatchObject({
      status: "accepted",
      childSessionKey: expect.any(String),
    });
    const childSessionKey = (result.details as { childSessionKey: string }).childSessionKey;
    expect(getSubagentRunByChildSessionKey(childSessionKey)?.allowedCollections).toEqual([
      "workspace",
      "division-reports",
    ]);
  });

  it("prefers per-agent subagent allowedCollections over defaults", async () => {
    configOverride = {
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        defaults: { subagents: { allowedCollections: ["workspace"] } },
        list: [
          {
            id: "research",
            subagents: { allowedCollections: ["division-reports", "jake-writings"] },
          },
        ],
      },
    };

    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "agent") {
        return { runId: "run-agent-collections", status: "accepted" };
      }
      return {};
    });

    const tool = createEdwinPAITools({
      agentSessionKey: "agent:research:main",
      agentChannel: "discord",
    }).find((candidate) => candidate.name === "sessions_spawn");
    if (!tool) {
      throw new Error("missing sessions_spawn tool");
    }

    const result = await tool.execute("call-agent-collections", { task: "do thing" });
    const childSessionKey = (result.details as { childSessionKey: string }).childSessionKey;
    expect(getSubagentRunByChildSessionKey(childSessionKey)?.allowedCollections).toEqual([
      "division-reports",
      "jake-writings",
    ]);
  });

  it("prefers explicit allowedCollections over config inheritance", async () => {
    configOverride = {
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        defaults: { subagents: { allowedCollections: ["workspace"] } },
      },
    };

    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "agent") {
        return { runId: "run-explicit-collections", status: "accepted" };
      }
      return {};
    });

    const tool = createEdwinPAITools({
      agentSessionKey: "main",
      agentChannel: "discord",
    }).find((candidate) => candidate.name === "sessions_spawn");
    if (!tool) {
      throw new Error("missing sessions_spawn tool");
    }

    const result = await tool.execute("call-explicit-collections", {
      task: "do thing",
      allowedCollections: ["division-reports"],
    });
    const childSessionKey = (result.details as { childSessionKey: string }).childSessionKey;
    expect(getSubagentRunByChildSessionKey(childSessionKey)?.allowedCollections).toEqual([
      "division-reports",
    ]);
  });

  it("resolves mounted collections from an explicit named subagent profile", async () => {
    configOverride = {
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        defaults: {
          subagents: {
            profiles: {
              research: {
                selectedCollections: ["workspace", "division-reports"],
                runtimeAttachmentPolicy: "mounted-only",
              },
            },
          },
        },
      },
    };

    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "agent") {
        return { runId: "run-explicit-profile", status: "accepted" };
      }
      return {};
    });

    const tool = createEdwinPAITools({
      agentSessionKey: "main",
      agentChannel: "discord",
    }).find((candidate) => candidate.name === "sessions_spawn");
    if (!tool) {
      throw new Error("missing sessions_spawn tool");
    }

    const result = await tool.execute("call-explicit-profile", {
      task: "do thing",
      profile: "research",
    });
    expect(result.details).toMatchObject({
      status: "accepted",
      profile: "research",
      runtimeAttachmentPolicy: "mounted-only",
      memoryCapabilityTier: "search-and-read",
      allowedCollections: ["workspace", "division-reports"],
    });
    const childSessionKey = (result.details as { childSessionKey: string }).childSessionKey;
    expect(getSubagentRunByChildSessionKey(childSessionKey)).toMatchObject({
      profile: "research",
      runtimeAttachmentPolicy: "mounted-only",
      allowedCollections: ["workspace", "division-reports"],
    });
  });

  it("describes search-only capability in the spawned prompt for attach-on-demand profiles", async () => {
    configOverride = {
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        defaults: {
          subagents: {
            profiles: {
              research: {
                selectedCollections: ["workspace"],
                runtimeAttachmentPolicy: "attach-on-demand",
              },
            },
          },
        },
      },
    };

    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "agent") {
        return { runId: "run-search-only-profile", status: "accepted" };
      }
      return {};
    });

    const tool = createEdwinPAITools({
      agentSessionKey: "main",
      agentChannel: "discord",
    }).find((candidate) => candidate.name === "sessions_spawn");
    if (!tool) {
      throw new Error("missing sessions_spawn tool");
    }

    const result = await tool.execute("call-search-only-profile", {
      task: "do thing",
      profile: "research",
    });

    expect(result.details).toMatchObject({
      status: "accepted",
      profile: "research",
      runtimeAttachmentPolicy: "attach-on-demand",
      memoryCapabilityTier: "search-only",
      allowedCollections: ["workspace"],
    });

    const agentCall = callGatewayMock.mock.calls
      .map((call) => call[0] as { method?: string; params?: { extraSystemPrompt?: string } })
      .find((call) => call.method === "agent");
    expect(agentCall?.params?.extraSystemPrompt).toContain("Memory capability tier: search-only.");
    expect(agentCall?.params?.extraSystemPrompt).toContain(
      "direct `memory_get` reads are disabled under your current attachment policy",
    );
  });

  it("resolves a default profile from requester profileBindings for cross-agent spawns", async () => {
    configOverride = {
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        defaults: {
          subagents: {
            profiles: {
              research: {
                selectedCollections: ["division-reports", "jake-writings"],
              },
            },
          },
        },
        list: [
          {
            id: "main",
            subagents: {
              allowAgents: ["research"],
              profileBindings: {
                research: "research",
              },
            },
          },
          {
            id: "research",
          },
        ],
      },
    };

    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "agent") {
        return { runId: "run-requester-profile-binding", status: "accepted" };
      }
      return {};
    });

    const tool = createEdwinPAITools({
      agentSessionKey: "agent:main:main",
      agentChannel: "discord",
    }).find((candidate) => candidate.name === "sessions_spawn");
    if (!tool) {
      throw new Error("missing sessions_spawn tool");
    }

    const result = await tool.execute("call-requester-profile-binding", {
      task: "do thing",
      agentId: "research",
    });
    const childSessionKey = (result.details as { childSessionKey: string }).childSessionKey;
    expect(getSubagentRunByChildSessionKey(childSessionKey)).toMatchObject({
      profile: "research",
      allowedCollections: ["division-reports", "jake-writings"],
    });
  });

  it("prefers requester profileBindings over the target agent's own default profile", async () => {
    configOverride = {
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        defaults: {
          subagents: {
            profiles: {
              requesterbound: {
                selectedCollections: ["division-reports"],
              },
              targetdefault: {
                selectedCollections: ["workspace"],
              },
            },
          },
        },
        list: [
          {
            id: "main",
            subagents: {
              allowAgents: ["research"],
              profileBindings: {
                research: "requesterbound",
              },
            },
          },
          {
            id: "research",
            subagents: {
              profile: "targetdefault",
            },
          },
        ],
      },
    };

    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "agent") {
        return { runId: "run-requester-binding-wins", status: "accepted" };
      }
      return {};
    });

    const tool = createEdwinPAITools({
      agentSessionKey: "agent:main:main",
      agentChannel: "discord",
    }).find((candidate) => candidate.name === "sessions_spawn");
    if (!tool) {
      throw new Error("missing sessions_spawn tool");
    }

    const result = await tool.execute("call-requester-binding-wins", {
      task: "do thing",
      agentId: "research",
    });
    const childSessionKey = (result.details as { childSessionKey: string }).childSessionKey;
    expect(getSubagentRunByChildSessionKey(childSessionKey)).toMatchObject({
      profile: "requesterbound",
      allowedCollections: ["division-reports"],
    });
  });

  it("uses global profileBindings when no requester-specific binding exists", async () => {
    configOverride = {
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        defaults: {
          subagents: {
            profileBindings: {
              research: "research",
            },
            profiles: {
              research: {
                selectedCollections: ["division-reports", "workspace"],
              },
            },
          },
        },
        list: [
          {
            id: "main",
            subagents: {
              allowAgents: ["research"],
            },
          },
          {
            id: "research",
          },
        ],
      },
    };

    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "agent") {
        return { runId: "run-global-profile-binding", status: "accepted" };
      }
      return {};
    });

    const tool = createEdwinPAITools({
      agentSessionKey: "agent:main:main",
      agentChannel: "discord",
    }).find((candidate) => candidate.name === "sessions_spawn");
    if (!tool) {
      throw new Error("missing sessions_spawn tool");
    }

    const result = await tool.execute("call-global-profile-binding", {
      task: "do thing",
      agentId: "research",
    });
    const childSessionKey = (result.details as { childSessionKey: string }).childSessionKey;
    expect(getSubagentRunByChildSessionKey(childSessionKey)).toMatchObject({
      profile: "research",
      allowedCollections: ["division-reports", "workspace"],
    });
  });

  it("resolves a desktop discipline id as a subagent profile when bound from config", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "edwin-discipline-profile-"));
    process.env.EDWINPAI_STATE_DIR = stateDir;
    writeDisciplineRegistry(stateDir, [
      {
        id: "desktop-identity-core",
        selectedCollections: ["Identity-Core-Notes", "edwin-desktop"],
        runtimeAttachmentPolicy: "attach-on-demand",
      },
    ]);

    configOverride = {
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        defaults: {
          subagents: {
            profileBindings: {
              research: "desktop-identity-core",
            },
          },
        },
        list: [
          {
            id: "main",
            subagents: {
              allowAgents: ["research"],
            },
          },
          {
            id: "research",
          },
        ],
      },
    };

    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "agent") {
        return { runId: "run-desktop-discipline-profile", status: "accepted" };
      }
      return {};
    });

    const tool = createEdwinPAITools({
      agentSessionKey: "agent:main:main",
      agentChannel: "discord",
    }).find((candidate) => candidate.name === "sessions_spawn");
    if (!tool) {
      throw new Error("missing sessions_spawn tool");
    }

    const result = await tool.execute("call-desktop-discipline-profile", {
      task: "do thing",
      agentId: "research",
    });
    const childSessionKey = (result.details as { childSessionKey: string }).childSessionKey;
    expect(result.details).toMatchObject({
      status: "accepted",
      profile: "desktop-identity-core",
      runtimeAttachmentPolicy: "attach-on-demand",
      memoryCapabilityTier: "search-only",
      allowedCollections: ["identity-core-notes", "edwin-desktop"],
    });
    expect(getSubagentRunByChildSessionKey(childSessionKey)).toMatchObject({
      profile: "desktop-identity-core",
      runtimeAttachmentPolicy: "attach-on-demand",
      allowedCollections: ["identity-core-notes", "edwin-desktop"],
    });
  });

  it("prefers configured profiles over desktop discipline registry entries with the same id", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "edwin-discipline-override-"));
    process.env.EDWINPAI_STATE_DIR = stateDir;
    writeDisciplineRegistry(stateDir, [
      {
        id: "research",
        selectedCollections: ["workspace"],
        runtimeAttachmentPolicy: "attach-on-demand",
      },
    ]);

    configOverride = {
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        defaults: {
          subagents: {
            profiles: {
              research: {
                selectedCollections: ["division-reports"],
                runtimeAttachmentPolicy: "mounted-only",
              },
            },
          },
        },
      },
    };

    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "agent") {
        return { runId: "run-config-profile-wins", status: "accepted" };
      }
      return {};
    });

    const tool = createEdwinPAITools({
      agentSessionKey: "agent:research:main",
      agentChannel: "discord",
    }).find((candidate) => candidate.name === "sessions_spawn");
    if (!tool) {
      throw new Error("missing sessions_spawn tool");
    }

    const result = await tool.execute("call-config-profile-wins", {
      task: "do thing",
      profile: "research",
    });

    expect(result.details).toMatchObject({
      status: "accepted",
      profile: "research",
      runtimeAttachmentPolicy: "mounted-only",
      memoryCapabilityTier: "search-and-read",
      allowedCollections: ["division-reports"],
    });
  });

  it("uses an agent default subagent profile before legacy allowedCollections", async () => {
    configOverride = {
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        defaults: {
          subagents: {
            allowedCollections: ["workspace"],
            profiles: {
              research: {
                selectedCollections: ["division-reports", "jake-writings"],
              },
            },
          },
        },
        list: [
          {
            id: "research",
            subagents: {
              profile: "research",
            },
          },
        ],
      },
    };

    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "agent") {
        return { runId: "run-default-profile", status: "accepted" };
      }
      return {};
    });

    const tool = createEdwinPAITools({
      agentSessionKey: "agent:research:main",
      agentChannel: "discord",
    }).find((candidate) => candidate.name === "sessions_spawn");
    if (!tool) {
      throw new Error("missing sessions_spawn tool");
    }

    const result = await tool.execute("call-default-profile", {
      task: "do thing",
    });
    const childSessionKey = (result.details as { childSessionKey: string }).childSessionKey;
    expect(getSubagentRunByChildSessionKey(childSessionKey)).toMatchObject({
      profile: "research",
      allowedCollections: ["division-reports", "jake-writings"],
    });
  });

  it("lets per-agent profile definitions override global profiles with the same id", async () => {
    configOverride = {
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        defaults: {
          subagents: {
            profiles: {
              research: {
                selectedCollections: ["workspace"],
              },
            },
          },
        },
        list: [
          {
            id: "research",
            subagents: {
              profiles: {
                research: {
                  selectedCollections: ["division-reports", "jake-writings"],
                },
              },
            },
          },
        ],
      },
    };

    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "agent") {
        return { runId: "run-profile-override", status: "accepted" };
      }
      return {};
    });

    const tool = createEdwinPAITools({
      agentSessionKey: "agent:research:main",
      agentChannel: "discord",
    }).find((candidate) => candidate.name === "sessions_spawn");
    if (!tool) {
      throw new Error("missing sessions_spawn tool");
    }

    const result = await tool.execute("call-profile-override", {
      task: "do thing",
      profile: "research",
    });
    const childSessionKey = (result.details as { childSessionKey: string }).childSessionKey;
    expect(getSubagentRunByChildSessionKey(childSessionKey)?.allowedCollections).toEqual([
      "division-reports",
      "jake-writings",
    ]);
  });

  it("prefers explicit allowedCollections over a selected profile", async () => {
    configOverride = {
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        defaults: {
          subagents: {
            profiles: {
              research: {
                selectedCollections: ["workspace", "division-reports"],
              },
            },
          },
        },
      },
    };

    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "agent") {
        return { runId: "run-profile-explicit-collections", status: "accepted" };
      }
      return {};
    });

    const tool = createEdwinPAITools({
      agentSessionKey: "main",
      agentChannel: "discord",
    }).find((candidate) => candidate.name === "sessions_spawn");
    if (!tool) {
      throw new Error("missing sessions_spawn tool");
    }

    const result = await tool.execute("call-profile-explicit-collections", {
      task: "do thing",
      profile: "research",
      allowedCollections: ["division-reports"],
    });
    expect(result.details).toMatchObject({
      status: "accepted",
      allowedCollections: ["division-reports"],
      profile: undefined,
    });
    const childSessionKey = (result.details as { childSessionKey: string }).childSessionKey;
    expect(getSubagentRunByChildSessionKey(childSessionKey)).toMatchObject({
      allowedCollections: ["division-reports"],
      profile: undefined,
    });
  });

  it("errors when a requested subagent profile does not exist", async () => {
    const tool = createEdwinPAITools({
      agentSessionKey: "main",
      agentChannel: "discord",
    }).find((candidate) => candidate.name === "sessions_spawn");
    if (!tool) {
      throw new Error("missing sessions_spawn tool");
    }

    const result = await tool.execute("call-missing-profile", {
      task: "do thing",
      profile: "missing",
    });
    expect(result.details).toMatchObject({
      status: "error",
      error: expect.stringContaining('Unknown subagent profile "missing"'),
    });
  });

  it("errors when a selected subagent profile does not define selectedCollections", async () => {
    configOverride = {
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        defaults: {
          subagents: {
            profiles: {
              research: {
                runtimeAttachmentPolicy: "mounted-only",
              },
            },
          },
        },
      },
    };

    const tool = createEdwinPAITools({
      agentSessionKey: "main",
      agentChannel: "discord",
    }).find((candidate) => candidate.name === "sessions_spawn");
    if (!tool) {
      throw new Error("missing sessions_spawn tool");
    }

    const result = await tool.execute("call-profile-without-collections", {
      task: "do thing",
      profile: "research",
    });
    expect(result.details).toMatchObject({
      status: "error",
      error: expect.stringContaining('Subagent profile "research" must define selectedCollections'),
    });
  });

  it("errors when a selected subagent profile has an invalid runtimeAttachmentPolicy", async () => {
    configOverride = {
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        defaults: {
          subagents: {
            profiles: {
              research: {
                selectedCollections: ["workspace"],
                runtimeAttachmentPolicy: "free-for-all" as never,
              },
            },
          },
        },
      },
    };

    const tool = createEdwinPAITools({
      agentSessionKey: "main",
      agentChannel: "discord",
    }).find((candidate) => candidate.name === "sessions_spawn");
    if (!tool) {
      throw new Error("missing sessions_spawn tool");
    }

    const result = await tool.execute("call-profile-invalid-policy", {
      task: "do thing",
      profile: "research",
    });
    expect(result.details).toMatchObject({
      status: "error",
      error: expect.stringContaining(
        'Subagent profile "research" has invalid runtimeAttachmentPolicy "free-for-all"',
      ),
    });
  });
});
