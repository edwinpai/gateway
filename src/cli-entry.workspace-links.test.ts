import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("edwinpai.mjs workspace dependency links", () => {
  it("repairs missing protected workspace package links before loading dist", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "edwinpai-cli-entry-"));
    tempDirs.push(tempDir);

    await fs.copyFile(path.join(repoRoot, "edwinpai.mjs"), path.join(tempDir, "edwinpai.mjs"));
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify(
        {
          type: "module",
          dependencies: {
            "@edwinpai/identity-core": "workspace:*",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const identityCoreDir = path.join(tempDir, "packages", "identity-core");
    await fs.mkdir(path.join(identityCoreDir, "dist"), { recursive: true });
    await fs.writeFile(
      path.join(identityCoreDir, "package.json"),
      JSON.stringify(
        {
          name: "@edwinpai/identity-core",
          type: "module",
          exports: {
            ".": "./dist/index.js",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await fs.writeFile(
      path.join(identityCoreDir, "dist", "index.js"),
      'export const marker = "workspace-link-ok";\n',
      "utf8",
    );

    await fs.mkdir(path.join(tempDir, "dist"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "dist", "entry.js"),
      'import { marker } from "@edwinpai/identity-core";\nconsole.log(marker);\n',
      "utf8",
    );

    const result = spawnSync(process.execPath, [path.join(tempDir, "edwinpai.mjs")], {
      cwd: tempDir,
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_DISABLE_COMPILE_CACHE: "1",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain(
      "Repaired missing workspace dependency link: @edwinpai/identity-core",
    );
    expect(result.stdout.trim()).toBe("workspace-link-ok");
    await expect(
      fs.realpath(path.join(tempDir, "node_modules", "@edwinpai", "identity-core")),
    ).resolves.toBe(await fs.realpath(identityCoreDir));
  });
});
