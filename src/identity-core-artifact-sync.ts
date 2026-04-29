import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface SourceIdentityCoreArtifactManifest {
  target: string;
  runner: string;
  file: string;
  sha256: string;
}

export interface StagedIdentityCoreArtifact {
  sourceTarget: string;
  packageTriple: string;
  runner: string;
  file: string;
  sha256: string;
  sourcePath: string;
  stagedPath: string;
  stagingOnly: boolean;
  loadNativeIdentityCoreCompatible: boolean;
}

export interface StageIdentityCoreArtifactsOptions {
  sourceDir: string;
  outDir: string;
  clean?: boolean;
}

export interface StageIdentityCoreArtifactsResult {
  outDir: string;
  manifestPath: string;
  artifacts: StagedIdentityCoreArtifact[];
}

const PACKAGE_TRIPLE_BY_RUST_TARGET = new Map<string, string>([
  ["x86_64-unknown-linux-gnu", "linux-x64"],
  ["aarch64-unknown-linux-gnu", "linux-arm64"],
  ["x86_64-apple-darwin", "darwin-x64"],
  ["aarch64-apple-darwin", "darwin-arm64"],
  ["x86_64-pc-windows-msvc", "win32-x64"],
]);

export async function stageIdentityCoreArtifacts(
  options: StageIdentityCoreArtifactsOptions,
): Promise<StageIdentityCoreArtifactsResult> {
  const sourceDir = path.resolve(options.sourceDir);
  const outDir = path.resolve(options.outDir);

  if (options.clean !== false) {
    await rm(outDir, { recursive: true, force: true });
  }
  await mkdir(outDir, { recursive: true });

  const manifestPaths = await findArtifactManifestPaths(sourceDir);
  if (manifestPaths.length === 0) {
    throw new Error(`No identity-core-artifact.json files found under ${sourceDir}`);
  }

  const seenPackageTriples = new Set<string>();
  const artifacts: StagedIdentityCoreArtifact[] = [];

  for (const manifestPath of manifestPaths.sort()) {
    const manifest = await readSourceManifest(manifestPath);
    const packageTriple = PACKAGE_TRIPLE_BY_RUST_TARGET.get(manifest.target);
    if (!packageTriple) {
      throw new Error(`Unsupported identity-core artifact target: ${manifest.target}`);
    }
    if (seenPackageTriples.has(packageTriple)) {
      throw new Error(`Duplicate identity-core artifact package triple: ${packageTriple}`);
    }
    seenPackageTriples.add(packageTriple);

    const bundleDir = path.dirname(manifestPath);
    const sourcePath = path.join(bundleDir, manifest.file);
    const sourceStat = await stat(sourcePath).catch(() => null);
    if (!sourceStat?.isFile()) {
      throw new Error(`Missing identity-core artifact file for ${manifest.target}: ${sourcePath}`);
    }

    const actualSha = await sha256File(sourcePath);
    if (actualSha !== manifest.sha256) {
      throw new Error(
        `SHA-256 mismatch for ${manifest.target}: expected ${manifest.sha256}, got ${actualSha}`,
      );
    }

    const loadNativeIdentityCoreCompatible = path.extname(manifest.file) === ".node";
    const stagingOnly = !loadNativeIdentityCoreCompatible;

    const targetDir = path.join(outDir, packageTriple);
    await mkdir(targetDir, { recursive: true });
    const stagedPath = path.join(targetDir, manifest.file);
    await copyFile(sourcePath, stagedPath);

    const stagedManifest = {
      sourceTarget: manifest.target,
      packageTriple,
      runner: manifest.runner,
      file: manifest.file,
      sha256: manifest.sha256,
      stagingOnly,
      loadNativeIdentityCoreCompatible,
    };
    await writeFile(
      path.join(targetDir, "identity-core-artifact.json"),
      JSON.stringify(stagedManifest, null, 2) + "\n",
      "utf8",
    );

    if (loadNativeIdentityCoreCompatible) {
      await copyFile(stagedPath, path.join(targetDir, "identity-core.node"));
    } else {
      await writeFile(
        path.join(targetDir, "STAGING-NOT-LOADABLE.txt"),
        [
          "This directory contains a protected identity-core shared-library staging artifact.",
          "It is intentionally not renamed to identity-core.node because the current build-origin artifact is not yet a verified Node addon.",
          "loadNativeIdentityCore() will not resolve this staging directory directly.",
          "",
        ].join("\n"),
        "utf8",
      );
    }

    artifacts.push({
      sourceTarget: manifest.target,
      packageTriple,
      runner: manifest.runner,
      file: manifest.file,
      sha256: manifest.sha256,
      sourcePath,
      stagedPath,
      stagingOnly,
      loadNativeIdentityCoreCompatible,
    });
  }

  const manifestPath = path.join(outDir, "index.json");
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        version: 1,
        generatedAt: new Date().toISOString(),
        stagingOnly: true,
        loadNativeIdentityCoreCompatible: false,
        note: "These artifacts came from the protected edwin-desktop shared-library build origin and were normalized into a consumer-facing staging layout. They are not published npm packages and are not staged as loadable identity-core.node addons unless the source artifact is already a real .node binary.",
        artifacts: artifacts.map((artifact) => ({
          sourceTarget: artifact.sourceTarget,
          packageTriple: artifact.packageTriple,
          runner: artifact.runner,
          file: artifact.file,
          sha256: artifact.sha256,
          relativePath: path.relative(outDir, artifact.stagedPath).replaceAll(path.sep, "/"),
          stagingOnly: artifact.stagingOnly,
          loadNativeIdentityCoreCompatible: artifact.loadNativeIdentityCoreCompatible,
        })),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  return {
    outDir,
    manifestPath,
    artifacts,
  };
}

async function findArtifactManifestPaths(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await findArtifactManifestPaths(full)));
      continue;
    }
    if (entry.isFile() && entry.name === "identity-core-artifact.json") {
      out.push(full);
    }
  }
  return out;
}

async function readSourceManifest(filePath: string): Promise<SourceIdentityCoreArtifactManifest> {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as Partial<SourceIdentityCoreArtifactManifest>;
  if (
    typeof parsed.target !== "string" ||
    typeof parsed.runner !== "string" ||
    typeof parsed.file !== "string" ||
    typeof parsed.sha256 !== "string"
  ) {
    throw new Error(`Invalid identity-core artifact manifest: ${filePath}`);
  }
  return {
    target: parsed.target,
    runner: parsed.runner,
    file: parsed.file,
    sha256: parsed.sha256,
  };
}

async function sha256File(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}
