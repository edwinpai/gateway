import { describe, expect, it } from "vitest";
import {
  buildParseArgv,
  getFlagValue,
  getCommandPath,
  getPrimaryCommand,
  getPositiveIntFlagValue,
  getVerboseFlag,
  hasHelpOrVersion,
  hasFlag,
  shouldMigrateState,
  shouldMigrateStateFromPath,
} from "./argv.js";

describe("argv helpers", () => {
  it("detects help/version flags", () => {
    expect(hasHelpOrVersion(["node", "edwinpai", "--help"])).toBe(true);
    expect(hasHelpOrVersion(["node", "edwinpai", "-V"])).toBe(true);
    expect(hasHelpOrVersion(["node", "edwinpai", "status"])).toBe(false);
  });

  it("extracts command path ignoring flags and terminator", () => {
    expect(getCommandPath(["node", "edwinpai", "status", "--json"], 2)).toEqual(["status"]);
    expect(getCommandPath(["node", "edwinpai", "agents", "list"], 2)).toEqual(["agents", "list"]);
    expect(getCommandPath(["node", "edwinpai", "status", "--", "ignored"], 2)).toEqual(["status"]);
  });

  it("returns primary command", () => {
    expect(getPrimaryCommand(["node", "edwinpai", "agents", "list"])).toBe("agents");
    expect(getPrimaryCommand(["node", "edwinpai"])).toBeNull();
  });

  it("parses boolean flags and ignores terminator", () => {
    expect(hasFlag(["node", "edwinpai", "status", "--json"], "--json")).toBe(true);
    expect(hasFlag(["node", "edwinpai", "--", "--json"], "--json")).toBe(false);
  });

  it("extracts flag values with equals and missing values", () => {
    expect(getFlagValue(["node", "edwinpai", "status", "--timeout", "5000"], "--timeout")).toBe(
      "5000",
    );
    expect(getFlagValue(["node", "edwinpai", "status", "--timeout=2500"], "--timeout")).toBe(
      "2500",
    );
    expect(getFlagValue(["node", "edwinpai", "status", "--timeout"], "--timeout")).toBeNull();
    expect(getFlagValue(["node", "edwinpai", "status", "--timeout", "--json"], "--timeout")).toBe(
      null,
    );
    expect(getFlagValue(["node", "edwinpai", "--", "--timeout=99"], "--timeout")).toBeUndefined();
  });

  it("parses verbose flags", () => {
    expect(getVerboseFlag(["node", "edwinpai", "status", "--verbose"])).toBe(true);
    expect(getVerboseFlag(["node", "edwinpai", "status", "--debug"])).toBe(false);
    expect(getVerboseFlag(["node", "edwinpai", "status", "--debug"], { includeDebug: true })).toBe(
      true,
    );
  });

  it("parses positive integer flag values", () => {
    expect(getPositiveIntFlagValue(["node", "edwinpai", "status"], "--timeout")).toBeUndefined();
    expect(
      getPositiveIntFlagValue(["node", "edwinpai", "status", "--timeout"], "--timeout"),
    ).toBeNull();
    expect(
      getPositiveIntFlagValue(["node", "edwinpai", "status", "--timeout", "5000"], "--timeout"),
    ).toBe(5000);
    expect(
      getPositiveIntFlagValue(["node", "edwinpai", "status", "--timeout", "nope"], "--timeout"),
    ).toBeUndefined();
  });

  it("builds parse argv from raw args", () => {
    const nodeArgv = buildParseArgv({
      programName: "edwinpai",
      rawArgs: ["node", "edwinpai", "status"],
    });
    expect(nodeArgv).toEqual(["node", "edwinpai", "status"]);

    const versionedNodeArgv = buildParseArgv({
      programName: "edwinpai",
      rawArgs: ["node-22", "edwinpai", "status"],
    });
    expect(versionedNodeArgv).toEqual(["node-22", "edwinpai", "status"]);

    const versionedNodeWindowsArgv = buildParseArgv({
      programName: "edwinpai",
      rawArgs: ["node-22.2.0.exe", "edwinpai", "status"],
    });
    expect(versionedNodeWindowsArgv).toEqual(["node-22.2.0.exe", "edwinpai", "status"]);

    const versionedNodePatchlessArgv = buildParseArgv({
      programName: "edwinpai",
      rawArgs: ["node-22.2", "edwinpai", "status"],
    });
    expect(versionedNodePatchlessArgv).toEqual(["node-22.2", "edwinpai", "status"]);

    const versionedNodeWindowsPatchlessArgv = buildParseArgv({
      programName: "edwinpai",
      rawArgs: ["node-22.2.exe", "edwinpai", "status"],
    });
    expect(versionedNodeWindowsPatchlessArgv).toEqual(["node-22.2.exe", "edwinpai", "status"]);

    const versionedNodeWithPathArgv = buildParseArgv({
      programName: "edwinpai",
      rawArgs: ["/usr/bin/node-22.2.0", "edwinpai", "status"],
    });
    expect(versionedNodeWithPathArgv).toEqual(["/usr/bin/node-22.2.0", "edwinpai", "status"]);

    const nodejsArgv = buildParseArgv({
      programName: "edwinpai",
      rawArgs: ["nodejs", "edwinpai", "status"],
    });
    expect(nodejsArgv).toEqual(["nodejs", "edwinpai", "status"]);

    const nonVersionedNodeArgv = buildParseArgv({
      programName: "edwinpai",
      rawArgs: ["node-dev", "edwinpai", "status"],
    });
    expect(nonVersionedNodeArgv).toEqual(["node", "edwinpai", "node-dev", "edwinpai", "status"]);

    const directArgv = buildParseArgv({
      programName: "edwinpai",
      rawArgs: ["edwinpai", "status"],
    });
    expect(directArgv).toEqual(["node", "edwinpai", "status"]);

    const bunArgv = buildParseArgv({
      programName: "edwinpai",
      rawArgs: ["bun", "src/entry.ts", "status"],
    });
    expect(bunArgv).toEqual(["bun", "src/entry.ts", "status"]);
  });

  it("builds parse argv from fallback args", () => {
    const fallbackArgv = buildParseArgv({
      programName: "edwinpai",
      fallbackArgv: ["status"],
    });
    expect(fallbackArgv).toEqual(["node", "edwinpai", "status"]);
  });

  it("decides when to migrate state", () => {
    expect(shouldMigrateState(["node", "edwinpai", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "edwinpai", "health"])).toBe(false);
    expect(shouldMigrateState(["node", "edwinpai", "sessions"])).toBe(false);
    expect(shouldMigrateState(["node", "edwinpai", "memory", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "edwinpai", "agent", "--message", "hi"])).toBe(false);
    expect(shouldMigrateState(["node", "edwinpai", "agents", "list"])).toBe(true);
    expect(shouldMigrateState(["node", "edwinpai", "message", "send"])).toBe(true);
  });

  it("reuses command path for migrate state decisions", () => {
    expect(shouldMigrateStateFromPath(["status"])).toBe(false);
    expect(shouldMigrateStateFromPath(["agents", "list"])).toBe(true);
  });
});
