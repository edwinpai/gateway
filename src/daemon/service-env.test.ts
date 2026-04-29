import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildMinimalServicePath,
  buildNodeServiceEnvironment,
  buildServiceEnvironment,
  getMinimalServicePathParts,
  getMinimalServicePathPartsFromEnv,
} from "./service-env.js";

describe("getMinimalServicePathParts - Unix user directories", () => {
  it("includes user bin directories when HOME is set on Linux", () => {
    const result = getMinimalServicePathParts({
      platform: "linux",
      home: "/home/testuser",
    });

    expect(result).toContain("/home/testuser/.local/bin");
    expect(result).toContain("/home/testuser/.npm-global/bin");
    expect(result).toContain("/home/testuser/bin");
    expect(result).toContain("/home/testuser/.nvm/current/bin");
    expect(result).toContain("/home/testuser/.fnm/current/bin");
    expect(result).toContain("/home/testuser/.volta/bin");
    expect(result).toContain("/home/testuser/.asdf/shims");
    expect(result).toContain("/home/testuser/.local/share/pnpm");
    expect(result).toContain("/home/testuser/.bun/bin");
    expect(result).toContain("/home/testuser/.shad/bin");
  });

  it("excludes user bin directories when HOME is undefined on Linux", () => {
    const result = getMinimalServicePathParts({
      platform: "linux",
      home: undefined,
    });

    expect(result).toEqual(["/usr/local/bin", "/usr/bin", "/bin"]);
    expect(result.some((p) => p.includes(".local"))).toBe(false);
    expect(result.some((p) => p.includes(".npm-global"))).toBe(false);
    expect(result.some((p) => p.includes(".nvm"))).toBe(false);
  });

  it("places user directories before system directories on Linux", () => {
    const result = getMinimalServicePathParts({
      platform: "linux",
      home: "/home/testuser",
    });

    const userDirIndex = result.indexOf("/home/testuser/.local/bin");
    const systemDirIndex = result.indexOf("/usr/bin");

    expect(userDirIndex).toBeGreaterThan(-1);
    expect(systemDirIndex).toBeGreaterThan(-1);
    expect(userDirIndex).toBeLessThan(systemDirIndex);
  });

  it("places extraDirs before user directories on Linux", () => {
    const result = getMinimalServicePathParts({
      platform: "linux",
      home: "/home/testuser",
      extraDirs: ["/custom/bin"],
    });

    const extraDirIndex = result.indexOf("/custom/bin");
    const userDirIndex = result.indexOf("/home/testuser/.local/bin");

    expect(extraDirIndex).toBeGreaterThan(-1);
    expect(userDirIndex).toBeGreaterThan(-1);
    expect(extraDirIndex).toBeLessThan(userDirIndex);
  });

  it("includes env-configured bin roots when HOME is set on Linux", () => {
    const result = getMinimalServicePathPartsFromEnv({
      platform: "linux",
      env: {
        HOME: "/home/testuser",
        PNPM_HOME: "/opt/pnpm",
        NPM_CONFIG_PREFIX: "/opt/npm",
        BUN_INSTALL: "/opt/bun",
        VOLTA_HOME: "/opt/volta",
        ASDF_DATA_DIR: "/opt/asdf",
        NVM_DIR: "/opt/nvm",
        FNM_DIR: "/opt/fnm",
        CARGO_HOME: "/opt/cargo",
      },
    });

    expect(result).toContain("/opt/pnpm");
    expect(result).toContain("/opt/npm/bin");
    expect(result).toContain("/opt/bun/bin");
    expect(result).toContain("/opt/volta/bin");
    expect(result).toContain("/opt/asdf/shims");
    expect(result).toContain("/opt/nvm/current/bin");
    expect(result).toContain("/opt/fnm/current/bin");
    expect(result).toContain("/opt/cargo/bin");
  });

  it("includes common user directories on macOS", () => {
    const result = getMinimalServicePathParts({
      platform: "darwin",
      home: "/Users/testuser",
    });

    expect(result).toContain("/Users/testuser/.local/bin");
    expect(result).toContain("/Users/testuser/.bun/bin");
    expect(result).toContain("/Users/testuser/.shad/bin");
    expect(result).toContain("/Users/testuser/Library/pnpm");
    expect(result).toContain("/opt/homebrew/bin");
    expect(result).toContain("/usr/local/bin");
  });

  it("does not include Linux-only pnpm/npm-global directories on macOS", () => {
    const result = getMinimalServicePathParts({
      platform: "darwin",
      home: "/Users/testuser",
    });

    expect(result.some((p) => p.includes(".npm-global"))).toBe(false);
    expect(result.some((p) => p.includes(".local/share/pnpm"))).toBe(false);
  });

  it("does not include Unix user directories on Windows", () => {
    const result = getMinimalServicePathParts({
      platform: "win32",
      home: "C:\\Users\\testuser",
    });

    expect(result).toEqual([]);
  });
});

