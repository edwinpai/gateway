import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway --dev for subcommands", () => {
    const res = parseCliProfileArgs([
      "node",
      "edwinpai",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "edwinpai", "gateway", "--dev", "--allow-unconfigured"]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "edwinpai", "--dev", "gateway"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "edwinpai", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "edwinpai", "--profile", "work", "status"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "edwinpai", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "edwinpai", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (dev first)", () => {
    const res = parseCliProfileArgs(["node", "edwinpai", "--dev", "--profile", "work", "status"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (profile first)", () => {
    const res = parseCliProfileArgs(["node", "edwinpai", "--profile", "work", "--dev", "status"]);
    expect(res.ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join("/home/peter", ".edwinpai-dev");
    expect(env.EDWINPAI_PROFILE).toBe("dev");
    expect(env.EDWINPAI_STATE_DIR).toBe(expectedStateDir);
    expect(env.EDWINPAI_CONFIG_PATH).toBe(path.join(expectedStateDir, "edwinpai.json"));
    expect(env.EDWINPAI_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      EDWINPAI_STATE_DIR: "/custom",
      EDWINPAI_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.EDWINPAI_STATE_DIR).toBe("/custom");
    expect(env.EDWINPAI_GATEWAY_PORT).toBe("19099");
    expect(env.EDWINPAI_CONFIG_PATH).toBe(path.join("/custom", "edwinpai.json"));
  });
});

describe("formatCliCommand", () => {
  it("returns command unchanged when no profile is set", () => {
    expect(formatCliCommand("edwinpai doctor --fix", {})).toBe("edwinpai doctor --fix");
  });

  it("returns command unchanged when profile is default", () => {
    expect(formatCliCommand("edwinpai doctor --fix", { EDWINPAI_PROFILE: "default" })).toBe(
      "edwinpai doctor --fix",
    );
  });

  it("returns command unchanged when profile is Default (case-insensitive)", () => {
    expect(formatCliCommand("edwinpai doctor --fix", { EDWINPAI_PROFILE: "Default" })).toBe(
      "edwinpai doctor --fix",
    );
  });

  it("returns command unchanged when profile is invalid", () => {
    expect(formatCliCommand("edwinpai doctor --fix", { EDWINPAI_PROFILE: "bad profile" })).toBe(
      "edwinpai doctor --fix",
    );
  });

  it("returns command unchanged when --profile is already present", () => {
    expect(
      formatCliCommand("edwinpai --profile work doctor --fix", { EDWINPAI_PROFILE: "work" }),
    ).toBe("edwinpai --profile work doctor --fix");
  });

  it("returns command unchanged when --dev is already present", () => {
    expect(formatCliCommand("edwinpai --dev doctor", { EDWINPAI_PROFILE: "dev" })).toBe(
      "edwinpai --dev doctor",
    );
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("edwinpai doctor --fix", { EDWINPAI_PROFILE: "work" })).toBe(
      "edwinpai --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(formatCliCommand("edwinpai doctor --fix", { EDWINPAI_PROFILE: "  jbedwin  " })).toBe(
      "edwinpai --profile jbedwin doctor --fix",
    );
  });

  it("handles command with no args after edwinpai", () => {
    expect(formatCliCommand("edwinpai", { EDWINPAI_PROFILE: "test" })).toBe(
      "edwinpai --profile test",
    );
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm edwinpai doctor", { EDWINPAI_PROFILE: "work" })).toBe(
      "pnpm edwinpai --profile work doctor",
    );
  });
});
