import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stageIdentityCoreArtifacts } from "./identity-core-artifact-sync.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("stageIdentityCoreArtifacts", () => {
  it("normalizes protected build-origin bundles into consumer staging layout", async () => {
    const root = await makeTempDir();
    const sourceDir = path.join(root, "source");
    const outDir = path.join(root, "out");

    await writeBundle({
      sourceDir,
      target: "x86_64-unknown-linux-gnu",
      file: "libedwinpai_identity_core.so",
      content: "linux-binary",
      runner: "ubuntu-22.04",
    });
    await writeBundle({
      sourceDir,
      target: "aarch64-apple-darwin",
      file: "libedwinpai_identity_core.dylib",
      content: "darwin-binary",
      runner: "macos-14",
    });

    const result = await stageIdentityCoreArtifacts({ sourceDir, outDir });

    expect(result.artifacts.map((artifact) => artifact.packageTriple)).toEqual([
      "darwin-arm64",
      "linux-x64",
    ]);

    const stagedManifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as {
      stagingOnly: boolean;
      artifacts: Array<{
        packageTriple: string;
        relativePath: string;
        stagingOnly: boolean;
        loadNativeIdentityCoreCompatible: boolean;
      }>;
    };
    expect(stagedManifest.stagingOnly).toBe(true);
    expect(stagedManifest.artifacts).toMatchObject([
      {
        packageTriple: "darwin-arm64",
        relativePath: "darwin-arm64/libedwinpai_identity_core.dylib",
        stagingOnly: true,
        loadNativeIdentityCoreCompatible: false,
      },
      {
        packageTriple: "linux-x64",
        relativePath: "linux-x64/libedwinpai_identity_core.so",
        stagingOnly: true,
        loadNativeIdentityCoreCompatible: false,
      },
    ]);

    expect(
      await readFile(path.join(outDir, "darwin-arm64", "STAGING-NOT-LOADABLE.txt"), "utf8"),
    ).toContain("not yet a verified Node addon");
  });

  it("preserves a real .node artifact as loadNativeIdentityCore-compatible", async () => {
    const root = await makeTempDir();
    const sourceDir = path.join(root, "source");
    const outDir = path.join(root, "out");

    await writeBundle({
      sourceDir,
      target: "x86_64-apple-darwin",
      file: "identity-core.node",
      content: "node-addon",
      runner: "macos-13",
    });

    const result = await stageIdentityCoreArtifacts({ sourceDir, outDir });
    expect(result.artifacts[0]?.loadNativeIdentityCoreCompatible).toBe(true);

    const copiedNode = await readFile(
      path.join(outDir, "darwin-x64", "identity-core.node"),
      "utf8",
    );
    expect(copiedNode).toBe("node-addon");
  });

  it("fails closed on checksum mismatches", async () => {
    const root = await makeTempDir();
    const sourceDir = path.join(root, "source");
    const outDir = path.join(root, "out");
    const bundleDir = path.join(sourceDir, "identity-core-x86_64-unknown-linux-gnu");
    await mkdir(bundleDir, { recursive: true });
    await writeFile(path.join(bundleDir, "libedwinpai_identity_core.so"), "tampered", "utf8");
    await writeFile(
      path.join(bundleDir, "identity-core-artifact.json"),
      JSON.stringify(
        {
          target: "x86_64-unknown-linux-gnu",
          runner: "ubuntu-22.04",
          file: "libedwinpai_identity_core.so",
          sha256: "deadbeef",
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    await expect(stageIdentityCoreArtifacts({ sourceDir, outDir })).rejects.toThrow(
      "SHA-256 mismatch",
    );
  });
});

async function makeTempDir(): Promise<string> {
  const dir = await import("node:fs/promises").then((fs) =>
    fs.mkdtemp(path.join(os.tmpdir(), "identity-core-artifact-sync-")),
  );
  tempDirs.push(dir);
  return dir;
}

async function writeBundle(params: {
  sourceDir: string;
  target: string;
  runner: string;
  file: string;
  content: string;
}): Promise<void> {
  const bundleDir = path.join(params.sourceDir, `identity-core-${params.target}`);
  await mkdir(bundleDir, { recursive: true });
  const filePath = path.join(bundleDir, params.file);
  await writeFile(filePath, params.content, "utf8");
  const sha256 = createHash("sha256").update(params.content).digest("hex");
  await writeFile(
    path.join(bundleDir, "identity-core-artifact.json"),
    JSON.stringify(
      {
        target: params.target,
        runner: params.runner,
        file: params.file,
        sha256,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}
