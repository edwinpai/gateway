import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyNonInteractiveAuthChoice } from "./onboard-non-interactive/local/auth-choice.js";

const logs: string[] = [];
const runtime = {
  log: (msg: string) => {
    logs.push(String(msg));
  },
  error: (msg: string) => {
    throw new Error(msg);
  },
  exit: (code: number) => {
    throw new Error(`exit:${code}`);
  },
};

describe("non-interactive auth choice: openai api key", () => {
  const prev = {
    home: process.env.HOME,
    stateDir: process.env.EDWINPAI_STATE_DIR,
    configPath: process.env.EDWINPAI_CONFIG_PATH,
    openaiApiKey: process.env.OPENAI_API_KEY,
  };
  let tempHome: string | undefined;

  beforeAll(async () => {
    delete process.env.OPENAI_API_KEY;
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "edwinpai-openai-auth-choice-"));
    process.env.HOME = tempHome;
  });

  afterAll(async () => {
    if (tempHome) {
      await fs.rm(tempHome, { recursive: true, force: true });
    }
    process.env.HOME = prev.home;
    process.env.EDWINPAI_STATE_DIR = prev.stateDir;
    process.env.EDWINPAI_CONFIG_PATH = prev.configPath;
    process.env.OPENAI_API_KEY = prev.openaiApiKey;
  });

  it("persists OPENAI_API_KEY to shared env instead of config", async () => {
    logs.length = 0;
    if (!tempHome) {
      throw new Error("temp home not initialized");
    }
    const stateDir = path.join(tempHome, ".edwinpai");
    process.env.EDWINPAI_STATE_DIR = stateDir;
    delete process.env.EDWINPAI_CONFIG_PATH;

    const openaiApiKey = "sk-test-openai-key-123456";
    const nextConfig = {
      gateway: {
        mode: "local" as const,
      },
    };

    const result = await applyNonInteractiveAuthChoice({
      nextConfig,
      authChoice: "openai-api-key",
      opts: {
        nonInteractive: true,
        mode: "local",
        authChoice: "openai-api-key",
        openaiApiKey,
      },
      runtime,
      baseConfig: {},
    });

    expect(result).toEqual(nextConfig);

    const envPath = path.join(stateDir, ".env");
    const envRaw = await fs.readFile(envPath, "utf8");
    expect(envRaw).toContain(`OPENAI_API_KEY=${openaiApiKey}`);

    expect(JSON.stringify(result)).not.toContain(openaiApiKey);
    expect(process.env.OPENAI_API_KEY).toBe(openaiApiKey);
    expect(
      logs.some((line) => line.includes("shared service-safe env for the CLI and daemon")),
    ).toBe(true);
  });
});
