import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverAuthStorage } from "./pi-model-discovery.js";

describe("discoverAuthStorage", () => {
  const previousAgentDir = process.env.EDWINPAI_AGENT_DIR;
  const previousPiAgentDir = process.env.PI_CODING_AGENT_DIR;

  afterEach(() => {
    if (previousAgentDir === undefined) {
      delete process.env.EDWINPAI_AGENT_DIR;
    } else {
      process.env.EDWINPAI_AGENT_DIR = previousAgentDir;
    }
    if (previousPiAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousPiAgentDir;
    }
  });

  it("materializes PI auth.json from auth-profiles.json", () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "edwinpai-pi-auth-"));
    try {
      process.env.EDWINPAI_AGENT_DIR = agentDir;
      process.env.PI_CODING_AGENT_DIR = agentDir;

      fs.writeFileSync(
        path.join(agentDir, "auth-profiles.json"),
        `${JSON.stringify(
          {
            version: 1,
            profiles: {
              "openai-codex:default": {
                type: "oauth",
                provider: "openai-codex",
                access: "access-token",
                refresh: "refresh-token",
                expires: Date.now() + 60_000,
              },
              "openai:default": {
                type: "api_key",
                provider: "openai",
                key: "sk-live",
              },
              "anthropic:token": {
                type: "token",
                provider: "anthropic",
                token: "anth-token",
              },
            },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      discoverAuthStorage(agentDir);

      const raw = JSON.parse(fs.readFileSync(path.join(agentDir, "auth.json"), "utf8")) as Record<
        string,
        Record<string, unknown>
      >;
      expect(raw["openai-codex"]).toMatchObject({
        type: "api_key",
        key: "access-token",
      });
      expect(raw.openai).toMatchObject({
        type: "api_key",
        key: "sk-live",
      });
      expect(raw.anthropic).toMatchObject({
        type: "api_key",
        key: "anth-token",
      });
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });
});
