import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getIdentityCoreCompanionPackageName,
  getIdentityCoreCompanionPlatformDefinition,
  prepareIdentityCorePlatformPackages,
} from "./identity-core-platform-package-prep.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("prepareIdentityCorePlatformPackages", () => {
  it("prepares a companion package dir for a truthful staged .node addon", async () => {
    const root = await makeTempDir();
    const stagingDir = path.join(root, "staging");
    const outDir = path.join(root, "out");

    await writeStagedAddon({
      stagingDir,
      runtimeTriple: "darwin-arm64",
      nodeContent: "native-addon",
      manifest: {
        sourceTarget: "aarch64-apple-darwin",
        packageTriple: "darwin-arm64",
        runner: "macos-14",
        file: "identity-core.node",
        sha256: "abc123",
        stagingOnly: false,
        loadNativeIdentityCoreCompatible: true,
      },
    });

    const result = await prepareIdentityCorePlatformPackages({
      stagingDir,
      outDir,
      version: "1.2.3",
    });

    expect(result.skippedRuntimeTriples).toEqual([]);
    expect(result.preparedPackages).toHaveLength(1);
    expect(result.preparedPackages[0]).toMatchObject({
      runtimeTriple: "darwin-arm64",
      packageName: "@edwinpai/identity-core-darwin-arm64",
      os: ["darwin"],
      cpu: ["arm64"],
    });

    const packageDir = path.join(outDir, "edwinpai", "identity-core-darwin-arm64");
    const packageJson = JSON.parse(
      await readFile(path.join(packageDir, "package.json"), "utf8"),
    ) as {
      name: string;
      version: string;
      os: string[];
      cpu: string[];
      main: string;
      files: string[];
    };
    expect(packageJson).toMatchObject({
      name: "@edwinpai/identity-core-darwin-arm64",
      version: "1.2.3",
      os: ["darwin"],
      cpu: ["arm64"],
      main: "identity-core.node",
      files: ["identity-core.node", "identity-core-artifact.json"],
    });
    expect(await readFile(path.join(packageDir, "identity-core.node"), "utf8")).toBe(
      "native-addon",
    );
    expect(
      JSON.parse(await readFile(path.join(packageDir, "identity-core-artifact.json"), "utf8")),
    ).toMatchObject({
      packageTriple: "darwin-arm64",
      loadNativeIdentityCoreCompatible: true,
    });
  });

  it("skips staging-only and non-.node staging dirs", async () => {
    const root = await makeTempDir();
    const stagingDir = path.join(root, "staging");
    const outDir = path.join(root, "out");

    await writeStagedFiles({
      stagingDir,
      runtimeTriple: "linux-x64",
      files: {
        "libedwinpai_identity_core.so": "shared-library",
        "identity-core-artifact.json": JSON.stringify(
          {
            sourceTarget: "x86_64-unknown-linux-gnu",
            packageTriple: "linux-x64",
            runner: "ubuntu-22.04",
            file: "libedwinpai_identity_core.so",
            sha256: "def456",
            stagingOnly: true,
            loadNativeIdentityCoreCompatible: false,
          },
          null,
          2,
        ),
        "STAGING-NOT-LOADABLE.txt": "not loadable",
      },
    });

    const result = await prepareIdentityCorePlatformPackages({
      stagingDir,
      outDir,
      version: "1.2.3",
    });

    expect(result.preparedPackages).toEqual([]);
    expect(result.skippedRuntimeTriples).toEqual(["linux-x64"]);
    await expect(
      readFile(
        path.join(outDir, "edwinpai", "identity-core-linux-x64-gnu", "package.json"),
        "utf8",
      ),
    ).rejects.toThrow();
  });

  it("maps runtime triples deterministically to companion package metadata", () => {
    expect(getIdentityCoreCompanionPackageName("darwin-arm64")).toBe(
      "@edwinpai/identity-core-darwin-arm64",
    );
    expect(getIdentityCoreCompanionPackageName("linux-x64")).toBe(
      "@edwinpai/identity-core-linux-x64-gnu",
    );
    expect(getIdentityCoreCompanionPackageName("win32-x64")).toBe(
      "@edwinpai/identity-core-win32-x64-msvc",
    );
    expect(getIdentityCoreCompanionPlatformDefinition("linux-x64")).toMatchObject({
      os: "linux",
      cpu: "x64",
      libc: "glibc",
    });
  });
});

async function makeTempDir(): Promise<string> {
  const dir = await import("node:fs/promises").then((fs) =>
    fs.mkdtemp(path.join(os.tmpdir(), "identity-core-platform-package-prep-")),
  );
  tempDirs.push(dir);
  return dir;
}

async function writeStagedAddon(params: {
  stagingDir: string;
  runtimeTriple: string;
  nodeContent: string;
  manifest: Record<string, unknown>;
}): Promise<void> {
  const tripleDir = path.join(params.stagingDir, params.runtimeTriple);
  await mkdir(tripleDir, { recursive: true });
  await writeFile(path.join(tripleDir, "identity-core.node"), params.nodeContent, "utf8");
  await writeFile(
    path.join(tripleDir, "identity-core-artifact.json"),
    JSON.stringify(params.manifest, null, 2) + "\n",
    "utf8",
  );
}

async function writeStagedFiles(params: {
  stagingDir: string;
  runtimeTriple: string;
  files: Record<string, string>;
}): Promise<void> {
  const tripleDir = path.join(params.stagingDir, params.runtimeTriple);
  await mkdir(tripleDir, { recursive: true });
  await Promise.all(
    Object.entries(params.files).map(([fileName, contents]) =>
      writeFile(path.join(tripleDir, fileName), `${contents}\n`, "utf8"),
    ),
  );
}
