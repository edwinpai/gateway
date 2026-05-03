import { describe, expect, it } from "vitest";
import {
  findBundledNativeAddons,
  findCompiledJsProtectedRuntimeFiles,
  isNativeIdentityCoreRequired,
  isNativeProtectedCoreReleaseRequired,
} from "./release-check.ts";

describe("isNativeIdentityCoreRequired", () => {
  it("returns false when env value is undefined", () => {
    expect(isNativeIdentityCoreRequired(undefined)).toBe(false);
  });

  it("returns false for empty string, '0', and 'false'", () => {
    expect(isNativeIdentityCoreRequired("")).toBe(false);
    expect(isNativeIdentityCoreRequired("0")).toBe(false);
    expect(isNativeIdentityCoreRequired("false")).toBe(false);
    expect(isNativeIdentityCoreRequired("FALSE")).toBe(false);
  });

  it("returns true for '1', 'true', and other truthy strings", () => {
    expect(isNativeIdentityCoreRequired("1")).toBe(true);
    expect(isNativeIdentityCoreRequired("true")).toBe(true);
    expect(isNativeIdentityCoreRequired("TRUE")).toBe(true);
    expect(isNativeIdentityCoreRequired("yes")).toBe(true);
  });
});

describe("isNativeProtectedCoreReleaseRequired", () => {
  it("uses the same truthy flag semantics as the identity-core strict mode", () => {
    expect(isNativeProtectedCoreReleaseRequired(undefined)).toBe(false);
    expect(isNativeProtectedCoreReleaseRequired("0")).toBe(false);
    expect(isNativeProtectedCoreReleaseRequired("false")).toBe(false);
    expect(isNativeProtectedCoreReleaseRequired("1")).toBe(true);
    expect(isNativeProtectedCoreReleaseRequired("yes")).toBe(true);
  });
});

describe("findBundledNativeAddons", () => {
  it("returns empty when the pack has no native bundles", () => {
    const paths = [
      "package.json",
      "README.md",
      "dist/index.js",
      "dist/index.d.ts",
      "dist/native-loader.js",
    ];
    expect(findBundledNativeAddons(paths)).toEqual([]);
  });

  it("matches platform-specific bundled addons", () => {
    const paths = [
      "package.json",
      "dist/index.js",
      "native/darwin-arm64/identity-core.node",
      "native/linux-x64/identity-core.node",
      "native/win32-x64/identity-core.node",
    ];
    expect(findBundledNativeAddons(paths).toSorted()).toEqual([
      "native/darwin-arm64/identity-core.node",
      "native/linux-x64/identity-core.node",
      "native/win32-x64/identity-core.node",
    ]);
  });

  it("ignores manifests and sibling files inside native/<triple>/", () => {
    const paths = [
      "native/darwin-arm64/identity-core.node",
      "native/darwin-arm64/identity-core-artifact.json",
      "native/darwin-arm64/STAGING-NOT-LOADABLE.txt",
    ];
    expect(findBundledNativeAddons(paths)).toEqual(["native/darwin-arm64/identity-core.node"]);
  });

  it("ignores native-staging entries which are not the launch-loadable layout", () => {
    const paths = [
      "native-staging/darwin-arm64/identity-core.node",
      "native/darwin-arm64/identity-core.node",
    ];
    expect(findBundledNativeAddons(paths)).toEqual(["native/darwin-arm64/identity-core.node"]);
  });
});

describe("findCompiledJsProtectedRuntimeFiles", () => {
  it("finds compiled runtime JS under dist", () => {
    expect(
      findCompiledJsProtectedRuntimeFiles([
        "package.json",
        "dist/index.js",
        "dist/entry.mjs",
        "dist/index.d.ts",
        "native/linux-x64-gnu/shad-core.node",
      ]),
    ).toEqual(["dist/index.js", "dist/entry.mjs"]);
  });

  it("ignores declarations, package metadata, and native addons", () => {
    expect(
      findCompiledJsProtectedRuntimeFiles([
        "README.md",
        "dist/index.d.ts",
        "native/darwin-arm64/identity-core.node",
      ]),
    ).toEqual([]);
  });
});
