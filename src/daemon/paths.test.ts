import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveGatewayStateDir } from "./paths.js";

describe("resolveGatewayStateDir", () => {
  it("uses the default state dir when no overrides are set", () => {
    const env = { HOME: "/Users/test" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".edwinpai"));
  });

  it("appends the profile suffix when set", () => {
    const env = { HOME: "/Users/test", EDWINPAI_PROFILE: "rescue" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".edwinpai-rescue"));
  });

  it("treats default profiles as the base state dir", () => {
    const env = { HOME: "/Users/test", EDWINPAI_PROFILE: "Default" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".edwinpai"));
  });

  it("uses EDWINPAI_STATE_DIR when provided", () => {
    const env = { HOME: "/Users/test", EDWINPAI_STATE_DIR: "/var/lib/edwinpai" };
    expect(resolveGatewayStateDir(env)).toBe(path.resolve("/var/lib/edwinpai"));
  });

  it("expands ~ in EDWINPAI_STATE_DIR", () => {
    const env = { HOME: "/Users/test", EDWINPAI_STATE_DIR: "~/edwinpai-state" };
    expect(resolveGatewayStateDir(env)).toBe(path.resolve("/Users/test/edwinpai-state"));
  });

  it("preserves Windows absolute paths without HOME", () => {
    const env = { EDWINPAI_STATE_DIR: "C:\\State\\edwin" };
    expect(resolveGatewayStateDir(env)).toBe("C:\\State\\edwin");
  });
});
