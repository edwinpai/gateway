import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prepareIdentityCoreBasePackage } from "./identity-core-base-package-prep.js";

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

describe("prepareIdentityCoreBasePackage", () => {
  it("keeps the prepared package honest when no companion packages exist", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "identity-core-base-prep-"));
    const packageDir = path.join(tempDir, "package-src");
    const outDir = path.join(tempDir, "package-out");

    await writeJson(path.join(packageDir, "package.json"), {
      name: "@edwinpai/identity-core",
      version: "1.2.3",
      main: "dist/index.js",
    });
    await fs.writeFile(path.join(packageDir, "README.md"), "# test\n", "utf8");

    try {
      const result = await prepareIdentityCoreBasePackage({
        packageDir,
        outDir,
      });
      expect(result.optionalDependencies).toEqual({});
      const prepared = JSON.parse(await fs.readFile(path.join(outDir, "package.json"), "utf8")) as {
        optionalDependencies?: Record<string, string>;
      };
      expect(prepared.optionalDependencies).toBeUndefined();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("injects optionalDependencies for prepared companion packages only", async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "identity-core-base-prep-with-companions-"),
    );
    const packageDir = path.join(tempDir, "package-src");
    const outDir = path.join(tempDir, "package-out");
    const companionsRoot = path.join(tempDir, "companions");

    await writeJson(path.join(packageDir, "package.json"), {
      name: "@edwinpai/identity-core",
      version: "9.9.9",
      main: "dist/index.js",
    });
    await fs.writeFile(path.join(packageDir, "README.md"), "# test\n", "utf8");

    await writeJson(
      path.join(companionsRoot, "@edwinpai", "identity-core-linux-x64-gnu", "package.json"),
      {
        name: "@edwinpai/identity-core-linux-x64-gnu",
        version: "9.9.9",
      },
    );
    await writeJson(
      path.join(companionsRoot, "@edwinpai", "identity-core-darwin-arm64", "package.json"),
      {
        name: "@edwinpai/identity-core-darwin-arm64",
        version: "9.9.9",
      },
    );
    await writeJson(path.join(companionsRoot, "other", "package.json"), {
      name: "not-a-companion",
      version: "9.9.9",
    });

    try {
      const result = await prepareIdentityCoreBasePackage({
        packageDir,
        outDir,
        companionPackagesRoot: companionsRoot,
      });
      expect(result.optionalDependencies).toEqual({
        "@edwinpai/identity-core-darwin-arm64": "9.9.9",
        "@edwinpai/identity-core-linux-x64-gnu": "9.9.9",
      });
      const prepared = JSON.parse(await fs.readFile(path.join(outDir, "package.json"), "utf8")) as {
        optionalDependencies?: Record<string, string>;
      };
      expect(prepared.optionalDependencies).toEqual({
        "@edwinpai/identity-core-darwin-arm64": "9.9.9",
        "@edwinpai/identity-core-linux-x64-gnu": "9.9.9",
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