describe("buildMinimalServicePath", () => {
  const splitPath = (value: string, platform: NodeJS.Platform) =>
    value.split(platform === "win32" ? path.win32.delimiter : path.posix.delimiter);

  it("includes user + Homebrew + system dirs on macOS", () => {
    const result = buildMinimalServicePath({
      platform: "darwin",
      env: { HOME: "/Users/alice" },
    });
    const parts = splitPath(result, "darwin");
    expect(parts).toContain("/Users/alice/.bun/bin");
    expect(parts).toContain("/Users/alice/.local/bin");
    expect(parts).toContain("/Users/alice/.shad/bin");
    expect(parts).toContain("/Users/alice/Library/pnpm");
    expect(parts).toContain("/opt/homebrew/bin");
    expect(parts).toContain("/usr/local/bin");
    expect(parts).toContain("/usr/bin");
    expect(parts).toContain("/bin");
  });

  it("returns PATH as-is on Windows", () => {
    const result = buildMinimalServicePath({
      env: { PATH: "C:\\\\Windows\\\\System32" },
      platform: "win32",
    });
    expect(result).toBe("C:\\\\Windows\\\\System32");
  });

  it("includes Linux user directories when HOME is set in env", () => {
    const result = buildMinimalServicePath({
      platform: "linux",
      env: { HOME: "/home/alice" },
    });
    const parts = splitPath(result, "linux");

    expect(parts).toContain("/home/alice/.local/bin");
    expect(parts).toContain("/home/alice/.npm-global/bin");
    expect(parts).toContain("/home/alice/.nvm/current/bin");
    expect(parts).toContain("/home/alice/.shad/bin");
    expect(parts).toContain("/usr/local/bin");
    expect(parts).toContain("/usr/bin");
    expect(parts).toContain("/bin");
  });

  it("excludes Linux user directories when HOME is not in env", () => {
    const result = buildMinimalServicePath({
      platform: "linux",
      env: {},
    });
    const parts = splitPath(result, "linux");

    expect(parts).toEqual(["/usr/local/bin", "/usr/bin", "/bin"]);
    expect(parts.some((p) => p.includes("home"))).toBe(false);
  });

  it("ensures user directories come before system directories on Linux", () => {
    const result = buildMinimalServicePath({
      platform: "linux",
      env: { HOME: "/home/bob" },
    });
    const parts = splitPath(result, "linux");

    const firstUserDirIdx = parts.indexOf("/home/bob/.local/bin");
    const firstSystemDirIdx = parts.indexOf("/usr/local/bin");

    expect(firstUserDirIdx).toBeLessThan(firstSystemDirIdx);
  });

  it("includes extra directories when provided", () => {
    const result = buildMinimalServicePath({
      platform: "linux",
      extraDirs: ["/custom/tools"],
      env: {},
    });
    expect(splitPath(result, "linux")).toContain("/custom/tools");
  });

  it("deduplicates directories", () => {
    const result = buildMinimalServicePath({
      platform: "linux",
      extraDirs: ["/usr/bin"],
      env: {},
    });
    const parts = splitPath(result, "linux");
    const unique = [...new Set(parts)];
    expect(parts.length).toBe(unique.length);
  });
});

describe("buildServiceEnvironment", () => {
  it("sets minimal PATH, workspace, and gateway vars", () => {
    const env = buildServiceEnvironment({
      env: { HOME: "/home/user" },
      port: 18789,
      token: "secret",
    });
    expect(env.HOME).toBe("/home/user");
    if (process.platform === "win32") {
      expect(env.PATH).toBe("");
    } else {
      expect(env.PATH).toContain("/usr/bin");
    }
    expect(env.SHAD_COLLECTION_PATH).toBe(path.join("/home/user/.edwinpai", "workspace"));
    expect(env.EDWINPAI_GATEWAY_PORT).toBe("18789");
    expect(env.EDWINPAI_GATEWAY_TOKEN).toBe("secret");
    expect(env.EDWINPAI_SERVICE_MARKER).toBe("edwinpai");
    expect(env.EDWINPAI_SERVICE_KIND).toBe("gateway");
    expect(typeof env.EDWINPAI_SERVICE_VERSION).toBe("string");
    expect(env.EDWINPAI_SYSTEMD_UNIT).toBe("edwinpai-gateway.service");
    if (process.platform === "darwin") {
      expect(env.EDWINPAI_LAUNCHD_LABEL).toBe("ai.edwinpai.gateway");
    }
  });

  it("uses profile-specific unit and label", () => {
    const env = buildServiceEnvironment({
      env: { HOME: "/home/user", EDWINPAI_PROFILE: "work" },
      port: 18789,
    });
    expect(env.EDWINPAI_SYSTEMD_UNIT).toBe("edwinpai-gateway-work.service");
    expect(env.SHAD_COLLECTION_PATH).toBe(path.join("/home/user/.edwinpai-work", "workspace"));
    if (process.platform === "darwin") {
      expect(env.EDWINPAI_LAUNCHD_LABEL).toBe("ai.edwinpai.work");
    }
  });

  it("derives canonical state/config paths when env overrides are absent", () => {
    const env = buildServiceEnvironment({
      env: { HOME: "/home/user", EDWINPAI_PROFILE: "work" },
      port: 18789,
    });
    expect(env.EDWINPAI_STATE_DIR).toBe("/home/user/.edwinpai-work");
    expect(env.EDWINPAI_CONFIG_PATH).toBe("/home/user/.edwinpai-work/edwinpai.json");
  });
});

describe("buildNodeServiceEnvironment", () => {
  it("passes through HOME and workspace for node services", () => {
    const env = buildNodeServiceEnvironment({
      env: { HOME: "/home/user" },
    });
    expect(env.HOME).toBe("/home/user");
    expect(env.SHAD_COLLECTION_PATH).toBe(path.join("/home/user/.edwinpai", "workspace"));
  });
});
