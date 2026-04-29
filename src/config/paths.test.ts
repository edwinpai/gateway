import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  resolveCanonicalConfigPath,
  resolveDefaultConfigCandidates,
  resolveConfigPath,
  resolveGatewayLockDir,
  resolveGatewayPort,
  resolveIsNixMode,
  resolveOAuthDir,
  resolveOAuthPath,
  resolveStateDir,
} from "./paths.js";

describe("oauth paths", () => {
  it("prefers EDWINPAI_OAUTH_DIR over EDWINPAI_STATE_DIR", () => {
    const env = {
      EDWINPAI_OAUTH_DIR: "/custom/oauth",
      EDWINPAI_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.resolve("/custom/oauth"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join(path.resolve("/custom/oauth"), "oauth.json"),
    );
  });

  it("derives oauth path from EDWINPAI_STATE_DIR when unset", () => {
    const env = {
      EDWINPAI_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.join("/custom/state", "credentials"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join("/custom/state", "credentials", "oauth.json"),
    );
  });
});

describe("state + config path candidates", () => {
  it("uses EDWINPAI_STATE_DIR when set", () => {
    const env = {
      EDWINPAI_STATE_DIR: "/new/state",
    } as NodeJS.ProcessEnv;

    expect(resolveStateDir(env, () => "/home/test")).toBe(path.resolve("/new/state"));
  });

  it("orders default config candidates in a stable order", () => {
    const home = "/home/test";
    const candidates = resolveDefaultConfigCandidates({} as NodeJS.ProcessEnv, () => home);
    const expected = [
      path.join(home, ".edwinpai", "edwinpai.json"),
      path.join(home, ".edwinpai", "edwin.json"),
      path.join(home, ".edwinpai", "clawdbot.json"),
      path.join(home, ".edwinpai", "moltbot.json"),
      path.join(home, ".edwinpai", "moldbot.json"),
      path.join(home, ".edwin", "edwinpai.json"),
      path.join(home, ".edwin", "edwin.json"),
      path.join(home, ".edwin", "clawdbot.json"),
      path.join(home, ".edwin", "moltbot.json"),
      path.join(home, ".edwin", "moldbot.json"),
      path.join(home, ".clawdbot", "edwinpai.json"),
      path.join(home, ".clawdbot", "edwin.json"),
      path.join(home, ".clawdbot", "clawdbot.json"),
      path.join(home, ".clawdbot", "moltbot.json"),
      path.join(home, ".clawdbot", "moldbot.json"),
      path.join(home, ".moltbot", "edwinpai.json"),
      path.join(home, ".moltbot", "edwin.json"),
      path.join(home, ".moltbot", "clawdbot.json"),
      path.join(home, ".moltbot", "moltbot.json"),
      path.join(home, ".moltbot", "moldbot.json"),
      path.join(home, ".moldbot", "edwinpai.json"),
      path.join(home, ".moldbot", "edwin.json"),
      path.join(home, ".moldbot", "clawdbot.json"),
      path.join(home, ".moldbot", "moltbot.json"),
      path.join(home, ".moldbot", "moldbot.json"),
    ];
    expect(candidates).toEqual(expected);
  });

  it("prefers the legacy .edwin dir when it exists and the new dir is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "edwinpai-state-"));
    try {
      const newDir = path.join(root, ".edwin");
      await fs.mkdir(newDir, { recursive: true });
      const resolved = resolveStateDir({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(newDir);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("CONFIG_PATH prefers existing config when present", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "edwinpai-config-"));
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    const previousHomeDrive = process.env.HOMEDRIVE;
    const previousHomePath = process.env.HOMEPATH;
    const previousEdwinPAIConfig = process.env.EDWINPAI_CONFIG_PATH;
    const previousEdwinState = process.env.EDWINPAI_STATE_DIR;
    try {
      const legacyDir = path.join(root, ".edwin");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyPath = path.join(legacyDir, "edwin.json");
      await fs.writeFile(legacyPath, "{}", "utf-8");

      process.env.HOME = root;
      if (process.platform === "win32") {
        process.env.USERPROFILE = root;
        const parsed = path.win32.parse(root);
        process.env.HOMEDRIVE = parsed.root.replace(/\\$/, "");
        process.env.HOMEPATH = root.slice(parsed.root.length - 1);
      }
      delete process.env.EDWINPAI_CONFIG_PATH;
      delete process.env.EDWINPAI_STATE_DIR;

      vi.resetModules();
      const { CONFIG_PATH } = await import("./paths.js");
      expect(CONFIG_PATH).toBe(legacyPath);
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      if (previousUserProfile === undefined) {
        delete process.env.USERPROFILE;
      } else {
        process.env.USERPROFILE = previousUserProfile;
      }
      if (previousHomeDrive === undefined) {
        delete process.env.HOMEDRIVE;
      } else {
        process.env.HOMEDRIVE = previousHomeDrive;
      }
      if (previousHomePath === undefined) {
        delete process.env.HOMEPATH;
      } else {
        process.env.HOMEPATH = previousHomePath;
      }
      if (previousEdwinPAIConfig === undefined) {
        delete process.env.EDWINPAI_CONFIG_PATH;
      } else {
        process.env.EDWINPAI_CONFIG_PATH = previousEdwinPAIConfig;
      }
      if (previousEdwinPAIConfig === undefined) {
        delete process.env.EDWINPAI_CONFIG_PATH;
      } else {
        process.env.EDWINPAI_CONFIG_PATH = previousEdwinPAIConfig;
      }
      if (previousEdwinState === undefined) {
        delete process.env.EDWINPAI_STATE_DIR;
      } else {
        process.env.EDWINPAI_STATE_DIR = previousEdwinState;
      }
      if (previousEdwinState === undefined) {
        delete process.env.EDWINPAI_STATE_DIR;
      } else {
        process.env.EDWINPAI_STATE_DIR = previousEdwinState;
      }
      await fs.rm(root, { recursive: true, force: true });
      vi.resetModules();
    }
  });

  it("respects state dir overrides when config is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "edwinpai-config-override-"));
    try {
      const legacyDir = path.join(root, ".edwin");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyConfig = path.join(legacyDir, "edwin.json");
      await fs.writeFile(legacyConfig, "{}", "utf-8");

      const overrideDir = path.join(root, "override");
      const env = { EDWINPAI_STATE_DIR: overrideDir } as NodeJS.ProcessEnv;
      const resolved = resolveConfigPath(env, overrideDir, () => root);
      expect(resolved).toBe(path.join(overrideDir, "edwinpai.json"));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

// ── edwinpai rename: backward compat layer ──────────────────────────────

describe("edwinpai rename — state dir", () => {
  it("defaults to ~/.edwinpai when no dirs exist", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "edwinpai-state-fresh-"));
    try {
      const resolved = resolveStateDir({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(path.join(root, ".edwinpai"));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("returns ~/.edwinpai when it exists", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "edwinpai-state-new-"));
    try {
      await fs.mkdir(path.join(root, ".edwinpai"), { recursive: true });
      const resolved = resolveStateDir({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(path.join(root, ".edwinpai"));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to the legacy .edwin dir when only it exists", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "edwinpai-state-legacy-"));
    try {
      await fs.mkdir(path.join(root, ".edwin"), { recursive: true });
      const resolved = resolveStateDir({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(path.join(root, ".edwin"));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("prefers .edwinpai over the legacy .edwin dir when both exist", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "edwinpai-state-both-"));
    try {
      await fs.mkdir(path.join(root, ".edwinpai"), { recursive: true });
      await fs.mkdir(path.join(root, ".edwin"), { recursive: true });
      const resolved = resolveStateDir({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(path.join(root, ".edwinpai"));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("edwinpai rename — env var fallbacks", () => {
  it("EDWINPAI_STATE_DIR takes priority over EDWIN_STATE_DIR", () => {
    const env = {
      EDWINPAI_STATE_DIR: "/new/state",
      EDWIN_STATE_DIR: "/old/state",
    } as NodeJS.ProcessEnv;
    expect(resolveStateDir(env, () => "/home/test")).toBe(path.resolve("/new/state"));
  });

  it("EDWINPAI_STATE_DIR works alone", () => {
    const env = { EDWINPAI_STATE_DIR: "/custom/state" } as NodeJS.ProcessEnv;
    expect(resolveStateDir(env, () => "/home/test")).toBe(path.resolve("/custom/state"));
  });

  it("EDWINPAI_CONFIG_PATH takes priority over EDWIN_CONFIG_PATH", () => {
    const env = {
      EDWINPAI_CONFIG_PATH: "/new/config.json",
      EDWIN_CONFIG_PATH: "/old/config.json",
    } as NodeJS.ProcessEnv;
    expect(resolveCanonicalConfigPath(env)).toBe(path.resolve("/new/config.json"));
  });

  it("EDWINPAI_OAUTH_DIR takes priority over EDWIN_OAUTH_DIR", () => {
    const env = {
      EDWINPAI_OAUTH_DIR: "/new/oauth",
      EDWIN_OAUTH_DIR: "/old/oauth",
    } as NodeJS.ProcessEnv;
    expect(resolveOAuthDir(env)).toBe(path.resolve("/new/oauth"));
  });

  it("EDWINPAI_GATEWAY_PORT takes priority over EDWIN_GATEWAY_PORT", () => {
    const env = {
      EDWINPAI_GATEWAY_PORT: "9999",
      EDWIN_GATEWAY_PORT: "8888",
    } as NodeJS.ProcessEnv;
    expect(resolveGatewayPort(undefined, env)).toBe(9999);
  });

  it("EDWINPAI_NIX_MODE works", () => {
    expect(resolveIsNixMode({ EDWINPAI_NIX_MODE: "1" } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe("edwinpai rename — config filename", () => {
  it("canonical config path uses edwinpai.json", () => {
    const stateDir = "/home/test/.edwinpai";
    const result = resolveCanonicalConfigPath({} as NodeJS.ProcessEnv, stateDir);
    expect(path.basename(result)).toBe("edwinpai.json");
  });

  it("default config candidates include edwinpai.json and legacy edwin.json", () => {
    const home = "/home/test";
    const candidates = resolveDefaultConfigCandidates({} as NodeJS.ProcessEnv, () => home);
    const filenames = candidates.map((c) => path.basename(c));
    expect(filenames).toContain("edwinpai.json");
    expect(filenames).toContain("edwin.json");
  });
});

describe("edwinpai rename — gateway lock dir", () => {
  it("uses edwinpai prefix", () => {
    const result = resolveGatewayLockDir(() => "/tmp");
    expect(path.basename(result)).toMatch(/^edwinpai/);
  });
});
